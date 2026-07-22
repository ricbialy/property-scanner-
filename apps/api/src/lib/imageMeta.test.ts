import { describe, expect, it } from "vitest";

import { jpegDimensions, pngDimensions, sniffImageType, stripJpegExif } from "./imageMeta.js";
import { buildJpeg, buildPng } from "./imageFixtures.js";

describe("sniffImageType", () => {
  it("recognizes jpeg, png, heic, and rejects others", () => {
    expect(sniffImageType(buildJpeg())).toBe("image/jpeg");
    expect(sniffImageType(buildPng(1, 1))).toBe("image/png");
    const heic = new Uint8Array(16);
    heic.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    expect(sniffImageType(heic)).toBe("image/heic");
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBe("unknown");
    expect(sniffImageType(new Uint8Array([0x4d, 0x5a]))).toBe("unknown");
  });
});

describe("dimensions", () => {
  it("reads PNG IHDR dimensions", () => {
    expect(pngDimensions(buildPng(640, 480))).toEqual({ widthPx: 640, heightPx: 480 });
    expect(pngDimensions(buildJpeg())).toBeNull();
  });

  it("reads JPEG SOF dimensions, skipping other segments", () => {
    expect(jpegDimensions(buildJpeg({ withExif: true, withXmp: true }))).toEqual({
      widthPx: 2,
      heightPx: 3
    });
  });
});

describe("stripJpegExif", () => {
  it("removes Exif APP1 segments while preserving other APP1 and image data", () => {
    const original = buildJpeg({ withExif: true, withXmp: true });
    const { data, strippedSegments } = stripJpegExif(original);
    expect(strippedSegments).toBe(1);
    // The fake GPS payload must be gone.
    const hex = Buffer.from(data).toString("hex");
    expect(hex).not.toContain("deadbeef");
    // Still a valid-looking JPEG with the XMP APP1 and correct dimensions.
    expect(sniffImageType(data)).toBe("image/jpeg");
    expect(hex).toContain("68747470"); // "http" XMP payload preserved
    expect(jpegDimensions(data)).toEqual({ widthPx: 2, heightPx: 3 });
  });

  it("is a no-op for jpegs without Exif and for non-jpegs", () => {
    const clean = buildJpeg({ withXmp: true });
    expect(stripJpegExif(clean).strippedSegments).toBe(0);
    expect(stripJpegExif(clean).data).toBe(clean);
    const png = buildPng(2, 2);
    expect(stripJpegExif(png).data).toBe(png);
  });
});
