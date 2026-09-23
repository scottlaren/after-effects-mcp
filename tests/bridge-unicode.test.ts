import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type ResultFileSafe = (jsonText: string) => string;

function readBridgeSource(): string {
  const bridgePath = fileURLToPath(new URL("../src/scripts/mcp-bridge-auto.jsx", import.meta.url));
  return readFileSync(bridgePath, "utf8");
}

function loadResultFileSafe(): ResultFileSafe {
  const source = readBridgeSource();
  const start = source.indexOf("function makeResultFileSafe");
  const end = source.indexOf("\nvar aeVersion", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  const functionSource = source.slice(start, end);
  return new Function(functionSource + "\nreturn makeResultFileSafe;")() as ResultFileSafe;
}

describe("bridge result-file Unicode safety", () => {
  it("writes non-BMP layer names as ASCII JSON escapes without changing the value", () => {
    const makeResultFileSafe = loadResultFileSafe();
    const original = { name: "Decorative 🧦", status: "success" };
    const safe = makeResultFileSafe(JSON.stringify(original));

    expect(safe).toMatch(/\\uD83E\\uDDE6/);
    expect([...safe].every((character) => character.charCodeAt(0) <= 0x7e)).toBe(true);
    expect(JSON.parse(safe)).toEqual(original);
  });

  it("round-trips BMP Unicode used by localized layer names", () => {
    const makeResultFileSafe = loadResultFileSafe();
    const original = { name: "Стекло — زجاج" };
    const safe = makeResultFileSafe(JSON.stringify(original));

    expect(JSON.parse(safe)).toEqual(original);
  });

  it("sanitizes the final payload before opening the result file", () => {
    const source = readBridgeSource();
    const sanitize = source.indexOf("resultString = makeResultFileSafe(resultString);");
    const openResult = source.indexOf("var resultFile = new File", sanitize);

    expect(sanitize).toBeGreaterThanOrEqual(0);
    expect(openResult).toBeGreaterThan(sanitize);
  });
});

describe("bridge auto-run lifecycle", () => {
  it("dispatches scheduled checks through a replaceable global callback", () => {
    const source = readBridgeSource();

    expect(source).toContain("$.global.mcpBridgeCheckForCommands = function ()");
    expect(source).toContain(
      'app.scheduleTask("$.global.mcpBridgeCheckForCommands()", checkInterval, true)',
    );
    expect(source).not.toContain('app.scheduleTask("checkForCommands()", checkInterval, true)');
  });
});
