/* Shared by the MCP server and CEP; this checks syntax and generic placeholders,
 * not language fluency or whether an arbitrary script matches its description. */
function actionLabelError(language = "en") {
  const example =
    language === "ru"
      ? '"Проверить тайминг и выражения слоёв"'
      : '"Inspect layer timing and expressions"';
  return `Provide a specific ${language === "ru" ? "Russian" : "English"} action description explaining what this script will inspect or change, e.g. ${example}. Do not use generic placeholders such as "Run script", "Execute code" or "Запустить скрипт". Put object names in double quotes. The script has not been dispatched and no changes were made. Submit a new request with the corrected description; older clients may use // @mcp-label: <action description> on the first line. The panel's Command language setting is authoritative, regardless of the conversation language. Read it with check-bridge(settingsOnly: true).`;
}
const ACTION_LABEL_ERROR =
  "A specific action description is required. Read the panel's historyLanguage with check-bridge(settingsOnly: true): English by default, or Russian when selected. Generic placeholders are not allowed. The script has not been dispatched and no changes were made.";

function isActionLabel(value, language = "en") {
  if (typeof value !== "string") return false;
  // Preserve quoted object names in any language. This is a character check,
  // not a claim to detect language fluency or verify arbitrary script intent.
  const action = value.replace(/"[^"\r\n]*"|“[^”\r\n]*”|«[^»\r\n]*»/g, "");
  const letters = action.match(/\p{L}/gu) || [];
  if (!letters.length) return false;
  if (language === "ru") {
    // Allow Latin technical terms (AE, UI, keyframes) alongside Russian prose.
    if (!/[А-Яа-яЁё]/.test(action) || !letters.every((letter) => /^[A-Za-zА-Яа-яЁё]$/.test(letter)))
      return false;
  } else if (!letters.every((letter) => /^[A-Za-z]$/.test(letter))) return false;
  const words = value.match(/\p{L}[\p{L}\p{N}'-]*/gu) || [];
  if (words.length < 2) return false;
  if (language === "ru") {
    const normalized = value.toLowerCase().replace(/[^а-яёa-z0-9]/g, "");
    return !/^(?:запустить|запуск|запускаю|запускается|выполнить|выполнение|выполняю|выполняется)(?:этот|данный|пользовательский|произвольный)?(?:скрипт|скрипта|скрипты|код|кода|команду|команды|extendscript)$/.test(
      normalized,
    );
  }
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return !/^(?:run|running|execute|executing)(?:a|an|the)?(?:custom|arbitrary|aftereffects|ae)?(?:script|scripts|code|extendscript|command|commands)$/.test(
    normalized,
  );
}

function getScriptActionLabel(args, language = "en") {
  args = args || {};
  const annotation =
    typeof args.script === "string" && args.script.match(/^\s*\/\/\s*@mcp-label:[ \t]*([^\r\n]+)/);
  for (const value of [args.description, annotation && annotation[1]]) {
    if (typeof value !== "string") continue;
    const label = value.replace(/\s+/g, " ").trim();
    if (label.length <= 160 && isActionLabel(label, language)) return label;
  }
  // This exact internal template predates labels. Keep old background-render
  // clients saving their project; do not infer intent from arbitrary source.
  if (
    args.script ===
    "if (app.project.file) { app.project.save(); return app.project.file.fsName; } else { return null; }"
  )
    return language === "ru"
      ? "Сохранить проект перед фоновым рендерингом"
      : "Save the project before starting the background render";
  return "";
}

module.exports = { ACTION_LABEL_ERROR, actionLabelError, isActionLabel, getScriptActionLabel };
