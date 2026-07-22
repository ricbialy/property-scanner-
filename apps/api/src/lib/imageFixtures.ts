/** Tiny hand-built image byte fixtures for media tests. */

/** Minimal valid JPEG: SOI, optional APP1 segments, SOF0 (2×3 px), SOS, EOI. */
export function buildJpeg(options?: { withExif?: boolean; withXmp?: boolean }): Uint8Array {
  const parts: number[] = [0xff, 0xd8]; // SOI
  if (options?.withExif) {
    // APP1 "Exif\0\0" + fake GPS payload bytes (deadbeef marker for tests).
    const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef];
    parts.push(0xff, 0xe1, 0x00, payload.length + 2, ...payload);
  }
  if (options?.withXmp) {
    // APP1 that is NOT Exif (starts "http") — must be preserved.
    const payload = [0x68, 0x74, 0x74, 0x70, 0x00];
    parts.push(0xff, 0xe1, 0x00, payload.length + 2, ...payload);
  }
  // SOF0: length 17, precision 8, height 3, width 2, 3 components.
  parts.push(0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x03, 0x00, 0x02, 0x03);
  parts.push(0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00);
  // SOS with tiny payload, then EOI.
  parts.push(0xff, 0xda, 0x00, 0x02, 0x12, 0x34, 0xff, 0xd9);
  return new Uint8Array(parts);
}

export function buildPng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
