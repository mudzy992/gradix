const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function detectMime(buffer: Buffer): string | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === '%PDF') {
    return 'application/pdf';
  }
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const head = buffer.toString('utf8', 0, Math.min(buffer.length, 8000));
    if (head.includes('word/')) {
      return DOCX;
    }
    if (head.includes('xl/')) {
      return XLSX;
    }
  }
  return null;
}
