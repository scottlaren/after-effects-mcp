// Decide how a background aerender run ended. "The process is gone" is not
// "the render is done": a crashed or killed aerender is gone too. The verdict is
// built from what can be checked: how the process ended, what the log says, how
// many frames were asked for, and whether the output file was really written.

export type RenderState = "running" | "finished" | "failed";

export interface RenderFacts {
  /** The aerender process is still there. */
  running: boolean;
  /** Exit code, when the server saw the process end. */
  exitCode?: number | null;
  /** Signal that ended the process, when there was one. */
  signal?: string | null;
  /** The render log so far. */
  log: string;
  /** Output path as given to aerender. */
  outputPath: string;
  /** The output file: size and modification time, or null when it is not there. */
  outputFile: { size: number; mtimeMs: number } | null;
  /** When the render was started, ms. */
  startedAtMs: number;
  /** Frames asked for, when both the first and the last frame were given. */
  expectedFrames?: number;
}

export interface RenderOutcome {
  state: RenderState;
  framesDone: number;
  /** 0..100, only when the number of frames asked for is known. */
  percent?: number;
  /** Why the render failed. */
  error?: string;
}

/**
 * Frames aerender reports as done. A progress line reads
 * "PROGRESS:  0:00:02:05 (66): 1 Seconds"; the number in brackets counts frames
 * whatever the project's time display is.
 */
export function framesInLog(log: string): number {
  let done = 0;
  for (const line of log.split(/\r?\n/)) {
    const hit = /^PROGRESS:.*\((\d+)\):/.exec(line);
    if (hit) done = Math.max(done, Number(hit[1]));
  }
  return done;
}

/** Error lines of aerender itself ("aerender ERROR ..."); the prefix is not localized. */
export function errorsInLog(log: string): string[] {
  const found: string[] = [];
  for (const line of log.split(/\r?\n/)) {
    const text = line.trim();
    if (/^aerender ERROR\b/i.test(text) && found.indexOf(text) < 0) found.push(text);
  }
  return found;
}

/** An image-sequence pattern such as "shot_[####].png": there is no single file to check. */
export function isFrameSequence(outputPath: string): boolean {
  return /\[#+\]/.test(outputPath);
}

export function renderOutcome(facts: RenderFacts): RenderOutcome {
  const framesDone = framesInLog(facts.log);
  const expected =
    typeof facts.expectedFrames === "number" && facts.expectedFrames > 0
      ? facts.expectedFrames
      : undefined;
  const progress =
    expected === undefined
      ? {}
      : { percent: Math.min(100, Math.round((framesDone / expected) * 100)) };

  if (facts.running) return { state: "running", framesDone, ...progress };

  const fail = (error: string): RenderOutcome => ({
    state: "failed",
    framesDone,
    ...progress,
    error,
  });
  const done = expected === undefined ? `${framesDone}` : `${framesDone} of ${expected}`;

  if (facts.signal) {
    return fail(`aerender was stopped from outside (${facts.signal}) with ${done} frames done.`);
  }
  if (typeof facts.exitCode === "number" && facts.exitCode !== 0) {
    const said = errorsInLog(facts.log)[0];
    return fail(
      `aerender ended with exit code ${facts.exitCode}, ${done} frames done.${said ? " " + said : ""}`,
    );
  }
  const said = errorsInLog(facts.log);
  if (said.length) return fail(said[0]);

  if (expected !== undefined && framesDone > 0 && framesDone < expected) {
    return fail(`The render stopped early: ${done} frames done.`);
  }
  if (!isFrameSequence(facts.outputPath)) {
    if (!facts.outputFile) {
      return fail(`aerender is gone and there is no output file (${done} frames done).`);
    }
    if (facts.outputFile.size === 0) {
      return fail(`aerender is gone and the output file is empty (${done} frames done).`);
    }
    // two seconds of slack: some file systems keep coarse timestamps
    if (facts.outputFile.mtimeMs < facts.startedAtMs - 2000) {
      return fail(
        "aerender is gone and the output file was not touched by this render: it is an older file.",
      );
    }
  }
  return { state: "finished", framesDone, ...(expected === undefined ? {} : { percent: 100 }) };
}
