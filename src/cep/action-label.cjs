/* Shared by the MCP server and CEP; this checks syntax and generic placeholders,
 * not language fluency or whether an arbitrary script matches its description. */
const ACTION_LABEL_ERROR =
  'Provide a specific English action description explaining what this script will inspect or change, e.g. "Inspect layer timing and expressions" or "Save the updated animation to the project". Do not use "Run script" or "Execute code". Put non-English object names in double quotes. The script has not been dispatched and no changes were made. Submit a new request with the corrected description; older clients may use // @mcp-label: <English action description> on the first line. Reconnect the MCP client if its tool instructions still request the user\'s language.';

function isEnglishActionLabel(value) {
  if (typeof value !== "string") return false;
  // Preserve quoted object names in any language; the action itself uses English.
  const action = value.replace(/"[^"\r\n]*"|“[^”\r\n]*”|«[^»\r\n]*»/g, "");
  const letters = action.match(/\p{L}/gu) || [];
  if (!letters.length || !letters.every((letter) => /^[A-Za-z]$/.test(letter))) return false;
  const words = value.match(/\p{L}[\p{L}\p{N}'-]*/gu) || [];
  if (words.length < 2) return false;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return !/^(?:run|running|execute|executing)(?:a|an|the)?(?:custom|arbitrary|aftereffects|ae)?(?:script|scripts|code|extendscript|command|commands)$/.test(
    normalized,
  );
}

function getScriptActionLabel(args) {
  args = args || {};
  const annotation =
    typeof args.script === "string" && args.script.match(/^\s*\/\/\s*@mcp-label:[ \t]*([^\r\n]+)/);
  for (const value of [args.description, annotation && annotation[1]]) {
    if (typeof value !== "string") continue;
    const label = value.replace(/\s+/g, " ").trim();
    if (label.length <= 160 && isEnglishActionLabel(label)) return label;
  }
  // This exact internal template predates labels. Keep old background-render
  // clients saving their project; do not infer intent from arbitrary source.
  if (
    args.script ===
    "if (app.project.file) { app.project.save(); return app.project.file.fsName; } else { return null; }"
  )
    return "Save the project before starting the background render";
  return "";
}

module.exports = { ACTION_LABEL_ERROR, isEnglishActionLabel, getScriptActionLabel };
