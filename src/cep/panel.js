/* global window, document, cep_node */
(function () {
  "use strict";
  var status = document.getElementById("status");
  var version = document.getElementById("version");
  var bridgeFolder = document.getElementById("bridge-folder");
  var button = document.getElementById("pause");
  var history = document.getElementById("history");
  var clearHistory = document.getElementById("clear-history");
  var exportHistoryButton = document.getElementById("export-history");
  var languageButtons = [
    document.getElementById("language-en"),
    document.getElementById("language-ru"),
  ];
  // History belongs to this panel instance, never to a previous session.
  var historyEntries = [];
  var maxHistory = 200;
  var driver;
  var connected = false;
  var paused = false;

  // CEP provides native theme colors without invoking an ExtendScript command.
  var cep = window.__adobe_cep__;
  function syncHostTheme() {
    try {
      var skin = JSON.parse(cep.getHostEnvironment()).appSkinInfo;
      var panelColor = skin.panelBackgroundColorSRGB || skin.panelBackgroundColor;
      var color = panelColor.color;
      var channels = [color.red, color.green, color.blue];
      if (
        !channels.every(function (value) {
          return typeof value === "number" && isFinite(value);
        })
      )
        return;
      channels = channels.map(function (value) {
        return Math.round(Math.max(0, Math.min(255, value)));
      });
      var style = document.documentElement.style;
      style.setProperty("--host-panel-background", "rgb(" + channels.join(", ") + ")");
      function linear(value) {
        value /= 255;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      }
      var luminance =
        linear(channels[0]) * 0.2126 + linear(channels[1]) * 0.7152 + linear(channels[2]) * 0.0722;
      function readableGray(value) {
        var textLuminance = linear(value);
        var contrast =
          (Math.max(luminance, textLuminance) + 0.05) / (Math.min(luminance, textLuminance) + 0.05);
        return contrast >= 4.5
          ? "rgb(" + [value, value, value].join(", ") + ")"
          : luminance > 0.179
            ? "#000"
            : "#fff";
      }
      // Only outer chrome follows the host. The history retains its dark surface.
      style.setProperty("--host-panel-text", readableGray(188));
      style.setProperty("--host-panel-strong", readableGray(209));
      style.setProperty("--host-panel-muted", readableGray(160));
    } catch {
      /* Theme information is optional; retain the native-gray CSS fallback. */
    }
  }
  syncHostTheme();
  if (cep && typeof cep.addEventListener === "function") {
    try {
      cep.addEventListener("com.adobe.csxs.events.ThemeColorChanged", syncHostTheme);
    } catch {
      /* An unavailable theme listener must never prevent bridge startup. */
    }
  }

  // This panel is a non-selectable activity display, including keyboard copy.
  ["selectstart", "copy"].forEach(function (type) {
    document.addEventListener(type, function (event) {
      event.preventDefault();
    });
  });

  try {
    window.localStorage.removeItem("ae-mcp-command-history-v1");
  } catch {
    /* Removing history saved by older versions is best effort. */
  }

  function renderEntry(entry) {
    var states = {
      started: "Running",
      succeeded: "Done",
      failed: "Failed",
      rejected: "Skipped",
      uncertain: "Result unknown",
      info: "Info",
    };
    var state = states[entry.type] || states.info;
    var row = entry.row;
    row.className = "history-entry history-" + entry.type;
    row.textContent = "";
    function cell(className, text) {
      var element = document.createElement("span");
      element.className = className;
      // Project names and caller-provided labels are untrusted text, never HTML.
      element.textContent = text;
      row.appendChild(element);
      return element;
    }
    cell("entry-time", new Date(entry.time).toLocaleTimeString([], { hour12: false }));
    var label = cell("entry-label", entry.label);
    // Keep the state available to assistive technology without a visible badge.
    var accessibleState = document.createElement("span");
    accessibleState.className = "sr-only";
    accessibleState.textContent = state + ": ";
    label.insertBefore(accessibleState, label.firstChild);
    var duration =
      entry.type !== "started" && entry.durationMs !== undefined
        ? (entry.durationMs / 1000).toFixed(2) + " s"
        : "";
    cell("entry-duration", duration);
    if (entry.message) cell("entry-message", entry.message);
  }
  function recordHistory(event) {
    var entry;
    if (event.commandId) {
      entry = historyEntries.find(function (item) {
        return item.commandId === event.commandId;
      });
    }
    if (!entry) {
      entry = {
        commandId: event.commandId,
        time: event.time === undefined ? Date.now() : event.time,
        row: document.createElement("div"),
      };
      historyEntries.unshift(entry);
      history.insertBefore(entry.row, history.firstChild);
    }
    entry.type = event.type || "info";
    entry.label = String(event.label || "Command").slice(0, 320);
    entry.message = event.message ? String(event.message).slice(0, 2000) : "";
    entry.durationMs = event.durationMs;
    renderEntry(entry);
    while (historyEntries.length > maxHistory) {
      history.removeChild(historyEntries.pop().row);
    }
    clearHistory.disabled = false;
    exportHistoryButton.disabled = false;
  }
  function addHistory(message) {
    recordHistory({ type: "info", label: message });
  }
  clearHistory.onclick = function () {
    historyEntries = [];
    history.textContent = "";
    clearHistory.disabled = true;
    exportHistoryButton.disabled = true;
    status.textContent = !connected
      ? "Not connected"
      : paused
        ? "Paused"
        : driver.isBusy()
          ? "Running"
          : "Ready";
  };
  function logEvent(event) {
    recordHistory(event);
  }
  var nodeRequire = typeof cep_node !== "undefined" ? cep_node.require : window.require;
  if (!nodeRequire || !window.__adobe_cep__) {
    status.textContent = "Not connected";
    addHistory("Open this panel inside After Effects.");
    return;
  }
  var fs = nodeRequire("fs");
  var path = nodeRequire("path");
  var fileURLToPath = nodeRequire("url").fileURLToPath;
  var root = path.dirname(fileURLToPath(window.location.href.split("?")[0]));
  var createDriver = nodeRequire(path.join(root, "driver.cjs")).createDriver;
  var exportHistory = nodeRequire(path.join(root, "history-export.cjs")).exportHistory;
  var historySettings = nodeRequire(path.join(root, "history-settings.cjs"));

  exportHistoryButton.onclick = function () {
    if (!historyEntries.length) return;
    // Keep new commands out of AE while the native Save dialog is open.
    if (driver) driver.setPaused(true);
    try {
      if (exportHistory(historyEntries, window.cep && window.cep.fs)) {
        var previousStatus = status.textContent;
        status.textContent = "History exported";
        window.setTimeout(function () {
          if (status.textContent === "History exported") status.textContent = previousStatus;
        }, 3000);
      }
    } catch (error) {
      status.textContent = "Export failed";
      recordHistory({
        type: "failed",
        label: "Export history",
        message: String(error.message || error),
      });
    } finally {
      if (driver) driver.setPaused(paused);
    }
  };

  function evalScript(script) {
    return new Promise(function (resolve) {
      window.__adobe_cep__.evalScript(script, resolve);
    });
  }
  function readJson(file) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    } catch {
      return null;
    }
  }
  var bridgePath = path.join(root, "mcp-bridge-auto.jsx").replace(/\\/g, "/");
  // One bootstrap on opening the panel. No host heartbeat or idle evalScript.
  var bootstrap =
    "(function(){try{$.global.mcpBridgeExternalDriver=true;" +
    "$.evalFile(new File(" +
    JSON.stringify(bridgePath) +
    "));" +
    "return $.global.mcpExternalBridge.info();" +
    "}catch(e){return JSON.stringify({error:String(e)});}" +
    "finally{$.global.mcpBridgeExternalDriver=false;}})()";
  evalScript(bootstrap).then(function (reply) {
    var info;
    try {
      info = JSON.parse(reply);
    } catch {
      info = { error: reply };
    }
    if (!info || info.error || !info.bridgeFolder) {
      status.textContent = "Connection failed";
      recordHistory({
        type: "failed",
        label: "Connection failed",
        message:
          ((info && info.error) || "No bridge response") +
          ". Close dialogs, then reopen this panel.",
      });
      return;
    }
    var commandFile = path.join(info.bridgeFolder, "ae_command.json");
    var resultFile = path.join(info.bridgeFolder, "ae_mcp_result.json");
    function syncHistoryLanguage() {
      var language = historySettings.readHistoryLanguage(info.bridgeFolder);
      languageButtons.forEach(function (control) {
        control.setAttribute("aria-pressed", String(control.id === "language-" + language));
      });
      return language;
    }
    syncHistoryLanguage();
    languageButtons.forEach(function (control) {
      control.disabled = false;
      control.onclick = function () {
        try {
          historySettings.writeHistoryLanguage(
            info.bridgeFolder,
            control.id === "language-ru" ? "ru" : "en",
          );
        } catch (error) {
          recordHistory({
            type: "failed",
            label: "Save command language",
            message: String(error.message || error),
          });
        }
        syncHistoryLanguage();
      };
    });
    driver = createDriver({
      lastId: info.lastCommandId,
      getHistoryLanguage: syncHistoryLanguage,
      readCommand: function () {
        return readJson(commandFile);
      },
      readResult: function () {
        return readJson(resultFile);
      },
      writeResult: function (result) {
        var temp = resultFile + ".cep.tmp";
        fs.writeFileSync(temp, JSON.stringify(result), "utf8");
        fs.renameSync(temp, resultFile);
      },
      dispatch: function (id) {
        return evalScript("$.global.mcpExternalBridge.dispatch(" + JSON.stringify(id) + ")");
      },
      onStatus: function (message) {
        status.textContent = paused ? "Paused" : message.replace(/\. See history\.$/, "");
      },
      onEvent: logEvent,
    });
    connected = true;
    status.textContent = "Ready";
    version.textContent = info.version;
    bridgeFolder.textContent = info.bridgeFolder;
    button.disabled = false;
    addHistory("Connected to After Effects");
    button.onclick = function () {
      paused = !paused;
      driver.setPaused(paused);
      button.classList.toggle("is-paused", paused);
      button.setAttribute("aria-label", paused ? "Resume commands" : "Pause new commands");
      button.title = paused
        ? "Resume commands"
        : "Pause new commands; the active command may still finish";
      status.textContent = paused ? "Paused" : driver.isBusy() ? "Running" : "Ready";
      addHistory(paused ? "Paused · active command may still finish" : "Resumed");
    };
    var timer = window.setInterval(function () {
      driver.tick().catch(function (error) {
        status.textContent = "Bridge error";
        // Filesystem failures can repeat every poll; log a given failure once.
        if (lastPollError !== String(error)) {
          lastPollError = String(error);
          recordHistory({ type: "failed", label: "Bridge error", message: lastPollError });
        }
      });
    }, 100);
    var lastPollError = "";
    window.addEventListener("unload", function () {
      window.clearInterval(timer);
      driver.setPaused(true);
    });
  });
})();
