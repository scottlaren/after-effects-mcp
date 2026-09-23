/* Poll files in CEP's JavaScript runtime, never in AE's ExtendScript scheduler. */
const { ACTION_LABEL_ERROR, getScriptActionLabel } = require("./action-label.cjs");

function describeCommand(command) {
  const args = command.args || {};
  function shortText(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  }
  if (command.command === "executeScript") {
    // Explicit intent only: never guess what arbitrary code actually changes.
    return getScriptActionLabel(args) || "Describe script action";
  }
  const labels = {
    ping: "Check connection",
    getProjectInfo: "Inspect project",
    listCompositions: "List compositions",
    getLayerInfo: "Inspect layer",
    createComposition: "Create composition",
    createTextLayer: "Create text layer",
    createShapeLayer: "Create shape layer",
    createSolidLayer: "Create solid layer",
    createAdjustmentLayer: "Create adjustment layer",
    createCamera: "Create camera",
    localizeComp: "Translate composition",
    populateTemplate: "Populate template",
    listProjectItems: "List project items",
    importFootage: "Import footage",
    relinkFootage: "Relink footage",
    setLayerProperties: "Update layer",
    batchSetLayerProperties: "Update layers",
    setCompositionProperties: "Update composition",
    setLayerKeyframe: "Set keyframe",
    setLayerExpression: "Set expression",
    applyEffect: "Apply effect",
    applyEffectTemplate: "Apply effect template",
    listLayerEffects: "List layer effects",
    listAvailableEffects: "List available effects",
    setEffectProperty: "Update effect",
    setEffectKeyframe: "Animate effect",
    animateToAudio: "Animate to audio",
    setPropertyKeyframesBatch: "Set keyframes",
    applyLayerPreset: "Apply preset",
    centerLayers: "Center layers",
    getLayerClipFrames: "Inspect clip timing",
    getLayerAudioInfo: "Inspect audio",
    addMarkersFromArray: "Add markers",
    addMarker: "Add marker",
    setLayerAudioLevels: "Set audio levels",
    removeLayerEffect: "Remove effect",
    bridgeTestEffects: "Test effects",
    seeFrame: "Capture frame",
    contactSheet: "Capture contact sheet",
    matchReference: "Compare reference",
    getLayerFull: "Inspect layer",
    getCompFull: "Inspect composition",
    duplicateLayer: "Duplicate layer",
    deleteLayer: "Delete layer",
    setLayerMask: "Set mask",
    setLayerParent: "Set parent",
    reorderLayer: "Reorder layer",
    precomposeLayers: "Precompose layers",
    addToRenderQueue: "Add to render queue",
    manageRenderQueue: "Manage render queue",
    startRender: "Render composition",
  };
  const label = Object.prototype.hasOwnProperty.call(labels, command.command)
    ? labels[command.command]
    : "Run command";
  const subject =
    command.command === "applyEffect" || command.command === "removeLayerEffect"
      ? args.effectName || args.effectMatchName || args.effect || args.effectIdentifier
      : args.layerName || args.name || args.compName;
  const detail = shortText(subject);
  return detail ? label + " · " + detail : label;
}

function createDriver(options) {
  const now = options.now || Date.now;
  let lastId = options.lastId || "";
  let busy = false;
  let paused = false;

  // Logging is observational: a broken history renderer must never interrupt,
  // retry or change a command. Events carry only a bounded display label, never
  // script source or the full arguments/result payload.
  function emit(type, command, message, startedAt) {
    if (!options.onEvent) return;
    try {
      const time = now();
      options.onEvent({
        type,
        time,
        command: command.command,
        label: describeCommand(command),
        commandId: command.commandId,
        message,
        durationMs: startedAt === undefined ? undefined : Math.max(0, time - startedAt),
      });
    } catch {
      // Keep the command transport independent of its UI.
    }
  }

  function reject(command, message, extra) {
    // A late callback must not overwrite a newer command's result.
    const current = options.readCommand();
    const result = options.readResult();
    if (!current || current.commandId !== command.commandId) return;
    if (result && result._commandId === command.commandId) return;
    options.writeResult({
      status: "error",
      error: message,
      _commandId: command.commandId,
      _commandExecuted: command.command,
      _responseTimestamp: new Date(now()).toISOString(),
      ...extra,
    });
  }

  async function tick() {
    if (busy || paused) return;
    const command = options.readCommand();
    if (!command || !command.commandId || command.commandId === lastId) return;
    lastId = command.commandId;
    if (!Number.isFinite(command.expiresAt)) {
      const message =
        "Restart the MCP client with the modal-safe server: this command has no expiry deadline.";
      reject(command, message);
      emit("rejected", command, message);
      options.onStatus("Command skipped. See history.");
      return;
    }
    if (now() >= command.expiresAt) {
      const message = "Command expired before dispatch. No changes were made.";
      reject(command, message);
      emit("rejected", command, message);
      options.onStatus("Command skipped. See history.");
      return;
    }
    // Older server processes may still request labels in the conversation language.
    // Reject bad metadata BEFORE evalScript so the caller can correct it safely.
    if (command.command === "executeScript" && !getScriptActionLabel(command.args)) {
      reject(command, ACTION_LABEL_ERROR, { executed: false, code: "ACTION_DESCRIPTION_REQUIRED" });
      emit("rejected", command, ACTION_LABEL_ERROR);
      options.onStatus("Action description required. See history.");
      return;
    }
    busy = true;
    const startedAt = now();
    emit("started", command, "", startedAt);
    options.onStatus("Running");
    try {
      const reply = await options.dispatch(command.commandId);
      const result = options.readResult();
      if (!result || result._commandId !== command.commandId) {
        const message =
          "After Effects did not return a matching result (" +
          reply +
          "). Close any modal dialog and check the project before issuing a new command. This command was not automatically retried.";
        reject(command, message);
        emit("uncertain", command, message, startedAt);
        options.onStatus("Result unknown. See history.");
      } else {
        const failed =
          result.status === "error" || result.success === false || result.error !== undefined;
        const message = failed ? String(result.error || result.message || "Command failed") : "";
        emit(failed ? "failed" : "succeeded", command, message, startedAt);
        options.onStatus(failed ? "Command failed. See history." : "Ready");
      }
    } catch (error) {
      const message =
        "CEP dispatch failed: " +
        String(error) +
        ". Execution status may be unknown; check the project before retrying.";
      reject(command, message);
      emit("uncertain", command, message, startedAt);
      options.onStatus("Dispatch failed. See history.");
    } finally {
      busy = false;
    }
  }

  return {
    tick,
    setPaused(value) {
      paused = !!value;
    },
    isBusy() {
      return busy;
    },
  };
}

module.exports = { createDriver };
