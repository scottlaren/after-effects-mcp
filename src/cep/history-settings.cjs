const fs = require("fs");
const path = require("path");

const SETTINGS_FILE = "ae_mcp_settings.json";

function readSettings(bridgeFolder) {
  try {
    const value = JSON.parse(
      fs.readFileSync(path.join(bridgeFolder, SETTINGS_FILE), "utf8").replace(/^\uFEFF/, ""),
    );
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function readHistoryLanguage(bridgeFolder) {
  return readSettings(bridgeFolder).historyLanguage === "ru" ? "ru" : "en";
}

function writeHistoryLanguage(bridgeFolder, language) {
  if (language !== "en" && language !== "ru") throw new Error("Unsupported command language");
  const file = path.join(bridgeFolder, SETTINGS_FILE);
  const temporary = file + "." + Date.now() + "." + Math.random().toString(16).slice(2) + ".tmp";
  const settings = { ...readSettings(bridgeFolder), historyLanguage: language };
  try {
    fs.writeFileSync(temporary, JSON.stringify(settings, null, 2) + "\n", "utf8");
    fs.renameSync(temporary, file);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      /* Already renamed, or never created. */
    }
  }
}

module.exports = { SETTINGS_FILE, readHistoryLanguage, writeHistoryLanguage };
