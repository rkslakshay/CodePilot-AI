/**
 * Minimal, defensive ZIP reader built on node:zlib (no third-party dependency).
 *
 * Security properties (each enforced, each tested):
 * - entry names are normalised and rejected when absolute, drive-qualified, UNC, containing `..`,
 *   NUL bytes or Windows-reserved device names (path traversal / "zip slip")
 * - symbolic-link entries (Unix mode 0120000) are rejected, never created
 * - encrypted entries and unsupported compression methods are rejected
 * - hard limits: archive size, entry count, per-entry size, total uncompressed size and
 *   compression ratio (zip-bomb protection); inflation is capped with `maxOutputLength`
 * - extraction only ever writes inside the destination folder (re-checked after resolving)
 */
import { inflateRawSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export const ZIP_LIMITS = {
  maxArchiveBytes: 100 * 1024 * 1024,
  maxEntries: 20_000,
  maxEntryBytes: 20 * 1024 * 1024,
  maxTotalBytes: 400 * 1024 * 1024,
  maxRatio: 200,
};

export class ZipError extends Error {
  constructor(
    message: string,
    public code: 'not_zip' | 'too_large' | 'too_many_entries' | 'unsafe_path' | 'symlink' | 'encrypted' | 'unsupported' | 'corrupt' | 'bomb',
  ) {
    super(message);
  }
}

export interface ZipEntry {
  name: string;
  isDir: boolean;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
  crc: number;
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Normalises an entry name to a safe relative POSIX path, or throws. */
export function safeEntryName(raw: string): string {
  if (raw.includes('\0')) throw new ZipError(`Unsafe entry name: ${JSON.stringify(raw)}`, 'unsafe_path');
  const n = raw.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.startsWith('//')) throw new ZipError(`Absolute path in archive: ${raw}`, 'unsafe_path');
  const parts = n.split('/').filter((p) => p !== '' && p !== '.');
  for (const p of parts) {
    if (p === '..') throw new ZipError(`Path traversal in archive: ${raw}`, 'unsafe_path');
    if (RESERVED.test(p) || /[<>:"|?*]/.test(p) || /[. ]$/.test(p)) throw new ZipError(`Name not allowed on Windows: ${raw}`, 'unsafe_path');
  }
  return parts.join('/');
}

export function readZipEntries(buf: Buffer): ZipEntry[] {
  if (buf.length > ZIP_LIMITS.maxArchiveBytes) throw new ZipError(`Archive is larger than ${ZIP_LIMITS.maxArchiveBytes / 1024 / 1024} MB`, 'too_large');
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) {
    // empty archives start with the end-of-central-directory record
    if (!(buf.length >= 22 && buf.readUInt32LE(0) === 0x06054b50)) throw new ZipError('Not a ZIP archive', 'not_zip');
  }
  // locate end of central directory (scan back over a possible comment)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('ZIP end record not found (corrupt or truncated archive)', 'corrupt');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError('ZIP64 archives are not supported', 'unsupported');
  if (count > ZIP_LIMITS.maxEntries) throw new ZipError(`Archive has more than ${ZIP_LIMITS.maxEntries} entries`, 'too_many_entries');
  if (cdOffset + cdSize > buf.length) throw new ZipError('Central directory is outside the archive', 'corrupt');
  const out: ZipEntry[] = [];
  let p = cdOffset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('Corrupt central directory', 'corrupt');
    const madeBy = buf.readUInt16LE(p + 4) >> 8;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38);
    const offset = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    p += 46 + nameLen + extraLen + commentLen;
    const isDir = rawName.endsWith('/') || rawName.endsWith('\\');
    const unixMode = madeBy === 3 ? extAttr >>> 16 : 0;
    if ((unixMode & 0o170000) === 0o120000) throw new ZipError(`Symbolic link in archive: ${rawName}`, 'symlink');
    if (flags & 0x1) throw new ZipError(`Encrypted entry: ${rawName}`, 'encrypted');
    if (!isDir && method !== 0 && method !== 8) throw new ZipError(`Unsupported compression method ${method}: ${rawName}`, 'unsupported');
    const name = safeEntryName(rawName);
    if (!name) continue;
    if (!isDir) {
      if (size > ZIP_LIMITS.maxEntryBytes) throw new ZipError(`Entry too large (${size} bytes): ${name}`, 'too_large');
      if (compressedSize > 0 && size / compressedSize > ZIP_LIMITS.maxRatio && size > 1024 * 1024) throw new ZipError(`Suspicious compression ratio: ${name}`, 'bomb');
      total += size;
      if (total > ZIP_LIMITS.maxTotalBytes) throw new ZipError(`Archive expands to more than ${ZIP_LIMITS.maxTotalBytes / 1024 / 1024} MB`, 'bomb');
    }
    out.push({ name, isDir, method, compressedSize, size, offset, crc });
  }
  return out;
}

export function readEntryData(buf: Buffer, e: ZipEntry): Buffer {
  const p = e.offset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) throw new ZipError(`Corrupt local header: ${e.name}`, 'corrupt');
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const end = start + e.compressedSize;
  if (end > buf.length) throw new ZipError(`Entry data outside archive: ${e.name}`, 'corrupt');
  const raw = buf.subarray(start, end);
  if (e.method === 0) return Buffer.from(raw);
  try {
    const data = inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) });
    if (data.length !== e.size) throw new ZipError(`Size mismatch: ${e.name}`, 'corrupt');
    return data;
  } catch (err) {
    if (err instanceof ZipError) throw err;
    throw new ZipError(`Could not decompress ${e.name}: ${(err as Error).message}`, 'corrupt');
  }
}

/**
 * Validates the whole archive first (nothing is written if any entry is unsafe), then extracts
 * into `dest`, which must not exist yet. Returns the extracted file names.
 */
export function extractZip(buf: Buffer, dest: string, accept: (name: string, size: number) => boolean = () => true): string[] {
  const entries = readZipEntries(buf);
  const root = resolve(dest);
  mkdirSync(root, { recursive: true });
  const written: string[] = [];
  for (const e of entries) {
    if (e.isDir || !accept(e.name, e.size)) continue;
    const target = resolve(join(root, ...e.name.split('/')));
    if (!target.startsWith(root + sep)) throw new ZipError(`Entry escapes the destination: ${e.name}`, 'unsafe_path');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readEntryData(buf, e), { flag: 'wx' });
    written.push(e.name);
  }
  return written;
}

/** Writes a ZIP archive (stored entries) — used by tests to craft valid and malicious archives. */
export function buildZip(files: { name: string; data: Buffer | string; unixMode?: number; encrypted?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x800 | (f.encrypted ? 1 : 0), 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE((3 << 8) | 20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x800 | (f.encrypted ? 1 : 0), 8);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(((f.unixMode ?? 0o100644) << 16) >>> 0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
