# After Effects MCP

A Windows fork of [a-y-ibrahim/after-effects-mcp](https://github.com/a-y-ibrahim/after-effects-mcp)
with a CEP bridge and compact command history. It keeps all 57 upstream tools for
compositions, layers, animation, effects, rendering and ExtendScript.

## What changed

- Command polling runs outside AE's scripting engine, removing the idle script
  calls that can trigger errors while a modal dialog is open.
- Command deadlines reject stale requests. Failed or uncertain edits are not
  automatically retried.
- The panel follows AE's native theme and shows named actions, status and duration.
  Newest actions appear first; history resets when the panel opens.

Close AE dialogs before sending commands. AE's restriction on running scripts
through an open modal dialog still applies.

## Setup

Requires Windows, After Effects 2022 or later, Node.js 24 and an MCP client.
Tested with AE 25.3.2 and Node.js 24.13.1. macOS installation has not been tested.

```powershell
git clone https://github.com/scottlaren/after-effects-mcp.git
cd after-effects-mcp
npm ci
powershell -NoProfile -File .\install-modal-safe.ps1
```

The installer backs up replaced files and enables CEP developer mode to load the
unsigned panel. No administrator rights are needed.

1. In AE, open **Edit > Preferences > Scripting & Expressions** and enable
   **Allow Scripts to Write Files and Access Network**.
2. Restart AE, then open **Window > Extensions > MCP Bridge** and keep it open.
3. Configure your MCP client to run `node` with the absolute path to this
   checkout's `build/index.js`, then restart the client connection.
4. Run `check-bridge`. Expect `transport: cep` and `versionMatch: true`.

Use this checkout's server; the upstream npm package does not include the fork's
changes. The installer disables the old ScriptUI panel's polling timer.

## Documentation

- [Tools](docs/TOOLS.md)
- [Bridge details, troubleshooting and rollback](docs/MODAL-SAFE.md)
- [Setup in Russian](README.ru.md)
- [Development and contributing](CONTRIBUTING.md)

## Credits and license

Based on [Abdelrahman Youssef's fork](https://github.com/a-y-ibrahim/after-effects-mcp)
and the original [Dakkshin/after-effects-mcp](https://github.com/Dakkshin/after-effects-mcp).
Licensed under [MIT](LICENSE). Full project lineage is in [CREDITS.md](CREDITS.md).

## Maintainer

This fork is maintained by Scott Laren.

- Telegram: [t.me/scottlaren](https://t.me/scottlaren)
- X: [@scottlaren](https://x.com/scottlaren)
