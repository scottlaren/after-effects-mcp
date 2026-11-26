import { createRequire } from "node:module";
import { describe, it, expect, vi } from "vitest";
import { classifyBridgeState, STATUS_STALE_MS } from "../src/lib/bridge-status";

const require = createRequire(import.meta.url);
const { createDriver } = require("../src/cep/driver.cjs");

describe("classifyBridgeState", () => {
  const now = 1_000_000;
  it("says After Effects is not running, whatever the old status file says", () => {
    const d = classifyBridgeState({ state: "idle", panelTime: now - 60000 }, now, "c1", false);
    expect(d.bridgeState).toBe("ae-not-running");
    expect(d.mayStillRun).toBe(false);
  });
  it("reports busy with this command or an earlier one", () => {
    const mine = classifyBridgeState(
      {
        state: "running",
        panelTime: now - 500,
        commandId: "c1",
        command: "executeScript",
        startedAt: now - 42000,
      },
      now,
      "c1",
      true,
    );
    expect(mine.bridgeState).toBe("busy");
    expect(mine.detail).toMatch(/this command for 42 s/);
    expect(mine.mayStillRun).toBe(true);
    const other = classifyBridgeState(
      {
        state: "running",
        panelTime: now - 500,
        commandId: "c0",
        command: "startRender",
        startedAt: now - 5000,
      },
      now,
      "c1",
      true,
    );
    expect(other.detail).toMatch(/an earlier command \(startRender\)/);
  });
  it("reports paused, closed and a frozen panel", () => {
    expect(
      classifyBridgeState({ state: "paused", panelTime: now - 100 }, now, "c", true).bridgeState,
    ).toBe("paused");
    expect(
      classifyBridgeState({ state: "closed", panelTime: now - 100 }, now, "c", true).bridgeState,
    ).toBe("panel-closed");
    const frozen = classifyBridgeState(
      { state: "running", panelTime: now - STATUS_STALE_MS - 4000 },
      now,
      "c",
      true,
    );
    expect(frozen.bridgeState).toBe("panel-not-responding");
    expect(frozen.mayStillRun).toBe(true);
  });
  it("handles a missing status file and an idle panel", () => {
    expect(classifyBridgeState(null, now, "c", true).bridgeState).toBe("unknown");
    expect(classifyBridgeState(null, now, "c", null).bridgeState).toBe("unknown");
    const idle = classifyBridgeState({ state: "idle", panelTime: now - 100 }, now, "c", true);
    expect(idle.bridgeState).toBe("not-picked-up");
    expect(idle.mayStillRun).toBe(false);
  });
});

describe("driver.getState", () => {
  it("reports idle, running with the command, then idle again, and paused", async () => {
    let time = 1000;
    let command: any = null;
    let result: any = null;
    let release: (v: string) => void = () => {};
    const driver = createDriver({
      now: () => time,
      readCommand: () => command,
      readResult: () => result,
      writeResult: (r: any) => {
        result = r;
      },
      onStatus: vi.fn(),
      dispatch: () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    });
    expect(driver.getState()).toEqual({ state: "idle", panelTime: 1000 });

    command = {
      commandId: "c1",
      command: "executeScript",
      expiresAt: 9000,
      args: { description: "Inspect active composition" },
    };
    const running = driver.tick();
    time = 1500;
    expect(driver.getState()).toEqual({
      state: "running",
      panelTime: 1500,
      commandId: "c1",
      command: "executeScript",
      startedAt: 1000,
    });
    result = { status: "success", _commandId: "c1" };
    release("ok");
    await running;
    expect(driver.getState().state).toBe("idle");
    expect(driver.getState().commandId).toBeUndefined();

    driver.setPaused(true);
    expect(driver.getState().state).toBe("paused");
  });
});
