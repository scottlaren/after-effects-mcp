import { describe, it, expect } from "vitest";
import {
  annotateScriptResult,
  hasTopLevelReturn,
  lintExtendScript,
  stripForLint,
} from "../src/lib/script-lint";

describe("stripForLint", () => {
  it("blanks comments and strings but keeps length and line breaks", () => {
    const src = "var a = \"let x\"; // const y\n/* => \n */ var b = '`';";
    const out = stripForLint(src);
    expect(out.length).toBe(src.length);
    expect(out.split("\n").length).toBe(src.split("\n").length);
    expect(out).not.toMatch(/let|const|=>|`/);
    expect(out).toContain("var a");
    expect(out).toContain("var b");
  });
});

describe("hasTopLevelReturn", () => {
  it("sees a return in the script body, also inside blocks", () => {
    expect(hasTopLevelReturn("var c = 1; return c;")).toBe(true);
    expect(hasTopLevelReturn("if (x) { for (;;) { return 1; } }")).toBe(true);
  });
  it("ignores returns of nested functions, comments and strings", () => {
    expect(hasTopLevelReturn("function f() { return 1; } f();")).toBe(false);
    expect(hasTopLevelReturn("var f = function () { if (a) { return 1; } }; f();")).toBe(false);
    expect(hasTopLevelReturn("// return 1\nvar s = 'return';")).toBe(false);
  });
  it("sees a top-level return after a nested function", () => {
    expect(hasTopLevelReturn("function f() { return 1; }\nreturn f();")).toBe(true);
  });
});

describe("lintExtendScript", () => {
  it("finds reserved words used as keys and members", () => {
    const found = lintExtendScript("var o = {\n  in: 1,\n  long: 2\n};\nvar z = o.class;");
    expect(found.join("\n")).toMatch(/line 2: reserved word "in"/);
    expect(found.join("\n")).toMatch(/line 3: reserved word "long"/);
    expect(found.join("\n")).toMatch(/line 5: reserved word "class"/);
  });
  it("finds modern syntax", () => {
    const found = lintExtendScript(
      "let a = 1;\nconst b = [1, 2,];\nvar f = (x) => x;\nvar s = `t`;\nfor (var i of b) {}",
    ).join("\n");
    expect(found).toMatch(/line 1: let\/const/);
    expect(found).toMatch(/line 2: a trailing comma/);
    expect(found).toMatch(/line 3: arrow functions/);
    expect(found).toMatch(/line 4: template literals/);
    expect(found).toMatch(/line 5: for\.\.\.of/);
  });
  it("is quiet on plain ES3 and on quoted keys", () => {
    expect(
      lintExtendScript(
        'var o = { "in": 1, out: 2 };\nfor (var k in o) { if (k === "let x") continue; }\nreturn o["in"] ? 1 : 2;',
      ),
    ).toEqual([]);
  });
});

describe("annotateScriptResult", () => {
  const bridge = "C:\\Users\\a\\AppData\\Roaming\\Adobe\\CEP\\extensions\\x\\mcp-bridge-auto.jsx";

  it("adds a hint when nothing was returned and there is no return", () => {
    const out = JSON.parse(
      annotateScriptResult("app.project.activeItem.name;", '{"status":"success","result":null}'),
    );
    expect(out.hint).toMatch(/return <value>/);
  });
  it("adds no hint when the script returns, or returned a value", () => {
    const raw = '{"status":"success","result":null}';
    expect(annotateScriptResult("return null;", raw)).toBe(raw);
    const raw2 = '{"status":"success","result":5}';
    expect(annotateScriptResult("5", raw2)).toBe(raw2);
  });
  it("maps the wrapper line back to the caller's script", () => {
    const script = "var c = app.project.activeItem;\nvar l = c.layer(99);\nreturn l.name;";
    const raw = JSON.stringify({ status: "error", error: "boom", line: 3, fileName: bridge });
    const out = JSON.parse(annotateScriptResult(script, raw));
    expect(out.scriptLine).toBe(2);
    expect(out.source).toBe("var l = c.layer(99);");
    expect(out.where).toMatch(/inline script/);
  });
  it("leaves lines of other files alone", () => {
    const raw = JSON.stringify({
      status: "error",
      error: "boom",
      line: 3,
      fileName: "C:/x/lib.jsx",
    });
    const out = JSON.parse(annotateScriptResult("a\nb\nc", raw));
    expect(out.scriptLine).toBeUndefined();
    expect(out.where).toMatch(/a file loaded/);
  });
  it("lists likely causes for a syntax error", () => {
    const raw = JSON.stringify({
      status: "error",
      error: "SyntaxError: Expected: ;",
      line: 2,
      fileName: null,
    });
    const out = JSON.parse(annotateScriptResult("const a = 1;\nreturn a;", raw));
    expect(out.possibleCauses.join(" ")).toMatch(/let\/const/);
  });
  it("passes through non-JSON and timeouts", () => {
    expect(annotateScriptResult("x", "not json")).toBe("not json");
    const t = '{"error":"Timed out waiting for bridge result for command \'executeScript\'."}';
    expect(annotateScriptResult("x", t)).toBe(t);
  });
});
