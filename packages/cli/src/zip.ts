import { deflateRawSync } from 'node:zlib';

/**
 * A minimal in-memory ZIP writer (no zip64, no encryption), so folder uploads need no external
 * `zip` binary and no temp file on disk. Entries are deflated, or stored when deflate does not
 * help. Output opens with every common unzip tool.
 */

export const MAX_ENTRIES = 0xffff;
/** Without zip64 neither a size nor an offset may reach 4 GiB. */
export const MAX_ZIP_BYTES = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

interface CentralEntry {
  name: Buffer;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  time: number;
  date: number;
  mode: number;
  offset: number;
}

export class ZipWriter {
  private readonly parts: Buffer[] = [];
  private readonly central: CentralEntry[] = [];
  private offset = 0;

  /** Bytes written so far, excluding the central directory (a lower bound of the final size). */
  get bytes(): number {
    return this.offset;
  }

  get count(): number {
    return this.central.length;
  }

  add(name: string, data: Buffer, mtime: Date, mode: number): void {
    if (this.central.length >= MAX_ENTRIES) throw new RangeError('too many entries for a zip');
    if (data.length > MAX_ZIP_BYTES) throw new RangeError('file too large for a zip');
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = data.length > 0 ? deflateRawSync(data) : data;
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const stamp = dosDateTime(mtime);
    const crc = crc32(data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    header.writeUInt16LE(stored ? 0 : 8, 8);
    header.writeUInt16LE(stamp.time, 10);
    header.writeUInt16LE(stamp.date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);

    this.central.push({
      name: nameBytes,
      method: stored ? 0 : 8,
      crc,
      compressedSize: body.length,
      size: data.length,
      time: stamp.time,
      date: stamp.date,
      mode,
      offset: this.offset,
    });
    this.parts.push(header, nameBytes, body);
    this.offset += header.length + nameBytes.length + body.length;
    if (this.offset > MAX_ZIP_BYTES) throw new RangeError('zip too large');
  }

  finish(): Buffer {
    const start = this.offset;
    const records: Buffer[] = [];
    for (const e of this.central) {
      const rec = Buffer.alloc(46);
      rec.writeUInt32LE(0x02014b50, 0);
      rec.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, spec 2.0 (so the mode bits are honoured)
      rec.writeUInt16LE(20, 6);
      rec.writeUInt16LE(0x0800, 8);
      rec.writeUInt16LE(e.method, 10);
      rec.writeUInt16LE(e.time, 12);
      rec.writeUInt16LE(e.date, 14);
      rec.writeUInt32LE(e.crc, 16);
      rec.writeUInt32LE(e.compressedSize, 20);
      rec.writeUInt32LE(e.size, 24);
      rec.writeUInt16LE(e.name.length, 28);
      rec.writeUInt32LE(((e.mode & 0xffff) << 16) >>> 0, 38); // external attributes
      rec.writeUInt32LE(e.offset, 42);
      records.push(rec, e.name);
    }
    const directory = Buffer.concat(records);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.central.length, 8);
    end.writeUInt16LE(this.central.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(start, 16);
    const out = Buffer.concat([...this.parts, directory, end]);
    if (out.length > MAX_ZIP_BYTES) throw new RangeError('zip too large');
    return out;
  }
}
