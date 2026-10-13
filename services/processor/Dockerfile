# Build context: the `vivier/` directory (docker build -f services/processor/Dockerfile .
# from vivier/, or `docker build -f vivier/services/processor/Dockerfile vivier` from the
# repository root), which is Railway's root directory for this service. The
# processor is a plain Node service: it polls Supabase for queued CVs, reads
# the PDFs, structures them and writes candidates.
#
# There is no package-lock.json yet (the first person with network access
# runs `npm install` in services/processor and commits it). Until then the
# image installs from the ranges in package.json; once the lockfile is
# committed, replace both `npm install` lines with `npm ci` so the image
# takes exactly the locked tree. `package*.json` already copies the lockfile
# when it exists.
# --- build stage ---------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY services/processor/package*.json services/processor/.npmrc ./
RUN npm install --no-audit --no-fund
COPY services/processor/tsconfig.json ./
COPY services/processor/src ./src
RUN npx tsc -p tsconfig.json

# --- runtime stage -------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY services/processor/package*.json services/processor/.npmrc ./
# No lifecycle scripts at install: the runtime image takes packages as
# published, never what a postinstall would run as root.
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
# node is PID 1 (exec form, no shell): server.ts handles SIGTERM itself, so
# a stop finishes the documents in flight (up to 25 s) and exits instead of
# being killed after the grace period. The heap cap keeps one large PDF
# from taking the whole container's memory before the caps in the code
# catch it.
CMD ["node", "--max-old-space-size=768", "dist/src/server.js"]
