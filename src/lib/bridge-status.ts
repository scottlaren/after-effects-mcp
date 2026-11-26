// Pure classification of the bridge panel's status file, so a timeout can say
// WHY nothing came back: After Effects is busy, the panel is paused or closed,
// or After Effects is not running at all. The panel (CEP JavaScript, which keeps
// running while After Effects' script engine is blocked) rewrites the file every
// couple of seconds; the server only reads it.

export const STATUS_FILE = "ae_bridge_status.json";
/** A status older than this means the panel's own timer has stopped. */
export const STATUS_STALE_MS = 8000;

export interface PanelStatus {
  state?: "idle" | "running" | "paused" | "closed" | string;
  panelTime?: number;
  commandId?: string;
  command?: string;
  startedAt?: number;
  bridgeVersion?: string;
}

export type BridgeState =
  | "busy"
  | "paused"
  | "panel-closed"
  | "ae-not-running"
  | "panel-not-responding"
  | "not-picked-up"
  | "unknown";

export interface BridgeDiagnosis {
  bridgeState: BridgeState;
  detail: string;
  /** True when the command may still run or be running: do not blindly re-send edits. */
  mayStillRun: boolean;
}

/**
 * @param status      parsed status file, or null when missing/unreadable
 * @param now         current time, ms
 * @param commandId   id of the command that got no result
 * @param aeRunning   whether an After Effects process exists; null = could not tell
 */
export function classifyBridgeState(
  status: PanelStatus | null,
  now: number,
  commandId: string,
  aeRunning: boolean | null,
): BridgeDiagnosis {
  if (aeRunning === false) {
    return {
      bridgeState: "ae-not-running",
      detail: "After Effects is not running. Start it and open Window > Extensions > MCP Bridge.",
      mayStillRun: false,
    };
  }
  const fresh =
    !!status &&
    typeof status.panelTime === "number" &&
    now - status.panelTime >= 0 &&
    now - status.panelTime < STATUS_STALE_MS;

  if (!status || typeof status.panelTime !== "number") {
    return {
      bridgeState: "unknown",
      detail:
        "The panel wrote no status file: it is closed, or an older panel build is loaded. Open Window > Extensions > MCP Bridge; if it is open, reinstall the bridge and restart After Effects.",
      mayStillRun: false,
    };
  }
  if (status.state === "closed") {
    return {
      bridgeState: "panel-closed",
      detail: "The MCP Bridge panel was closed. Open Window > Extensions > MCP Bridge.",
      mayStillRun: false,
    };
  }
  if (!fresh) {
    const ago = Math.round((now - status.panelTime) / 1000);
    return {
      bridgeState: "panel-not-responding",
      detail: `The panel last reported ${ago} s ago. After Effects has frozen, crashed, or the panel was closed.`,
      mayStillRun: status.state === "running",
    };
  }
  if (status.state === "paused") {
    return {
      bridgeState: "paused",
      detail: "The panel is paused by the user: resume it in the MCP Bridge panel.",
      mayStillRun: false,
    };
  }
  if (status.state === "running") {
    const secs =
      typeof status.startedAt === "number" ? Math.round((now - status.startedAt) / 1000) : null;
    const which =
      status.commandId === commandId
        ? "this command"
        : `an earlier command (${status.command || "unknown"})`;
    return {
      bridgeState: "busy",
      detail: `After Effects is busy with ${which}${secs !== null ? ` for ${secs} s` : ""}: a long script, a render, a project loading, or a modal dialog. It may still finish; do not re-send an edit, check the project first.`,
      mayStillRun: true,
    };
  }
  return {
    bridgeState: "not-picked-up",
    detail:
      "The panel is alive and idle but did not take this command (it may have expired before dispatch). Nothing was changed; send it again.",
    mayStillRun: false,
  };
}
