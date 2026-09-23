const states = {
  started: "Running",
  succeeded: "Done",
  failed: "Failed",
  rejected: "Skipped",
  uncertain: "Result unknown",
  info: "Info",
};

function exportHistory(entries, fileSystem, exportedAt = new Date()) {
  if (!entries.length) return false;
  if (!fileSystem || typeof fileSystem.showSaveDialogEx !== "function") {
    throw new Error("The Save dialog is unavailable. Reopen MCP Bridge inside After Effects.");
  }
  // Snapshot only the history fields, including clipped rows. Never serialize DOM,
  // command arguments, script source or result payloads.
  const lines = [
    "MCP Bridge - Command history",
    "Exported: " + exportedAt.toISOString(),
    "Entries: " + entries.length + " (newest first; timestamps in UTC)",
    "",
  ];
  entries.forEach((entry) => {
    const duration =
      entry.type !== "started" && Number.isFinite(entry.durationMs)
        ? " | " + (entry.durationMs / 1000).toFixed(2) + " s"
        : "";
    lines.push(
      "[" +
        new Date(entry.time).toISOString() +
        "] " +
        (states[entry.type] || states.info) +
        " | " +
        entry.label +
        duration,
    );
    if (entry.message) lines.push("  " + String(entry.message).replace(/\r?\n/g, "\r\n  "));
  });
  const text = lines.join("\r\n") + "\r\n";
  const fileName = "mcp-bridge-history-" + exportedAt.toISOString().replace(/[:.]/g, "-") + ".txt";
  const selection = fileSystem.showSaveDialogEx(
    "Export command history",
    "",
    ["txt"],
    fileName,
    "Text files (*.txt)",
  );
  if (!selection || selection.err) {
    throw new Error(
      "Could not open the Save dialog" + (selection ? " (error " + selection.err + ")" : "") + ".",
    );
  }
  if (!selection.data) return false;
  // Use the exact path confirmed by the native dialog, including overwrite consent.
  const result = fileSystem.writeFile(selection.data, text, "UTF-8");
  if (!result || result.err) {
    throw new Error(
      "Could not save history. Check folder permissions and free space" +
        (result ? " (error " + result.err + ")" : "") +
        ".",
    );
  }
  return true;
}

module.exports = { exportHistory };
