import * as zlib from "node:zlib";
import { describe, it, expect } from "vitest";
import { decodePng, encodePng, type Bitmap } from "../src/lib/png";
import {
  buildDiffImage,
  diffFrames,
  safeSnapshotName,
  snapshotFrameFile,
} from "../src/lib/frame-diff";
import { isCompletePng, buildFrameContent, frameLabel } from "../src/lib/see-frame";

function solid(w: number, h: number, rgba: [number, number, number, number]): Bitmap {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { width: w, height: h, data };
}

// Build a PNG by hand with a chosen filter per row / bit depth / colour type.
function rawPng(w: number, h: number, depth: number, colorType: number, rows: number[][]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(
      zlib.crc32 ? zlib.crc32(out.subarray(4, 8 + data.length)) : 0,
      8 + data.length,
    );
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.from(rows.flat()))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("png", () => {
  it("round-trips RGBA through encode and decode", () => {
    const bmp = solid(5, 3, [10, 20, 30, 255]);
    bmp.data.set([200, 100, 50, 128], (1 * 5 + 2) * 4);
    const png = encodePng(bmp);
    expect(isCompletePng(png)).toBe(true);
    const back = decodePng(png);
    expect(back.width).toBe(5);
    expect(back.height).toBe(3);
    expect(Array.from(back.data)).toEqual(Array.from(bmp.data));
  });
  it("decodes filtered 8-bit RGB rows (sub, up, average, paeth)", () => {
    // 2x4 RGB, every row is the same two pixels (10,20,30) (13,24,35) before filtering
    const png = rawPng(2, 4, 8, 2, [
      [1, 10, 20, 30, 3, 4, 5], // sub
      [2, 0, 0, 0, 0, 0, 0], // up
      [3, 5, 10, 15, 2, 2, 3], // average: left/up floor
      [4, 0, 0, 0, 0, 0, 0], // paeth
    ]);
    const bmp = decodePng(png);
    for (let y = 0; y < 4; y++) {
      expect(Array.from(bmp.data.subarray(y * 8, y * 8 + 8))).toEqual([
        10, 20, 30, 255, 13, 24, 35, 255,
      ]);
    }
  });
  it("decodes 16-bit RGBA by keeping the high byte", () => {
    const png = rawPng(1, 1, 16, 6, [[0, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xff, 0xff]]);
    expect(Array.from(decodePng(png).data)).toEqual([0x12, 0x56, 0x9a, 0xff]);
  });
  it("rejects what is not a PNG", () => {
    expect(() => decodePng(Buffer.from("hello world, not a png"))).toThrow(/Not a PNG/);
  });
});

describe("diffFrames", () => {
  it("reports identical frames", () => {
    const d = diffFrames(solid(8, 8, [1, 2, 3, 255]), solid(8, 8, [1, 2, 3, 255]));
    expect(d).toMatchObject({ sameSize: true, maxDiff: 0, changedPixels: 0, bbox: null });
  });
  it("ignores noise within the threshold but still reports its size", () => {
    const d = diffFrames(solid(4, 4, [100, 100, 100, 255]), solid(4, 4, [102, 99, 100, 255]), 2);
    expect(d.changedPixels).toBe(0);
    expect(d.maxDiff).toBe(2);
  });
  it("finds the changed area", () => {
    const a = solid(10, 10, [0, 0, 0, 255]);
    const b = solid(10, 10, [0, 0, 0, 255]);
    for (let y = 3; y <= 5; y++)
      for (let x = 2; x <= 7; x++) b.data.set([255, 0, 0, 255], (y * 10 + x) * 4);
    const d = diffFrames(a, b);
    expect(d.changedPixels).toBe(18);
    expect(d.bbox).toEqual([2, 3, 6, 3]);
    expect(d.maxDiff).toBe(255);
    expect(d.changedShare).toBeCloseTo(0.18);
  });
  it("flags a size change", () => {
    expect(diffFrames(solid(4, 4, [0, 0, 0, 255]), solid(4, 5, [0, 0, 0, 255])).sameSize).toBe(
      false,
    );
  });
});

describe("buildDiffImage", () => {
  it("lays out before | after | difference, scaled to the panel width", () => {
    const a = solid(100, 40, [0, 0, 0, 255]);
    const b = solid(100, 40, [0, 0, 0, 255]);
    b.data.set([10, 0, 0, 255], (20 * 100 + 50) * 4);
    const img = buildDiffImage(a, b, [0, 0, 100, 40], 50, 0, 8);
    expect(img.width).toBe(50 * 3 + 8);
    expect(img.height).toBe(20);
    // difference panel: amplified grey where the pixel changed, black elsewhere
    const at = (x: number, y: number) =>
      Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
    expect(at(2 * 54 + 25, 10)).toEqual([80, 80, 80, 255]);
    expect(at(2 * 54 + 5, 3)).toEqual([0, 0, 0, 255]);
    expect(at(25 + 54, 10)).toEqual([10, 0, 0, 255]);
  });
});

describe("snapshot names", () => {
  it("accepts simple names only", () => {
    expect(safeSnapshotName("before-bake_2")).toBe("before-bake_2");
    expect(safeSnapshotName("../x")).toBeNull();
    expect(safeSnapshotName("a b")).toBeNull();
    expect(safeSnapshotName("")).toBeNull();
  });
  it("pads frame files", () => {
    expect(snapshotFrameFile(123)).toBe("f000123.png");
  });
});

describe("frame captions", () => {
  it("shows the frame number when the bridge reports it", () => {
    expect(frameLabel({ time: 2, frame: 120 })).toBe("frame 120 (t=2s)");
    expect(frameLabel({ time: 2 })).toBe("t=2s");
    const blocks = buildFrameContent(
      "Main",
      [{ time: 2, frame: 120, path: "/a.png", w: 4, h: 4 }],
      () => "AAAA",
    );
    expect(blocks[1]).toEqual({ type: "text", text: "Main @ frame 120 (t=2s) 4x4" });
  });
});
