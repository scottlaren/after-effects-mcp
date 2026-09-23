import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { exportHistory } = require("../src/cep/history-export.cjs");
const time = Date.parse("2026-09-23T15:30:00.000Z");
const entry = { time, type: "succeeded", label: 'Create layer "Квадрат"', durationMs: 1250 };

function fileSystem(selection = { err: 0, data: "C:/Exports/history.txt" }) {
  return {
    showSaveDialogEx: vi.fn(() => selection),
    writeFile: vi.fn(() => ({ err: 0 })),
  };
}

describe("session history export", () => {
  it("exports every retained row, Unicode, outcomes and errors without internal payloads", () => {
    const fs = fileSystem();
    const entries = Array.from({ length: 200 }, (_, index) => ({
      ...entry,
      time: time - index * 1000,
      label: index === 0 ? entry.label : "Inspect layer " + index,
      row: { secretDom: "not exported" },
      args: { script: "secretScriptSource()" },
    }));
    const history = [
      { ...entries[0], type: "started" },
      { ...entries[1], type: "failed", message: "Layer is locked.\nUnlock it first." },
      ...entries.slice(2),
    ];
    expect(exportHistory(history, fs, new Date(time))).toBe(true);
    const [savedPath, text, encoding] = fs.writeFile.mock.calls[0] as unknown as string[];
    expect(savedPath).toBe("C:/Exports/history.txt");
    expect(encoding).toBe("UTF-8");
    expect(text).toContain("Entries: 200 (newest first; timestamps in UTC)");
    expect(text).toContain('Running | Create layer "Квадрат"\r\n');
    expect(text).toContain("Failed | Inspect layer 1 | 1.25 s");
    expect(text).toContain("  Layer is locked.\r\n  Unlock it first.");
    expect(text).toContain("Done | Inspect layer 199 | 1.25 s");
    expect(text.indexOf("Inspect layer 1 | ")).toBeLessThan(text.indexOf("Inspect layer 199 | "));
    expect(text).not.toMatch(/secretDom|not exported|secretScriptSource/);
  });

  it("takes a snapshot before opening the dialog and writes to the exact confirmed path", () => {
    const history = [{ ...entry, type: "started" }];
    const fs = fileSystem();
    fs.showSaveDialogEx.mockImplementation(() => {
      history[0].type = "succeeded";
      return { err: 0, data: "C:/Exports/user-selected-name.log" };
    });
    exportHistory(history, fs, new Date(time));
    expect(fs.writeFile).toHaveBeenCalledWith(
      "C:/Exports/user-selected-name.log",
      expect.stringContaining("Running | "),
      "UTF-8",
    );
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
  });

  it("cancels without writing a file", () => {
    const fs = fileSystem({ err: 0, data: "" });
    expect(exportHistory([entry], fs)).toBe(false);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("does not open a dialog for empty history", () => {
    const fs = fileSystem();
    expect(exportHistory([], fs)).toBe(false);
    expect(fs.showSaveDialogEx).not.toHaveBeenCalled();
  });

  it("reports a dialog failure without writing", () => {
    const fs = fileSystem({ err: 2, data: "" });
    expect(() => exportHistory([entry], fs)).toThrow("Could not open the Save dialog");
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("reports write failures instead of claiming success", () => {
    const fs = fileSystem();
    fs.writeFile.mockReturnValue({ err: 6 });
    expect(() => exportHistory([entry], fs)).toThrow("Could not save history");
  });

  it("reports an unavailable native dialog without falling back to ExtendScript", () => {
    expect(() => exportHistory([entry], undefined)).toThrow("Save dialog is unavailable");
  });
});
