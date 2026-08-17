/**
 * Pure helpers for media validation: MIME signature sniffing, pixel dimensions
 * (JPEG/PNG headers), and EXIF removal for JPEG.
 *
 * EXIF policy: the entire APP1 Exif segment is dropped rather than surgically
 * removing only the GPS IFD — partial TIFF rewrites risk leaving GPS bytes
 * reachable through stale offsets. Trade-off: EXIF orientation is lost, so
 * clients must upload orientation-baked pixels (iOS re-encodes do). HEIC
 * metadata handling requires a real image toolchain and is deferred; HEIC is
 * stored as-is with exif_policy "unstripped_pending" and flagged for the
 * processing worker.
 */

export type SniffedType = "image/jpeg" | "image/png" | "image/heic" | "unknown";

export function sniffImageType(bytes: Uint8Array): SniffedType {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // ISO-BMFF: [4-byte box size]"ftyp"<brand>; HEIC brands heic/heix/mif1/msf1.
  if (bytes.length >= 12) {
    const ftyp = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
    const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    if (ftyp === "ftyp" && ["heic", "heix", "mif1", "msf1", "hevc"].includes(brand)) {
      return "image/heic";
    }
  }
  return "unknown";
}

export interface PixelDimensions {
  widthPx: number;
  heightPx: number;
}

/** PNG dimensions from the IHDR chunk (always first, at fixed offset). */
export function pngDimensions(bytes: Uint8Array): PixelDimensions | null {
  if (sniffImageType(bytes) !== "image/png" || bytes.length < 24) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { widthPx: view.getUint32(16), heightPx: view.getUint32(20) };
}

/** JPEG dimensions from the first SOF0–SOF15 frame marker (excluding DHT/DAC). */
export function jpegDimensions(bytes: Uint8Array): PixelDimensions | null {
  if (sniffImageType(bytes) !== "image/jpeg") {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = view.getUint16(offset + 2);
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > bytes.length) return null;
      return {
        heightPx: view.getUint16(offset + 5),
        widthPx: view.getUint16(offset + 7)
      };
    }
    if (marker === 0xda) {
      return null; // start of scan without a SOF — malformed
    }
    offset += 2 + segmentLength;
  }
  return null;
}

/**
 * Return the JPEG with all APP1 Exif segments removed (see module note).
 * Non-Exif APP1 (e.g. XMP) is preserved. Returns the input untouched when it
 * is not a JPEG.
 */
export function stripJpegExif(bytes: Uint8Array): { data: Uint8Array; strippedSegments: number } {
  if (sniffImageType(bytes) !== "image/jpeg") {
    return { data: bytes, strippedSegments: 0 };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keep: Array<[number, number]> = [[0, 2]]; // SOI
  let offset = 2;
  let stripped = 0;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      break;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xda) {
      // Start of scan: keep the remainder verbatim.
      keep.push([offset, bytes.length]);
      offset = bytes.length;
      break;
    }
    const segmentLength = view.getUint16(offset + 2);
    const segmentEnd = offset + 2 + segmentLength;
    const isExif =
      marker === 0xe1 &&
      segmentLength >= 8 &&
      bytes[offset + 4] === 0x45 && // 'E'
      bytes[offset + 5] === 0x78 && // 'x'
      bytes[offset + 6] === 0x69 && // 'i'
      bytes[offset + 7] === 0x66; // 'f'
    if (isExif) {
      stripped += 1;
    } else {
      keep.push([offset, segmentEnd]);
    }
    offset = segmentEnd;
  }
  if (offset < bytes.length && keep[keep.length - 1]?.[1] !== bytes.length) {
    keep.push([offset, bytes.length]);
  }
  if (stripped === 0) {
    return { data: bytes, strippedSegments: 0 };
  }
  const total = keep.reduce((sum, [a, b]) => sum + (b - a), 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const [a, b] of keep) {
    out.set(bytes.subarray(a, b), cursor);
    cursor += b - a;
  }
  return { data: out, strippedSegments: stripped };
}
