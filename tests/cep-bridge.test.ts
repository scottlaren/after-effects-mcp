import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createDriver } = require("../src/cep/driver.cjs");
const source = readFileSync(new URL("../src/scripts/mcp-bridge-auto.jsx", import.meta.url), "utf8");

function host(preExisting?: object) {
  const files = new Map<string, string>();
  if (preExisting) files.set("/bridge/ae_command.json", JSON.stringify(preExisting));
  class File {
    encoding = "";
    constructor(public fsName: string) {}
    get exists() {
      return files.has(this.fsName);
    }
    open() {
      return true;
    }
    read() {
      return files.get(this.fsName) || "";
    }
    write(text: string) {
      files.set(this.fsName, text);
      return true;
    }
    close() {
      return true;
    }
  }
  class Folder {
    static myDocuments = { fsName: "/documents" };
    exists = true;
    constructor(public fsName: string) {}
    create() {
      return true;
    }
  }
  const app = {
    version: "25.3.2",
    project: { file: null, activeItem: null, edits: 0 },
    settings: { haveSetting: () => false, getSetting: () => "", saveSetting: vi.fn() },
    cancelTask: vi.fn(),
    scheduleTask: vi.fn(),
    beginSuppressDialogs: vi.fn(),
    endSuppressDialogs: vi.fn(),
  };
  const global: any = { mcpBridgeExternalDriver: true, mcpCheckTaskId: 123 };
  const context = {
    app,
    $: { global, getenv: () => "/bridge" },
    File,
    Folder,
    Window: class {},
    Panel: class {},
    CompItem: class {},
  };
  runInNewContext(source, context);
  const commandFile = "/bridge/ae_command.json";
  const resultFile = "/bridge/ae_mcp_result.json";
  function send(id: string, deadline: number = Date.now() + 60000) {
    files.set(
      commandFile,
      JSON.stringify({
        commandId: id,
        expiresAt: deadline,
        command: "executeScript",
        args: {
          description: "Update the test project",
          script: "app.project.edits++; return 'Стекло 🧦';",
        },
      }),
    );
  }
  function result() {
    return JSON.parse(files.get(resultFile) || "null");
  }
  return { files, app, global, send, result, commandFile, resultFile };
}

describe("CEP host using the actual ExtendScript source", () => {
  it("cancels the old timer and creates no scheduleTask in external mode", () => {
    const h = host();
    expect(h.app.cancelTask).toHaveBeenCalledWith(123);
    expect(h.app.scheduleTask).not.toHaveBeenCalled();
    expect(h.global.mcpCheckTaskId).toBeNull();
    expect(JSON.parse(h.global.mcpExternalBridge.info()).transport).toBe("cep");
  });
  it("executes once, preserves Unicode and echoes the request id", () => {
    const h = host();
    h.send("one");
    expect(h.global.mcpExternalBridge.dispatch("one")).toBe("executed");
    h.global.mcpExternalBridge.dispatch("one");
    expect(h.app.project.edits).toBe(1);
    expect(h.result()).toMatchObject({ status: "success", result: "Стекло 🧦", _commandId: "one" });
    expect(h.files.get(h.resultFile)).toMatch(/\\uD83E\\uDDE6/);
  });
  it("rejects a command that expired behind a modal without editing the project", () => {
    const h = host();
    h.send("expired", Date.now() - 1);
    expect(h.global.mcpExternalBridge.dispatch("expired")).toBe("expired");
    expect(h.app.project.edits).toBe(0);
    expect(h.result()).toMatchObject({ status: "error", executed: false, _commandId: "expired" });
    h.send("next");
    expect(h.global.mcpExternalBridge.dispatch("next")).toBe("executed");
    expect(h.app.project.edits).toBe(1);
  });
  it("a delayed old dispatch cannot consume a newer command", () => {
    const h = host();
    h.send("new");
    expect(h.global.mcpExternalBridge.dispatch("old")).toBe("changed");
    expect(h.app.project.edits).toBe(0);
    expect(h.global.mcpExternalBridge.dispatch("new")).toBe("executed");
  });
  it("requires deadlines when a client still runs the old MCP server", () => {
    const h = host();
    h.files.set(
      h.commandFile,
      JSON.stringify({
        commandId: "old",
        command: "executeScript",
        args: { script: "app.project.edits++;" },
      }),
    );
    expect(h.global.mcpExternalBridge.dispatch("old")).toBe("rejected");
    expect(h.app.project.edits).toBe(0);
    expect(h.result().error).toContain("deadlines");
  });
  it("ignores files present before a panel reload", () => {
    const h = host({
      commandId: "stale",
      command: "executeScript",
      expiresAt: Date.now() + 60000,
      args: { script: "app.project.edits++;" },
    });
    const info = h.global.mcpExternalBridge.info();
    expect(JSON.parse(info).lastCommandId).toBe("stale");
    h.global.mcpExternalBridge.dispatch("stale");
    expect(h.app.project.edits).toBe(0);
  });
});

function driverHarness() {
  let command: any = null;
  let result: any = null;
  let clock = 1000;
  const dispatch = vi.fn(async () => "executed");
  const options = {
    now: () => clock,
    readCommand: () => command,
    readResult: () => result,
    writeResult: (value: any) => {
      result = value;
    },
    onStatus: vi.fn(),
    onEvent: vi.fn(),
    dispatch,
  };
  return {
    driver: createDriver(options),
    options,
    dispatch,
    send: (
      id: string,
      expiresAt = 2000,
      args: Record<string, unknown> = { description: "Inspect active composition" },
      name = "executeScript",
    ) => {
      command = { commandId: id, command: name, expiresAt, args };
    },
    setResult: (value: any) => {
      result = value;
    },
    result: () => result,
    setClock: (value: number) => {
      clock = value;
    },
  };
}

describe("CEP file polling", () => {
  it("makes zero AE calls through hundreds of idle polls", async () => {
    const h = driverHarness();
    for (let i = 0; i < 300; i++) await h.driver.tick();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.options.onEvent).not.toHaveBeenCalled();
  });
  it("serializes requests and never retries an uncertain evalScript failure", async () => {
    const h = driverHarness();
    let resolve!: (value: string) => void;
    h.dispatch.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    h.send("one");
    const pending = h.driver.tick();
    await h.driver.tick();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    resolve("EvalScript error.");
    await pending;
    await h.driver.tick();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.result().error).toContain("not automatically retried");
  });
  it("rejects expired requests without calling AE", async () => {
    const h = driverHarness();
    h.send("one", 999);
    await h.driver.tick();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.result().error).toContain("expired before dispatch");
  });
  it("does not overwrite a newer result when an old callback finally arrives", async () => {
    const h = driverHarness();
    let resolve!: (value: string) => void;
    h.dispatch.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    h.send("old");
    const pending = h.driver.tick();
    h.send("new");
    h.setResult({ _commandId: "new", status: "success" });
    resolve("changed");
    await pending;
    expect(h.result()).toEqual({ _commandId: "new", status: "success" });
  });
  it("pause prevents dispatch and resume handles a fresh command", async () => {
    const h = driverHarness();
    h.send("one");
    h.driver.setPaused(true);
    await h.driver.tick();
    expect(h.dispatch).not.toHaveBeenCalled();
    h.driver.setPaused(false);
    await h.driver.tick();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });
  it("checks the deadline again inside AE after a simulated modal hold", async () => {
    const h = host();
    h.send("held");
    const dispatch = vi.fn(async (id: string) => {
      // Simulate AE releasing a queued evalScript only after the caller expired.
      const command = JSON.parse(h.files.get(h.commandFile)!);
      command.expiresAt = Date.now() - 1;
      h.files.set(h.commandFile, JSON.stringify(command));
      return h.global.mcpExternalBridge.dispatch(id);
    });
    const driver = createDriver({
      readCommand: () => JSON.parse(h.files.get(h.commandFile)!),
      readResult: h.result,
      writeResult: (result: any) => h.files.set(h.resultFile, JSON.stringify(result)),
      onStatus: vi.fn(),
      dispatch,
    });
    await driver.tick();
    expect(h.app.project.edits).toBe(0);
    expect(h.result()).toMatchObject({ status: "error", executed: false });
    h.send("fresh");
    dispatch.mockImplementationOnce(async (id) => h.global.mcpExternalBridge.dispatch(id));
    await driver.tick();
    expect(h.app.project.edits).toBe(1);
  });

  it("reports command start and completion once, with the actual elapsed time", async () => {
    const h = driverHarness();
    h.send("one");
    h.dispatch.mockImplementationOnce(async () => {
      h.setClock(1250);
      h.setResult({ _commandId: "one", status: "success" });
      return "executed";
    });
    await h.driver.tick();
    await h.driver.tick();
    expect(h.options.onEvent.mock.calls.map(([event]) => event)).toEqual([
      {
        type: "started",
        time: 1000,
        command: "executeScript",
        label: "Inspect active composition",
        commandId: "one",
        message: "",
        durationMs: 0,
      },
      {
        type: "succeeded",
        time: 1250,
        command: "executeScript",
        label: "Inspect active composition",
        commandId: "one",
        message: "",
        durationMs: 250,
      },
    ]);
  });

  it("logs an expired command as rejected without dispatching it", async () => {
    const h = driverHarness();
    h.send("late", 999);
    await h.driver.tick();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.options.onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "rejected", commandId: "late" }),
    );
  });

  it("reports a caller's action label without exposing arbitrary script source", async () => {
    const h = driverHarness();
    h.send("one", 2000, { description: "Create a square", script: "secretScriptSource();" });
    h.setResult({ _commandId: "one", status: "success" });
    await h.driver.tick();
    expect(h.options.onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "succeeded", label: "Create a square" }),
    );
    expect(JSON.stringify(h.options.onEvent.mock.calls)).not.toContain("secretScriptSource");
  });

  it("accepts an explicit first-line label from older clients, but never guesses from code", async () => {
    const h = driverHarness();
    h.send("one", 2000, {
      script: "// @mcp-label: Inspect composition\nreturn app.project.activeItem.name;",
    });
    h.setResult({ _commandId: "one", status: "success" });
    await h.driver.tick();
    expect(h.options.onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "Inspect composition" }),
    );
    h.send("two", 2000, { script: "if (false) app.project.activeItem.layers.addShape();" });
    h.setResult(null);
    await h.driver.tick();
    expect(h.options.onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "rejected", label: "Describe script action" }),
    );
    expect(h.result()).toMatchObject({ executed: false, code: "ACTION_DESCRIPTION_REQUIRED" });
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it.each([
    {},
    { description: "Run script" },
    { description: "Execute code" },
    { description: "Сохранить рабочую копию проекта для двух состояний истории" },
    { description: "Save рабочую копию" },
    { script: "// @mcp-label: Сохранить проект\nsecretScriptSource();" },
  ])("asks legacy clients to describe their action before dispatch: %j", async (args) => {
    const h = driverHarness();
    h.send("one", 2000, args);
    await h.driver.tick();
    await h.driver.tick();
    expect(h.options.onEvent).toHaveBeenCalledTimes(1);
    expect(h.options.onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "rejected", label: "Describe script action" }),
    );
    expect(h.result()).toMatchObject({
      status: "error",
      executed: false,
      code: "ACTION_DESCRIPTION_REQUIRED",
    });
    expect(h.result().error).toContain("specific English action description");
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(h.options.onEvent.mock.calls)).not.toContain("secretScriptSource");
  });

  it("executes a corrected request once without replaying the rejected edit", async () => {
    const h = driverHarness();
    h.send("invalid", 2000, { description: "Run script" });
    await h.driver.tick();
    expect(h.dispatch).not.toHaveBeenCalled();
    h.send("corrected", 2000, { description: "Stagger the text layers from top to bottom" });
    h.dispatch.mockImplementationOnce(async () => {
      h.setResult({ _commandId: "corrected", status: "success" });
      return "executed";
    });
    await h.driver.tick();
    await h.driver.tick();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.dispatch).toHaveBeenCalledWith("corrected");
    expect(h.options.onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "succeeded",
        label: "Stagger the text layers from top to bottom",
      }),
    );
  });

  it("retains the known internal save step used by older background-render clients", async () => {
    const h = driverHarness();
    h.send("save", 2000, {
      script:
        "if (app.project.file) { app.project.save(); return app.project.file.fsName; } else { return null; }",
    });
    h.setResult({ _commandId: "save", status: "success" });
    await h.driver.tick();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.options.onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "Save the project before starting the background render" }),
    );
  });

  it("preserves a quoted object name in an English action", async () => {
    const h = driverHarness();
    h.send("one", 2000, { description: 'Create layer "Квадрат"' });
    h.setResult({ _commandId: "one", status: "success" });
    await h.driver.tick();
    expect(h.options.onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: 'Create layer "Квадрат"' }),
    );
  });

  it("names a built-in effect operation without including its settings or script", async () => {
    const h = driverHarness();
    h.send(
      "one",
      2000,
      { effectName: "Gaussian Blur", effectSettings: { hiddenValue: 123 } },
      "applyEffect",
    );
    h.setResult({ _commandId: "one", status: "success" });
    await h.driver.tick();
    expect(h.options.onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "Apply effect · Gaussian Blur" }),
    );
    expect(JSON.stringify(h.options.onEvent.mock.calls)).not.toContain("hiddenValue");
  });

  it("recognizes an AE error payload even without status:error", async () => {
    const h = driverHarness();
    h.send("one");
    h.dispatch.mockImplementationOnce(async () => {
      h.setResult({ _commandId: "one", error: "Layer is locked" });
      return "executed";
    });
    await h.driver.tick();
    expect(h.options.onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "failed", message: "Layer is locked" }),
    );
    expect(h.options.onStatus).toHaveBeenLastCalledWith("Command failed. See history.");
  });

  it("a history callback failure cannot block or retry an edit", async () => {
    const h = driverHarness();
    h.options.onEvent.mockImplementation(() => {
      throw new Error("History unavailable");
    });
    h.send("one");
    h.dispatch.mockImplementationOnce(async () => {
      h.setResult({ _commandId: "one", status: "success" });
      return "executed";
    });
    await h.driver.tick();
    await h.driver.tick();
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.options.onStatus).toHaveBeenLastCalledWith("Ready");
  });
});
