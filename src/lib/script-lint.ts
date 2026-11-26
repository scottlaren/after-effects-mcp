// Pure helpers that make execute-script results easier for an agent to act on:
// a hint when a script returned nothing because it has no top-level `return`,
// the failing line of the caller's own script (the bridge reports a line inside
// its eval wrapper and its own file name), and a list of ES3 pitfalls shown only
// after After Effects has already rejected the script. Nothing here can block or
// alter a script before dispatch.

const BRIDGE_FILE = "mcp-bridge-auto.jsx";

// Words ExtendScript (ES3) refuses as bare identifiers, object keys or `.member` names.
const RESERVED = [
  "abstract",
  "boolean",
  "byte",
  "case",
  "catch",
  "char",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "double",
  "else",
  "enum",
  "export",
  "extends",
  "final",
  "finally",
  "float",
  "for",
  "function",
  "goto",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "int",
  "interface",
  "long",
  "native",
  "new",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "short",
  "static",
  "super",
  "switch",
  "synchronized",
  "this",
  "throw",
  "throws",
  "transient",
  "try",
  "typeof",
  "var",
  "void",
  "volatile",
  "while",
  "with",
];
const RESERVED_SET = new Set(RESERVED);

/**
 * Replace the contents of comments and string literals with spaces, keeping the
 * length and the line breaks, so later scans do not match inside them. Template
 * literal delimiters (backticks) are kept: ES3 has none, so they are a finding.
 * Regex literals are not recognized; a quote inside one may blank a little too
 * much, which only makes the lint quieter.
 */
export function stripForLint(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (c === "/" && d === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
    } else if (c === '"' || c === "'") {
      out += c;
      i++;
      while (i < n && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\" && i + 1 < n) {
          out += " ";
          i++;
        }
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n && src[i] === c) {
        out += c;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * True when the script has a `return` that belongs to the script body itself
 * rather than to a function declared inside it. execute-script runs the code as
 * a function body, so only such a return sends a value back.
 */
export function hasTopLevelReturn(script: string): boolean {
  const s = stripForLint(script);
  const re = /\bfunction\b|\breturn\b|[{}]/g;
  const stack: boolean[] = []; // true = this brace opened a function body
  let pendingFunction = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const tok = m[0];
    if (tok === "function") pendingFunction = true;
    else if (tok === "{") {
      stack.push(pendingFunction);
      pendingFunction = false;
    } else if (tok === "}") stack.pop();
    else if (!stack.some(Boolean)) return true;
  }
  return false;
}

function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/**
 * List constructs that ExtendScript (ES3) does not parse. Meant to be shown next
 * to a syntax error that After Effects has already reported, as possible causes.
 */
export function lintExtendScript(script: string): string[] {
  const s = stripForLint(script);
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (index: number, text: string) => {
    const line = lineOf(s, index);
    const key = line + ":" + text;
    if (seen.has(key) || found.length >= 12) return;
    seen.add(key);
    found.push(`line ${line}: ${text}`);
  };
  let m: RegExpExecArray | null;

  const key = /([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g;
  while ((m = key.exec(s))) {
    if (RESERVED_SET.has(m[2]) && m[2] !== "default")
      add(
        m.index + m[1].length,
        `reserved word "${m[2]}" used as an object key; quote it: "${m[2]}": ...`,
      );
  }
  const member = /\.\s*([A-Za-z_$][\w$]*)/g;
  while ((m = member.exec(s))) {
    if (RESERVED_SET.has(m[1]))
      add(m.index, `reserved word "${m[1]}" used as a property name; write obj["${m[1]}"]`);
  }
  const decl = /\bvar\s+([A-Za-z_$][\w$]*)/g;
  while ((m = decl.exec(s))) {
    if (RESERVED_SET.has(m[1])) add(m.index, `reserved word "${m[1]}" used as a variable name`);
  }

  const modern: Array<[RegExp, string]> = [
    [/\b(let|const)\s+[A-Za-z_$[{]/g, "let/const is not ES3; use var"],
    [/=>/g, "arrow functions are not ES3; use function () {}"],
    [/`/g, "template literals are not ES3; concatenate strings"],
    [/\bfor\s*\([^)]*\sof\s/g, "for...of is not ES3; use an index loop"],
    [/\.\.\.[A-Za-z_$[]/g, "spread/rest is not ES3"],
    [/\bclass\s+[A-Za-z_$]/g, "class is not ES3"],
    [/\b(async\s+function|await\s)/g, "async/await is not ES3"],
    [/,\s*[}\]]/g, "a trailing comma before } or ] can fail in ExtendScript"],
  ];
  for (const [re, text] of modern) {
    re.lastIndex = 0;
    while ((m = re.exec(s))) add(m.index, text);
  }
  return found;
}

/**
 * Post-process a raw execute-script bridge result for the caller:
 *  - success with a null result and no top-level `return` -> add `hint`;
 *  - error raised inside the inline script -> add `scriptLine` and `source` (the
 *    bridge wraps the script in a one-line function header, so its line is one
 *    more than the caller's), and say that the file name is the bridge's own;
 *  - syntax-like errors -> add `possibleCauses` from lintExtendScript.
 * Non-JSON input and results without anything to add are returned unchanged.
 */
export function annotateScriptResult(script: string, raw: string): string {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!parsed || typeof parsed !== "object") return raw;
  let changed = false;

  const failed = parsed.status === "error" || parsed.error !== undefined;
  if (!failed) {
    if (parsed.status === "success" && parsed.result === null && !hasTopLevelReturn(script)) {
      parsed.hint =
        "The script returned nothing: it runs as a function body, so end it with `return <value>;` to get data back (JSON-serializable values only).";
      changed = true;
    }
  } else {
    const fileName = typeof parsed.fileName === "string" ? parsed.fileName : null;
    const inline =
      fileName === null || fileName.replace(/\\/g, "/").split("/").pop() === BRIDGE_FILE;
    const lines = script.split(/\r\n|\r|\n/);
    if (inline && typeof parsed.line === "number") {
      const scriptLine = parsed.line - 1;
      if (scriptLine >= 1 && scriptLine <= lines.length) {
        parsed.scriptLine = scriptLine;
        parsed.source = lines[scriptLine - 1].trim().slice(0, 240);
        parsed.where = "your inline script (the reported fileName is the bridge that evaluates it)";
        changed = true;
      }
    } else if (!inline && fileName) {
      parsed.where = "a file loaded by the script (see fileName and line)";
      changed = true;
    }
    const text = String(parsed.error || parsed.message || "");
    if (/syntax|reserved word|expected:|illegal|unterminated|does not have a value/i.test(text)) {
      const causes = inline ? lintExtendScript(script) : [];
      if (causes.length) {
        parsed.possibleCauses = causes;
        changed = true;
      }
    }
  }
  return changed ? JSON.stringify(parsed, null, 2) : raw;
}
