import { describe, expect, it } from "vitest";

import { KeyedMutex } from "../src/mutex.js";

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1));
}

describe("KeyedMutex", () => {
  it("runs the tasks of one key one after the other, in order", async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];
    const task = (name: string) => async () => {
      events.push(`${name}:start`);
      await tick();
      events.push(`${name}:end`);
      return name;
    };
    const results = await Promise.all([
      mutex.run("org", task("a")),
      mutex.run("org", task("b")),
      mutex.run("org", task("c")),
    ]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
    expect(mutex.size).toBe(0);
  });

  it("lets the tasks of different keys overlap", async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];
    const task = (name: string) => async () => {
      events.push(`${name}:start`);
      await tick();
      events.push(`${name}:end`);
    };
    await Promise.all([mutex.run("one", task("a")), mutex.run("two", task("b"))]);
    expect(events).toEqual(["a:start", "b:start", "a:end", "b:end"]);
  });

  it("releases the key when a task throws, and the next one runs", async () => {
    const mutex = new KeyedMutex();
    const failing = mutex.run("org", async () => {
      await tick();
      throw new Error("boom");
    });
    const next = mutex.run("org", async () => "after");
    await expect(failing).rejects.toThrow("boom");
    expect(await next).toBe("after");
    expect(mutex.size).toBe(0);
  });
});
