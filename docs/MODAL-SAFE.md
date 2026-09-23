# Modal-safe CEP fork

The legacy ScriptUI bridge calls `app.scheduleTask(..., 250, true)` even when no
MCP request exists. After Effects can reject a scheduled script while a modal
dialog is open, before the callback starts (the "line 0" error). A try/catch,
`app.isUISuppressed`, or `beginSuppressDialogs()` inside that callback cannot
intercept a rejection before script entry.

This fork adds a CEP panel that polls the existing command file in Chromium/Node.
Idle polling makes **no ExtendScript calls**. A new command gets one `evalScript`
dispatch; all existing AE command handlers are reused. No automatic redispatch
occurs after a failed or ambiguous host response. Only one host request can be in
flight in the panel. The ScriptUI bridge remains available as legacy code, but
installation disables its timer using a marker, including on workspace restore.

This removes the persistent scheduler responsible for the reported idle/dialog
collision. It does not make AE able to run commands through an open modal. Close
dialogs before issuing commands. A command sent during a dialog can wait or fail,
depending on AE; the panel reports that outcome rather than retrying the edit.

## Compact panel and command history

The compact header combines **Command History** and three square icon buttons:
**Pause/Resume**, **Export** and **Clear**, with tooltips and accessible labels.
The history uses 11px text and compact spacing. Status
stays visible beside **Connection details** at the bottom; expanding it reveals
labelled version and bridge-folder fields and one connection hint.
The outer background follows the native AE theme via CEP, including theme-change
events, with a `#323232` fallback. The history retains its darker surface. Theme
updates do not run ExtendScript or add host polling.

Running actions use gray text with a subtle repeating shimmer. Completed actions
use white text; errors, skipped commands and uncertain results use red text with
an explanation below. There are no visible status icons. The shimmer stops as soon as the
row finishes and is disabled when the system requests reduced motion.

History shows the newest actions first without scrolling. Older rows are clipped
at the bottom; increasing the panel height reveals more of them. One row per
command updates from running to done, failed,
skipped or uncertain, with a timestamp and elapsed time. Errors remain visible
under the action. Pause/resume and connection events are also recorded.
The latest 200 entries are kept only in memory for the current panel
session. Reopening the panel or restarting AE starts a new history; **Clear**
empties it immediately. Older versions' saved history is removed on startup and
never loaded. Built-in commands have readable action names and optional object
names. Full script source, arguments and result payloads are not logged.
Logging adds no host polling and a logging failure cannot retry an AE command.

**Export** saves a UTF-8 `.txt` snapshot of all retained entries, including hidden
rows, with timestamps, outcomes, durations and errors. It uses CEP's native Save
dialog and file API without ExtendScript calls. New command dispatch is paused
while the dialog is open, then the user's previous pause state is restored.
Cancel leaves history unchanged; file errors are reported in the panel.

Every `execute-script` call requires a specific English `description`, regardless
of the conversation language. Describe the action and its target in a natural
phrase, usually 5–14 words: `Inspect layer timing and expressions in the main composition`
or `Save the updated animation to the project`.
Existing project, composition and layer names remain unchanged inside double quotes,
for example `Create layer "Квадрат"`. Labels come from the calling agent, not a
translation service. Missing descriptions, generic placeholders such as `Run script`
or `Execute code`, and non-English letters outside quoted names are rejected
before dispatch, asking the caller to correct the description. This is a syntax
and placeholder check, not a language detector or a code audit.
The label describes intent;
the row's status reports whether AE returned success. It is not an independent
audit of changes made by arbitrary code. With older MCP schemas, the first line
of the script can be `// @mcp-label: Create a centered square`. CEP applies the
same check to requests from older servers and returns `ACTION_DESCRIPTION_REQUIRED`
with `executed: false` before calling AE. A corrected request needs a new command
ID; rejected edits are never replayed automatically. The exact legacy internal
background-render save template has its own built-in label for compatibility.

Restart/reconnect the MCP client after updating the server to refresh both its
running process and tool instructions. Reopening only the CEP panel does not
refresh a client's cached instruction to use the conversation language.

After updating only these frontend files, close and reopen **MCP Bridge** to load
them. The MCP server does not need a restart for this UI update. If AE still shows
the older panel name after a manifest update, save your work and restart AE.

## Command deadlines

The MCP server writes `expiresAt` with every command. CEP checks it before dispatch,
and the actual JSX checks it again after AE admits the request. A late callback
also checks its expected command ID before reading the current command. This
prevents an edit queued behind a modal from executing after its deadline or
accidentally consuming a newer request. A command that already began before the
deadline may still run beyond the timeout; it is not cancelled or rolled back.
Inspect its outcome before retrying. Other simultaneous MCP server processes
sharing the same directory retain upstream's cross-process mailbox limitation.

## Windows installation

1. `npm ci` and `npm run build` with Node 20+ for development (tested on Node 24.13.1).
2. Run `powershell -NoProfile -File .\install-modal-safe.ps1`.
3. Point the MCP client's existing server entry at this fork's `build/index.js`.
4. Save your work and restart AE. Restart/reconnect the MCP client to load the new
   server. Open **Window > Extensions > MCP Bridge** and leave it open.

The installer backs up replaced files and previous CEP developer-mode settings.
It enables `PlayerDebugMode=1` for CSXS 11/12 to load this local unsigned extension.
It installs into the current user's Adobe directories; no administrator rights,
network listener, or change to an AE project is needed. The local Unicode result
escaping fix is preserved. A server that does not send deadlines is rejected with
an instruction to restart the MCP client instead of silently applying old requests.

Rollback: run the same installer with `-RestoreSnapshot <printed snapshot.json>`
and restore the previous MCP server path, then restart AE and the MCP client. The
original ScriptUI source ignores the CEP setting retained in AE preferences.

The installer currently targets Windows. The CEP transport uses the bridge folder
reported by AE, but macOS installation and live operation have not been tested.

## Validation

- Full unit suite, typecheck, build and lint.
- Tests execute the actual JSX in a mocked AE host: no scheduled task in CEP mode,
  old task cancellation, command IDs, duplicate suppression, stale startup files,
  Unicode, expiration before execution, and successful recovery with a fresh command.
- CEP driver tests cover idle polling, serialized dispatch, uncertain failures,
  pause/resume, callbacks arriving after a newer request, event timing, error
  classification and isolation from a failed history renderer.
- These tests simulate modal delays; they do not reproduce Adobe's native dialog
  handling. Live AE/CEP validation is a separate acceptance step below.

## Live acceptance (no edits needed)

1. Confirm the panel says Ready and `check-bridge` reports transport `cep`.
2. Leave an AE Preferences/Composition Settings/file dialog open for at least 30
   seconds with no MCP request. Expect no "line 0" error. Close it normally.
3. Run a read-only project inspection. Expect a matching successful response.
4. For the busy-host case, issue only a read-only command while a dialog is open;
   allow it to expire, close the dialog, then issue a fresh read-only request.
5. Close/reopen the CEP panel and restart AE with the workspace restored. Confirm
   the old ScriptUI timer does not come back and repeat steps 1–3.

## Research, 2026-09-23

All six direct forks and their listed branches were inspected. No dedicated
modal-dialog fix was found. MotionDevLab adds TCP transport but still drives it
through `app.scheduleTask("bridgeTick()", interval, true)`. The other forks either
track upstream, change frame capture/install behavior, or add separate workflows.

- [Upstream forks](https://github.com/a-y-ibrahim/after-effects-mcp/forks)
- [MotionDevLab bridge](https://github.com/MotionDevLab/after-effects-mcp-a-y-ibrahim/blob/main/src/scripts/mcp-bridge-auto.jsx)
- [Adobe discussion of the exact scheduleTask/modal failure](https://community.adobe.com/questions-529/how-to-check-if-a-internal-modal-dialog-is-open-29269)
- [Adobe CEP scripting documentation](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_9.x/Documentation/CEP%209.0%20HTML%20Extension%20Cookbook.md)
