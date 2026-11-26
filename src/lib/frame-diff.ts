// Pure pixel comparison of two rendered frames, for the compare-frames tool:
// "did this refactor change the picture, and where".

import type { Bitmap } from "./png.js";

export interface FrameDiff {
  sameSize: boolean;
  /** Largest per-channel difference, 0..255. */
  maxDiff: number;
  /** Pixels whose largest channel difference exceeds the threshold. */
  changedPixels: number;
  /** Share of changed pixels, 0..1. */
  changedShare: number;
  /** Bounding box of changed pixels [x, y, w, h], or null when none. */
  bbox: [number, number, number, number] | null;
}

/** Compare two bitmaps. Differences up to `threshold` levels count as rounding noise. */
export function diffFrames(a: Bitmap, b: Bitmap, threshold = 2): FrameDiff {
  if (a.width !== b.width || a.height !== b.height) {
    return { sameSize: false, maxDiff: 255, changedPixels: -1, changedShare: 1, bbox: null };
  }
  const { width, height } = a;
  let maxDiff = 0;
  let changed = 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let d = Math.abs(a.data[i] - b.data[i]);
      const d1 = Math.abs(a.data[i + 1] - b.data[i + 1]);
      const d2 = Math.abs(a.data[i + 2] - b.data[i + 2]);
      const d3 = Math.abs(a.data[i + 3] - b.data[i + 3]);
      if (d1 > d) d = d1;
      if (d2 > d) d = d2;
      if (d3 > d) d = d3;
      if (d > maxDiff) maxDiff = d;
      if (d > threshold) {
        changed++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return {
    sameSize: true,
    maxDiff,
    changedPixels: changed,
    changedShare: changed / (width * height),
    bbox: changed ? [x0, y0, x1 - x0 + 1, y1 - y0 + 1] : null,
  };
}

/**
 * Build one picture for a human or a model: before | after | difference, cropped
 * to the changed area (plus padding) and scaled down so each panel is at most
 * `panelWidth` wide. The difference panel is amplified so small changes show.
 */
export function buildDiffImage(
  a: Bitmap,
  b: Bitmap,
  bbox: [number, number, number, number],
  panelWidth = 360,
  pad = 24,
  amplify = 8,
): Bitmap {
  const x0 = Math.max(0, bbox[0] - pad);
  const y0 = Math.max(0, bbox[1] - pad);
  const x1 = Math.min(a.width, bbox[0] + bbox[2] + pad);
  const y1 = Math.min(a.height, bbox[1] + bbox[3] + pad);
  const cw = Math.max(1, x1 - x0);
  const ch = Math.max(1, y1 - y0);
  const scale = Math.min(1, panelWidth / cw, 1200 / ch);
  const pw = Math.max(1, Math.round(cw * scale));
  const ph = Math.max(1, Math.round(ch * scale));
  const gap = 4;
  const width = pw * 3 + gap * 2;
  const out = new Uint8Array(width * ph * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255;
    out[i + 1] = 0;
    out[i + 2] = 255;
    out[i + 3] = 255;
  }
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(a.height - 1, y0 + Math.floor(y / scale));
    for (let x = 0; x < pw; x++) {
      const sx = Math.min(a.width - 1, x0 + Math.floor(x / scale));
      const s = (sy * a.width + sx) * 4;
      // flatten transparency on mid grey so transparent comps stay readable
      const fa = a.data[s + 3] / 255;
      const fb = b.data[s + 3] / 255;
      let dmax = 0;
      for (let c = 0; c < 3; c++) {
        const va = Math.round(a.data[s + c] * fa + 128 * (1 - fa));
        const vb = Math.round(b.data[s + c] * fb + 128 * (1 - fb));
        out[(y * width + x) * 4 + c] = va;
        out[(y * width + x + pw + gap) * 4 + c] = vb;
        const d = Math.abs(a.data[s + c] - b.data[s + c]);
        if (d > dmax) dmax = d;
      }
      const da = Math.abs(a.data[s + 3] - b.data[s + 3]);
      if (da > dmax) dmax = da;
      const v = Math.min(255, dmax * amplify);
      const o = (y * width + x + 2 * (pw + gap)) * 4;
      out[o] = out[o + 1] = out[o + 2] = v;
    }
  }
  return { width, height: ph, data: out };
}

/** Folder-safe snapshot name, or null when the name is not acceptable. */
export function safeSnapshotName(name: string): string | null {
  return /^[A-Za-z0-9_-]{1,48}$/.test(name) ? name : null;
}

/** File name of one frame inside a snapshot folder. */
export function snapshotFrameFile(frame: number): string {
  return "f" + String(Math.max(0, Math.round(frame))).padStart(6, "0") + ".png";
}
