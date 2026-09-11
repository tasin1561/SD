/**
 * A minimal .xls reader — just enough to read a courier's remittance export.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * Shiprocket's remittance download is a genuine Excel 97-2003 workbook
 * (BIFF8 inside an OLE compound file), not the zip-of-XML .xlsx that
 * `common/xlsx/xlsx-reader` reads. The same argument that produced that
 * reader applies here: a general spreadsheet library is a large surface
 * with a history of parser CVEs, taken on to read a dozen columns off a
 * file one courier produces.
 *
 * ── WHAT IT READS, AND WHAT IT REFUSES ───────────────────────────────
 * Two layers, both deliberately narrow:
 *
 *  - The compound-file container: header, FAT (including DIFAT chains),
 *    directory, and the mini stream small workbooks are stored in. Every
 *    chain is cut at the size the directory states and checked for loops.
 *    That tolerance is load-bearing, not incidental: the first real
 *    Shiprocket export has its root entry's chain running straight into
 *    the workbook's, which strict readers reject as corruption (xlrd
 *    does). Truncating each stream at its own declared size reads it
 *    correctly.
 *  - BIFF8 cells: the shared string table (including strings split across
 *    CONTINUE records), LABELSST, LABEL, NUMBER, RK, MULRK and BOOLERR.
 *
 * A formula, an error value, an encrypted workbook or a pre-1997 format
 * is REFUSED by name rather than read approximately. A silent misread is
 * the failure mode that matters: it would attribute money to the wrong
 * parcels and look fine. The caller is expected to cross-check what it
 * parsed against a total the file itself states.
 *
 * Numbers come back as JavaScript's shortest round-trip text, so a
 * waybill Excel stored as the double 14112364794902 reads as
 * "14112364794902" — never "1.4112364794902e+13".
 */

export class XlsError extends Error {}

const SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const MAX_REG_SECT = 0xfffffffa;
const ENTRY_STREAM = 2;
const ENTRY_ROOT = 5;

/** Is this an OLE compound file — the container every .xls lives in? */
export function isXls(file: Buffer): boolean {
  return file.length >= 512 && file.subarray(0, 8).equals(SIGNATURE);
}

// ── The compound-file container ──────────────────────────────────────

interface DirEntry {
  readonly name: string;
  readonly type: number;
  readonly start: number;
  readonly size: number;
}

interface Container {
  readonly file: Buffer;
  readonly sectorSize: number;
  readonly fat: readonly number[];
  readonly miniFat: readonly number[];
  readonly miniSectorSize: number;
  readonly miniCutoff: number;
  readonly entries: readonly DirEntry[];
}

function sectorAt(c: { file: Buffer; sectorSize: number }, sector: number): Buffer {
  // Sector N follows the header, which occupies exactly one sector's
  // worth of space (512 bytes in v3, 4096 in v4).
  const off = (sector + 1) * c.sectorSize;
  if (off >= c.file.length) throw new XlsError(`sector ${sector} lies past the end of the file`);
  return c.file.subarray(off, Math.min(off + c.sectorSize, c.file.length));
}

/** Follow a chain until ENDOFCHAIN (or `limit` bytes), refusing loops. */
function followChain(
  next: (s: number) => number | undefined,
  read: (s: number) => Buffer,
  start: number,
  limit: number,
  what: string,
): Buffer {
  const parts: Buffer[] = [];
  const seen = new Set<number>();
  let got = 0;
  let s = start;
  while (got < limit && s <= MAX_REG_SECT) {
    if (seen.has(s)) throw new XlsError(`${what} loops back on itself`);
    seen.add(s);
    const chunk = read(s);
    parts.push(chunk);
    got += chunk.length;
    const n = next(s);
    if (n === undefined) throw new XlsError(`${what} points at a sector the file does not index`);
    s = n;
  }
  if (Number.isFinite(limit) && got < limit) {
    throw new XlsError(`${what} ends after ${got} of its ${limit} bytes`);
  }
  const all = Buffer.concat(parts);
  return Number.isFinite(limit) ? all.subarray(0, limit) : all;
}

function u32s(buf: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i + 4 <= buf.length; i += 4) out.push(buf.readUInt32LE(i));
  return out;
}

function openContainer(file: Buffer): Container {
  if (!isXls(file)) {
    throw new XlsError('not an Excel 97-2003 (.xls) file — the compound-file signature is missing');
  }
  const sectorShift = file.readUInt16LE(30);
  const miniShift = file.readUInt16LE(32);
  if (sectorShift !== 9 && sectorShift !== 12) {
    throw new XlsError(`unsupported sector size 2^${sectorShift}`);
  }
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniShift;
  const nFat = file.readUInt32LE(44);
  const dirStart = file.readUInt32LE(48);
  const miniCutoff = file.readUInt32LE(56);
  const miniFatStart = file.readUInt32LE(60);
  const nMiniFat = file.readUInt32LE(64);
  let difatNext = file.readUInt32LE(68);
  const nDifat = file.readUInt32LE(72);
  const base = { file, sectorSize };

  // Where the FAT itself lives: 109 slots in the header, then a chain of
  // DIFAT sectors for anything larger (each ends with its successor).
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < nFat; i++) {
    fatSectors.push(file.readUInt32LE(76 + i * 4));
  }
  for (let i = 0; i < nDifat && fatSectors.length < nFat; i++) {
    if (difatNext > MAX_REG_SECT) break;
    const words = u32s(sectorAt(base, difatNext));
    for (const w of words.slice(0, -1)) if (fatSectors.length < nFat) fatSectors.push(w);
    difatNext = words.at(-1) ?? 0xffffffff;
  }
  if (fatSectors.length < nFat) {
    throw new XlsError(`the file indexes ${fatSectors.length} of its ${nFat} FAT sectors`);
  }
  const fat = fatSectors.flatMap((s) => u32s(sectorAt(base, s)));
  const nextReg = (s: number): number | undefined => fat[s];
  const readReg = (s: number): Buffer => sectorAt(base, s);

  const dir = followChain(nextReg, readReg, dirStart, Infinity, 'the directory');
  const entries: DirEntry[] = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const type = dir.readUInt8(off + 66);
    if (type === 0) continue;
    const nameLen = Math.min(dir.readUInt16LE(off + 64), 64);
    entries.push({
      name: dir.toString('utf16le', off, off + Math.max(nameLen - 2, 0)),
      type,
      start: dir.readUInt32LE(off + 116),
      size: dir.readUInt32LE(off + 120),
    });
  }

  const miniFat =
    nMiniFat > 0 && miniFatStart <= MAX_REG_SECT
      ? u32s(followChain(nextReg, readReg, miniFatStart, Infinity, 'the mini FAT'))
      : [];

  return { file, sectorSize, fat, miniFat, miniSectorSize, miniCutoff, entries };
}

function readStream(c: Container, name: string): Buffer | null {
  const entry = c.entries.find((e) => e.type === ENTRY_STREAM && e.name === name);
  if (entry === undefined) return null;
  const nextReg = (s: number): number | undefined => c.fat[s];
  const readReg = (s: number): Buffer => sectorAt(c, s);
  if (entry.size >= c.miniCutoff) {
    return followChain(nextReg, readReg, entry.start, entry.size, `the ${name} stream`);
  }
  // Small streams live in 64-byte slices of the root entry's own stream.
  const root = c.entries.find((e) => e.type === ENTRY_ROOT);
  if (root === undefined) throw new XlsError('the file has no root entry');
  const mini = followChain(nextReg, readReg, root.start, root.size, 'the mini stream');
  const readMini = (s: number): Buffer => {
    const off = s * c.miniSectorSize;
    if (off >= mini.length) throw new XlsError(`mini sector ${s} lies past the mini stream`);
    return mini.subarray(off, Math.min(off + c.miniSectorSize, mini.length));
  };
  return followChain((s) => c.miniFat[s], readMini, entry.start, entry.size, `the ${name} stream`);
}

// ── BIFF8 records ────────────────────────────────────────────────────

const BOF = 0x0809;
const EOF = 0x000a;
const BOUNDSHEET = 0x0085;
const SST = 0x00fc;
const CONTINUE = 0x003c;
const FILEPASS = 0x002f;
const LABELSST = 0x00fd;
const LABEL = 0x0204;
const NUMBER = 0x0203;
const RK = 0x027e;
const MULRK = 0x00bd;
const BOOLERR = 0x0205;
const FORMULA = 0x0006;
const RSTRING = 0x00d6;
const BIFF8 = 0x0600;

interface BiffRecord {
  readonly op: number;
  readonly data: Buffer;
  readonly offset: number;
}

function recordAt(stream: Buffer, p: number): BiffRecord {
  if (p + 4 > stream.length) throw new XlsError(`the workbook is truncated at byte ${p}`);
  const op = stream.readUInt16LE(p);
  const len = stream.readUInt16LE(p + 2);
  if (p + 4 + len > stream.length) throw new XlsError(`a record at byte ${p} runs past the end`);
  return { op, data: stream.subarray(p + 4, p + 4 + len), offset: p };
}

/**
 * Reads bytes across an SST record and the CONTINUE records after it.
 * A string's CHARACTERS may be split between records, and the next record
 * then opens with a fresh flags byte saying whether the rest is one byte
 * or two per character. Its header and trailing runs carry no such byte.
 */
class SegmentReader {
  private seg = 0;
  private pos = 0;
  constructor(private readonly segs: readonly Buffer[]) {}

  private current(): Buffer {
    let s = this.segs[this.seg];
    while (s !== undefined && this.pos >= s.length) {
      this.seg++;
      this.pos = 0;
      s = this.segs[this.seg];
    }
    if (s === undefined) throw new XlsError('the shared string table is truncated');
    return s;
  }

  u8(): number {
    const s = this.current();
    const v = s.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }

  u16(): number {
    return this.u8() | (this.u8() << 8);
  }

  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }

  skip(n: number): void {
    for (let i = 0; i < n; i++) this.u8();
  }

  chars(count: number, twoBytes: boolean): string {
    let out = '';
    let wide = twoBytes;
    let left = count;
    while (left > 0) {
      let s = this.segs[this.seg];
      if (s === undefined) throw new XlsError('the shared string table is truncated');
      if (this.pos >= s.length) {
        // Split: the next CONTINUE restates the character width.
        this.seg++;
        this.pos = 0;
        s = this.segs[this.seg];
        if (s === undefined) throw new XlsError('a shared string is cut off');
        wide = (s.readUInt8(0) & 0x01) === 1;
        this.pos = 1;
      }
      const room = s.length - this.pos;
      const n = Math.min(left, wide ? Math.floor(room / 2) : room);
      if (n === 0) throw new XlsError('a shared string is split mid-character');
      const end = this.pos + (wide ? n * 2 : n);
      out += s.toString(wide ? 'utf16le' : 'latin1', this.pos, end);
      this.pos = end;
      left -= n;
    }
    return out;
  }
}

function readSst(segs: readonly Buffer[]): string[] {
  const r = new SegmentReader(segs);
  r.u32(); // total references — not needed
  const unique = r.u32();
  const out: string[] = [];
  for (let i = 0; i < unique; i++) {
    const cch = r.u16();
    const flags = r.u8();
    const runs = (flags & 0x08) !== 0 ? r.u16() : 0;
    const ext = (flags & 0x04) !== 0 ? r.u32() : 0;
    out.push(r.chars(cch, (flags & 0x01) !== 0));
    r.skip(runs * 4 + ext);
  }
  return out;
}

/** BIFF8's XLUnicodeString inside one record (LABEL, BOUNDSHEET). */
function inlineString(data: Buffer, at: number, cch: number, flags: number): string {
  const wide = (flags & 0x01) !== 0;
  const end = at + (wide ? cch * 2 : cch);
  if (end > data.length) throw new XlsError('a text cell runs past its record');
  return data.toString(wide ? 'utf16le' : 'latin1', at, end);
}

function rkValue(rk: number): number {
  let v: number;
  if ((rk & 0x02) !== 0) {
    v = rk >> 2; // a 30-bit signed integer
  } else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4);
    v = b.readDoubleLE(0);
  }
  return (rk & 0x01) !== 0 ? v / 100 : v;
}

function numberText(n: number, where: string): string {
  if (!Number.isFinite(n)) throw new XlsError(`${where} holds a number that is not finite`);
  return Object.is(n, -0) ? '0' : String(n);
}

function cellName(row: number, col: number): string {
  let c = col;
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (c % 26)) + letters;
    c = Math.floor(c / 26) - 1;
  } while (c >= 0);
  return `${letters}${row + 1}`;
}

interface SheetRef {
  readonly name: string;
  readonly offset: number;
  readonly type: number;
}

export interface XlsWorkbook {
  readonly sheetNames: readonly string[];
  /** Rows of text, or null when there is no such sheet. */
  sheet(name: string): string[][] | null;
}

function readCells(stream: Buffer, sheet: SheetRef, sst: readonly string[]): string[][] {
  const first = recordAt(stream, sheet.offset);
  if (first.op !== BOF) throw new XlsError(`sheet "${sheet.name}" does not start where it says`);
  const cells = new Map<number, Map<number, string>>();
  const put = (row: number, col: number, v: string): void => {
    let r = cells.get(row);
    if (r === undefined) cells.set(row, (r = new Map()));
    r.set(col, v);
  };

  let p = sheet.offset + 4 + first.data.length;
  for (;;) {
    const rec = recordAt(stream, p);
    p += 4 + rec.data.length;
    const d = rec.data;
    if (rec.op === EOF) break;
    if (rec.op === BOF) {
      throw new XlsError(
        `sheet "${sheet.name}" contains an embedded object this reader does not read`,
      );
    }
    if (d.length < 4) continue;
    const row = d.readUInt16LE(0);
    const col = d.readUInt16LE(2);
    switch (rec.op) {
      case LABELSST: {
        const s = sst[d.readUInt32LE(6)];
        if (s === undefined) throw new XlsError(`${cellName(row, col)} names a missing string`);
        put(row, col, s);
        break;
      }
      case LABEL:
        put(row, col, inlineString(d, 9, d.readUInt16LE(6), d.readUInt8(8)));
        break;
      case NUMBER:
        put(row, col, numberText(d.readDoubleLE(6), cellName(row, col)));
        break;
      case RK:
        put(row, col, numberText(rkValue(d.readUInt32LE(6)), cellName(row, col)));
        break;
      case MULRK: {
        const n = (d.length - 6) / 6;
        for (let i = 0; i < n; i++) {
          const v = rkValue(d.readUInt32LE(4 + i * 6 + 2));
          put(row, col + i, numberText(v, cellName(row, col + i)));
        }
        break;
      }
      case BOOLERR:
        if (d.readUInt8(7) !== 0) {
          throw new XlsError(`${cellName(row, col)} holds an error value (#N/A, #REF! …)`);
        }
        put(row, col, d.readUInt8(6) !== 0 ? 'TRUE' : 'FALSE');
        break;
      case FORMULA:
        throw new XlsError(`${cellName(row, col)} is a formula — only typed-in values are read`);
      case RSTRING:
        throw new XlsError(`${cellName(row, col)} is in a pre-1997 text format`);
      default:
        break; // formatting, blanks, column widths, window settings
    }
  }

  const rows: string[][] = [];
  const maxRow = cells.size === 0 ? -1 : Math.max(...cells.keys());
  for (let r = 0; r <= maxRow; r++) {
    const row = cells.get(r);
    if (row === undefined) {
      rows.push([]);
      continue;
    }
    const width = Math.max(...row.keys()) + 1;
    rows.push(Array.from({ length: width }, (_, i) => row.get(i) ?? ''));
  }
  return rows;
}

/** Open a workbook. Sheets are decoded when asked for. */
export function readXlsWorkbook(file: Buffer): XlsWorkbook {
  const container = openContainer(file);
  const stream = readStream(container, 'Workbook') ?? readStream(container, 'Book');
  if (stream === null) throw new XlsError('the file holds no workbook');

  const bof = recordAt(stream, 0);
  if (bof.op !== BOF || bof.data.length < 4) throw new XlsError('the workbook has no start record');
  if (bof.data.readUInt16LE(0) !== BIFF8) {
    throw new XlsError('only the Excel 97-2003 format is read; this workbook is older');
  }

  const sheets: SheetRef[] = [];
  const sstSegs: Buffer[] = [];
  let inSst = false;
  let p = 4 + bof.data.length;
  for (;;) {
    const rec = recordAt(stream, p);
    p += 4 + rec.data.length;
    if (rec.op === EOF) break;
    if (rec.op === FILEPASS) throw new XlsError('the workbook is password-protected');
    if (rec.op === CONTINUE && inSst) {
      sstSegs.push(rec.data);
      continue;
    }
    inSst = false;
    if (rec.op === SST) {
      sstSegs.push(rec.data);
      inSst = true;
    } else if (rec.op === BOUNDSHEET) {
      const cch = rec.data.readUInt8(6);
      sheets.push({
        offset: rec.data.readUInt32LE(0),
        type: rec.data.readUInt8(5),
        name: inlineString(rec.data, 8, cch, rec.data.readUInt8(7)),
      });
    }
  }
  const sst = sstSegs.length === 0 ? [] : readSst(sstSegs);
  const worksheets = sheets.filter((s) => s.type === 0);
  const decoded = new Map<string, string[][]>();

  return {
    sheetNames: worksheets.map((s) => s.name),
    sheet(name: string): string[][] | null {
      const ref = worksheets.find((s) => s.name === name);
      if (ref === undefined) return null;
      let rows = decoded.get(name);
      if (rows === undefined) {
        rows = readCells(stream, ref, sst);
        decoded.set(name, rows);
      }
      return rows;
    },
  };
}

/** One sheet's rows, refusing — with the names it has — when it is absent. */
export function readXlsSheet(file: Buffer, sheetName: string): string[][] {
  const wb = readXlsWorkbook(file);
  const rows = wb.sheet(sheetName);
  if (rows === null) {
    throw new XlsError(
      `the workbook has no sheet called "${sheetName}" — it has: ${wb.sheetNames.join(', ')}`,
    );
  }
  return rows;
}
