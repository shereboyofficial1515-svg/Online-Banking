// Minimal, dependency-free image inspection for uploaded brand assets: identifies the real format from the bytes (never from
// the filename or the client-declared type) and reads the pixel dimensions from the header. Returns null for anything that is
// not a well-formed PNG, JPEG, WebP or ICO - which also rejects SVG/HTML/script payloads renamed to look like images.
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function imageInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;

  // PNG: signature, then a 13-byte IHDR chunk carrying width/height.
  if (buf.subarray(0, 8).equals(PNG_SIG)) {
    if (buf.readUInt32BE(8) !== 13 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
    const width = buf.readUInt32BE(16); const height = buf.readUInt32BE(20);
    return width > 0 && height > 0 ? { mime: 'image/png', ext: 'png', width, height } : null;
  }

  // JPEG: walk markers until a Start-Of-Frame segment.
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        const height = buf.readUInt16BE(i + 5); const width = buf.readUInt16BE(i + 7);
        return width > 0 && height > 0 ? { mime: 'image/jpeg', ext: 'jpg', width, height } : null;
      }
      i += 2 + len;
    }
    return null;
  }

  // WebP (RIFF container): lossy VP8, lossless VP8L or extended VP8X.
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buf.toString('latin1', 12, 16);
    let width; let height;
    if (kind === 'VP8 ' && buf.length >= 30) { width = buf.readUInt16LE(26) & 0x3fff; height = buf.readUInt16LE(28) & 0x3fff; }
    else if (kind === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) { const b = buf.readUInt32LE(21); width = (b & 0x3fff) + 1; height = ((b >> 14) & 0x3fff) + 1; }
    else if (kind === 'VP8X' && buf.length >= 30) { width = 1 + buf.readUIntLE(24, 3); height = 1 + buf.readUIntLE(27, 3); }
    return width > 0 && height > 0 ? { mime: 'image/webp', ext: 'webp', width, height } : null;
  }

  // ICO: reserved 0, type 1, then a directory of icon sizes.
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) {
    const count = buf.readUInt16LE(4);
    if (count < 1 || count > 32 || buf.length < 6 + count * 16) return null;
    let width = 0; let height = 0;
    for (let i = 0; i < count; i++) { width = Math.max(width, buf[6 + i * 16] || 256); height = Math.max(height, buf[7 + i * 16] || 256); }
    return { mime: 'image/x-icon', ext: 'ico', width, height };
  }
  return null;
}
