/**
 * Process entry: reads the configuration (a bad one exits with the line
 * that says what to fix), builds the app, listens on 0.0.0.0:PORT, and
 * when Supabase is configured starts the poller and the maintenance
 * timer. SIGTERM/SIGINT stop the timers, close the server, wait for the
 * documents in flight (up to 25 s) and exit 0; what did not finish is put
 * back in the queue by the next stale reset.
 */
import { buildApp, type AppRuntime } from "./app.js";
import { loadConfig, type ProcessorConfig } from "./config.js";
import { createDb } from "./db.js";
import { logError, logInfo, logWarn } from "./log.js";
import { runMaintenance, type MaintenanceReport } from "./maintenance.js";
import { defaultDeps } from "./pipeline.js";
import { Poller } from "./poller.js";

/** Time given to the documents in flight after a stop signal. */
const SHUTDOWN_DRAIN_MS = 25_000;
/** A stuck shutdown is cut here, before the platform's own kill. */
const SHUTDOWN_FORCE_MS = 28_000;
/** The first maintenance pass runs shortly after start; the timer takes over. */
const MAINTENANCE_KICKOFF_MS = 30_000;

function loadConfigOrExit(): ProcessorConfig {
  try {
    return loadConfig();
  } catch (error) {
    logError("config_invalid", error);
    return process.exit(1);
  }
}

const config = loadConfigOrExit();
for (const warning of config.warnings) logWarn("config_warning", { message: warning });

const db = config.supabase ? createDb(config.supabase) : null;
const deps = db ? defaultDeps(config, db) : null;
const poller = deps
  ? new Poller(deps, { intervalMs: config.pollIntervalMs, concurrency: config.concurrency })
  : null;

// One maintenance pass at a time: a POST while the timer's pass runs joins it.
let maintenanceRun: Promise<MaintenanceReport> | null = null;
function maintenanceOnce(): Promise<MaintenanceReport> {
  if (!deps) return Promise.reject(new Error("Supabase is not configured"));
  if (!maintenanceRun) {
    maintenanceRun = runMaintenance(deps).finally(() => {
      maintenanceRun = null;
    });
  }
  return maintenanceRun;
}

const runtime: AppRuntime = {
  polling: poller !== null && config.pollIntervalMs > 0,
  inFlight: () => poller?.inFlight ?? 0,
  schedule: poller ? (ids) => poller.schedule(ids) : null,
  maintenance: deps ? maintenanceOnce : null,
};
const app = buildApp(config, runtime);

let maintenanceTimer: NodeJS.Timeout | null = null;
let maintenanceKickoff: NodeJS.Timeout | null = null;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logInfo("shutdown", { signal, inFlight: poller?.inFlight ?? 0 });
  const force = setTimeout(() => process.exit(1), SHUTDOWN_FORCE_MS);
  force.unref();
  poller?.stop();
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  if (maintenanceKickoff) clearTimeout(maintenanceKickoff);
  try {
    await app.close();
  } catch (error) {
    logError("close_failed", error);
  }
  const drained = poller ? await poller.drain(SHUTDOWN_DRAIN_MS) : true;
  logInfo("exit", { drained, inFlight: poller?.inFlight ?? 0 });
  process.exit(0);
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

// A stray rejection is logged, not fatal: the document it belonged to is
// reset by the next stale pass. An exception outside any handler is a bug
// the process must not hide.
process.on("unhandledRejection", (reason: unknown) => {
  logError("unhandled_rejection", reason);
});
process.on("uncaughtException", (error: unknown) => {
  logError("uncaught_exception", error);
  process.exit(1);
});

app
  .listen({ port: config.port, host: "0.0.0.0" })
  .then(() => {
    logInfo("listening", {
      port: config.port,
      version: config.version,
      supabase: config.supabase !== null,
      model: config.model !== null,
      ocr: config.ocr !== null,
      polling: runtime.polling,
      concurrency: config.concurrency,
      pollIntervalMs: config.pollIntervalMs,
      maintenanceIntervalMs: config.maintenanceIntervalMs,
    });
    if (poller && config.pollIntervalMs > 0) poller.start();
    if (deps && config.maintenanceIntervalMs > 0) {
      const pass = () => {
        maintenanceOnce().catch((error: unknown) => logError("maintenance_failed", error));
      };
      maintenanceKickoff = setTimeout(pass, MAINTENANCE_KICKOFF_MS);
      maintenanceTimer = setInterval(pass, config.maintenanceIntervalMs);
    }
  })
  .catch((error: unknown) => {
    logError("listen_failed", error);
    process.exit(1);
  });
