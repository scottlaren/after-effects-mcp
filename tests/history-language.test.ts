import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  SETTINGS_FILE,
  readHistoryLanguage,
  writeHistoryLanguage,
} = require("../src/cep/history-settings.cjs");
const { isActionLabel, getScriptActionLabel } = require("../src/cep/action-label.cjs");
let folder: string;
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "ae-history-language-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(folder, { recursive: true, force: true });
});

describe("command language preference", () => {
  it("defaults to English when settings are missing, malformed or unsupported", () => {
    expect(readHistoryLanguage(folder)).toBe("en");
    for (const text of ["{broken", "null", "[]", '{"historyLanguage":"de"}']) {
      fs.writeFileSync(path.join(folder, SETTINGS_FILE), text);
      expect(readHistoryLanguage(folder)).toBe("en");
    }
  });
  it("persists changes, preserves unrelated settings and reads fresh values", () => {
    fs.writeFileSync(path.join(folder, SETTINGS_FILE), '\uFEFF{"futureOption":42}');
    writeHistoryLanguage(folder, "ru");
    expect(readHistoryLanguage(folder)).toBe("ru");
    expect(JSON.parse(fs.readFileSync(path.join(folder, SETTINGS_FILE), "utf8"))).toEqual({
      futureOption: 42,
      historyLanguage: "ru",
    });
    writeHistoryLanguage(folder, "en");
    expect(readHistoryLanguage(folder)).toBe("en");
    expect(fs.readdirSync(folder)).toEqual([SETTINGS_FILE]);
  });
  it("keeps the previous preference and cleans temporary files if replacing it fails", () => {
    writeHistoryLanguage(folder, "ru");
    vi.spyOn(require("fs"), "renameSync").mockImplementation(() => {
      throw new Error("Access denied");
    });
    expect(() => writeHistoryLanguage(folder, "en")).toThrow("Access denied");
    expect(readHistoryLanguage(folder)).toBe("ru");
    expect(fs.readdirSync(folder)).toEqual([SETTINGS_FILE]);
  });
  it("refuses unsupported writes without altering the preference", () => {
    writeHistoryLanguage(folder, "ru");
    expect(() => writeHistoryLanguage(folder, "de")).toThrow("Unsupported");
    expect(readHistoryLanguage(folder)).toBe("ru");
  });
});

describe("specific action descriptions", () => {
  it.each([
    "Run script",
    "Execute code",
    "Запустить скрипт",
    "Выполнение скрипта",
    "Выполнить код",
    "Запускаю скрипт",
  ])("rejects generic placeholders in either language: %s", (label) => {
    expect(isActionLabel(label, "en")).toBe(false);
    expect(isActionLabel(label, "ru")).toBe(false);
  });
  it("retains specific Russian intent, technical terms and quoted object names", () => {
    expect(isActionLabel('Проверить тайминг UI и слоя "Wallet"', "ru")).toBe(true);
    expect(isActionLabel('Проверить тайминг UI и слоя "Wallet"', "en")).toBe(false);
    expect(isActionLabel('Inspect layer "Квадрат"', "en")).toBe(true);
    expect(isActionLabel('Inspect layer "Квадрат"', "ru")).toBe(false);
    expect(
      getScriptActionLabel(
        { script: "// @mcp-label: Проверить выражения слоёв\nreturn null;" },
        "ru",
      ),
    ).toBe("Проверить выражения слоёв");
    expect(
      getScriptActionLabel(
        { description: "Запустить скрипт", script: "app.project.save();" },
        "ru",
      ),
    ).toBe("");
  });
  it("localizes the exact legacy background-save operation without guessing about arbitrary code", () => {
    expect(
      getScriptActionLabel(
        {
          script:
            "if (app.project.file) { app.project.save(); return app.project.file.fsName; } else { return null; }",
        },
        "ru",
      ),
    ).toBe("Сохранить проект перед фоновым рендерингом");
    expect(getScriptActionLabel({ script: "app.project.save(); return null;" }, "ru")).toBe("");
  });
});
