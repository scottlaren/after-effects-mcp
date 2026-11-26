import { describe, it, expect } from "vitest";
import {
  errorsInLog,
  framesInLog,
  isFrameSequence,
  renderOutcome,
  type RenderFacts,
} from "../src/lib/render-outcome";

const LOG =
  "PROGRESS:  Start: 0:00:00:00\r\nPROGRESS:  0:00:00:00 (1): 0 Seconds\r\nPROGRESS:  0:00:00:01 (2): 0 Seconds\nPROGRESS:  00065 (66): 1 Seconds\nPROGRESS:  Total Time Elapsed: 4 Seconds\n";

const facts = (over: Partial<RenderFacts> = {}): RenderFacts => ({
  running: false,
  exitCode: 0,
  signal: null,
  log: LOG,
  outputPath: "C:/out/video.mov",
  outputFile: { size: 1000, mtimeMs: 50_000 },
  startedAtMs: 40_000,
  ...over,
});

describe("log reading", () => {
  it("counts frames from progress lines in either time display", () => {
    expect(framesInLog(LOG)).toBe(66);
    expect(framesInLog("")).toBe(0);
    expect(framesInLog("PROGRESS:  Total Time Elapsed: 4 Seconds")).toBe(0);
  });
  it("collects aerender's own error lines once each", () => {
    const log =
      "x\naerender ERROR: No comp was found with the given name.\naerender ERROR: No comp was found with the given name.\n";
    expect(errorsInLog(log)).toEqual(["aerender ERROR: No comp was found with the given name."]);
    expect(errorsInLog(LOG)).toEqual([]);
  });
  it("knows a frame sequence pattern", () => {
    expect(isFrameSequence("C:/out/shot_[####].png")).toBe(true);
    expect(isFrameSequence("C:/out/shot.mov")).toBe(false);
  });
});

describe("renderOutcome", () => {
  it("is running while the process lives, with progress when the range is known", () => {
    expect(renderOutcome(facts({ running: true, exitCode: undefined }))).toEqual({
      state: "running",
      framesDone: 66,
    });
    expect(renderOutcome(facts({ running: true, expectedFrames: 600 }))).toMatchObject({
      state: "running",
      percent: 11,
    });
  });
  it("is finished after a clean exit with a fresh output file", () => {
    expect(renderOutcome(facts())).toEqual({ state: "finished", framesDone: 66 });
    expect(renderOutcome(facts({ expectedFrames: 66 }))).toMatchObject({
      state: "finished",
      percent: 100,
    });
  });
  it("fails when the process was killed", () => {
    const o = renderOutcome(facts({ exitCode: null, signal: "SIGTERM", expectedFrames: 600 }));
    expect(o.state).toBe("failed");
    expect(o.error).toMatch(/SIGTERM/);
    expect(o.error).toMatch(/66 of 600/);
  });
  it("fails on a non-zero exit code and quotes aerender's error", () => {
    const o = renderOutcome(
      facts({ exitCode: 1, log: "aerender ERROR: No comp was found with the given name.\n" }),
    );
    expect(o.state).toBe("failed");
    expect(o.error).toMatch(/exit code 1/);
    expect(o.error).toMatch(/No comp was found/);
  });
  it("fails on an error in the log even with exit code 0", () => {
    const o = renderOutcome(facts({ log: LOG + "aerender ERROR -609: Rendering error.\n" }));
    expect(o).toMatchObject({ state: "failed", error: "aerender ERROR -609: Rendering error." });
  });
  it("fails when fewer frames were rendered than asked for", () => {
    const o = renderOutcome(facts({ exitCode: undefined, expectedFrames: 600 }));
    expect(o.state).toBe("failed");
    expect(o.error).toMatch(/stopped early: 66 of 600/);
  });
  it("fails when the output file is missing, empty or old", () => {
    expect(renderOutcome(facts({ outputFile: null })).error).toMatch(/no output file/);
    expect(renderOutcome(facts({ outputFile: { size: 0, mtimeMs: 50_000 } })).error).toMatch(
      /empty/,
    );
    expect(renderOutcome(facts({ outputFile: { size: 9, mtimeMs: 10_000 } })).error).toMatch(
      /older file/,
    );
  });
  it("does not look for a single file when the output is a frame sequence", () => {
    expect(
      renderOutcome(facts({ outputPath: "C:/out/shot_[####].png", outputFile: null })).state,
    ).toBe("finished");
  });
  it("accepts an unobserved exit when the evidence is good", () => {
    expect(renderOutcome(facts({ exitCode: undefined })).state).toBe("finished");
  });
});
