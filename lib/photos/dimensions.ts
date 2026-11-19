// Reads an image's size from its first bytes, so the Worker can enforce the minimum size and the pixel limit
// WITHOUT decoding the picture (a Worker has no image library). Handles JPEG, PNG and WebP only (see sniff.ts).
// Anything it cannot read confidently returns null and the upload is refused.

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

function jpegOrientation(b: Uint8Array, app1: number, len: number): number {
  // APP1 "Exif\0\0" + TIFF header; orientation is IFD0 tag 0x0112.
  const t = app1 + 6;
  if (len < 14 || b[app1] !== 0x45 || b[app1 + 1] !== 0x78 || b[app1 + 2] !== 0x69 || b[app1 + 3] !== 0x66) return 1;
  const le = b[t] === 0x49; // "II" little endian, "MM" big endian
  const r16 = (i: number) => (le ? u16le(b, i) : u16be(b, i));
  const r32 = (i: number) => (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : u32be(b, i));
  const ifd = t + r32(t + 4);
  if (ifd + 2 > b.length) return 1;
  const n = Math.min(r16(ifd), 64);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > b.length) break;
    if (r16(e) === 0x0112) return r16(e + 8);
  }
  return 1;
}

function jpeg(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  let orientation = 1;
  while (i + 4 < b.length) {
    if (b[i] !== 0xff) return null;
    let m = b[i + 1];
    while (m === 0xff && i + 2 < b.length) { i++; m = b[i + 1]; } // fill bytes
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    if (m === 0xe1) orientation = jpegOrientation(b, i + 4, len - 2);
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
      if (i + 9 > b.length) return null;
      const height = u16be(b, i + 5);
      const width = u16be(b, i + 7);
      return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height }; // sideways photos: the size as displayed
    }
    if (m === 0xda) return null; // start of scan with no frame header: not a valid picture
    i += 2 + len;
  }
  return null;
}

function png(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24 || b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null; // IHDR must come first
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function webp(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (tag === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  if (tag === "VP8L") {
    if (b[20] !== 0x2f) return null;
    return { width: 1 + (b[21] | ((b[22] & 0x3f) << 8)), height: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)) };
  }
  if (tag === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  return null;
}

export function imageDimensions(bytes: Uint8Array, kind: "jpeg" | "png" | "webp"): { width: number; height: number } | null {
  const d = kind === "jpeg" ? jpeg(bytes) : kind === "png" ? png(bytes) : webp(bytes);
  return d && d.width > 0 && d.height > 0 ? d : null;
}
