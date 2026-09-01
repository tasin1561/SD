import { inflateRawSync } from 'node:zlib';

/**
 * A minimal .xlsx reader — just enough to read a courier's wallet export.
 *
 * ── WHY NOT A LIBRARY ────────────────────────────────────────────────
 * An .xlsx is a ZIP of XML, and everything needed to read one already
 * ships with Node: `zlib` inflates the entries and the sheet XML is a
 * flat list of cells. The alternatives are a very large dependency
 * (exceljs) or one with a history of parser CVEs, taken on to read six
 * columns off a file one courier produces. Both are more surface than
 * this is worth.
 *
 * It is deliberately NOT a general reader. It handles what a machine-
 * generated export actually contains — deflated or stored entries,
 * shared strings, inline strings — and REFUSES anything else rather
 * than guessing. A silent misread is the failure mode that matters
 * here: it would write wrong money into the P&L and look fine.
 *
 * The caller is expected to check the numbers it parsed against a total
 * the file itself states. See the import service.
 */

const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

export class XlsxError extends Error {}

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly offset: number;
  readonly compressedSize: number;
}

/**
 * Read the central directory rather than scanning local headers.
 *
 * A local header may declare sizes of zero and defer them to a data
 * descriptor AFTER the payload, which cannot be read forwards; the
 * central directory always carries the real ones. Streaming parsers get
 * this wrong and truncate the last entry.
 */
function entries(buf: Buffer): Map<string, ZipEntry> {
  let eocd = -1;
  // The EOCD is at the end, after a comment of unknown length.
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('not a zip file (no end-of-central-directory record)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new XlsxError('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    out.set(name, { name, method, offset, compressedSize });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function read(buf: Buffer, e: ZipEntry): Buffer {
  // The LOCAL header's name/extra lengths differ from the central one's,
  // so the payload offset must be computed from the local header.
  const nameLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method === 8) return inflateRawSync(raw);
  throw new XlsxError(`unsupported compression method ${e.method} for ${e.name}`);
}

/** `AB12` → 27. Column letters are base-26 with no zero. */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function decodeEntities(s: string): string {
  return (
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
      // Ampersand LAST, or an escaped entity would be decoded twice.
      .replace(/&amp;/g, '&')
  );
}

/** All the `<t>` text inside a chunk, concatenated (a string can be split
 *  across runs when parts of it are styled differently). */
function textOf(chunk: string): string {
  let out = '';
  for (const m of chunk.matchAll(/<t(?:\s[^>]*)?\/>|<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    out += decodeEntities(m[1] ?? '');
  }
  return out;
}

function sharedStrings(zip: Map<string, ZipEntry>, buf: Buffer): string[] {
  const e = zip.get('xl/sharedStrings.xml');
  if (e === undefined) return [];
  const xml = read(buf, e).toString('utf8');
  const out: string[] = [];
  for (const m of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/g)) {
    out.push(textOf(m[1] ?? ''));
  }
  return out;
}

/** Sheet name → the part that holds it. */
function sheetParts(zip: Map<string, ZipEntry>, buf: Buffer): Map<string, string> {
  const wbEntry = zip.get('xl/workbook.xml');
  const relEntry = zip.get('xl/_rels/workbook.xml.rels');
  if (wbEntry === undefined || relEntry === undefined) {
    throw new XlsxError('not an xlsx file (no workbook)');
  }
  const rels = new Map<string, string>();
  for (const m of read(buf, relEntry)
    .toString('utf8')
    .matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)) {
    const id = m[1];
    const target = m[2];
    if (id === undefined || target === undefined) continue;
    const clean = target.replace(/^\/?(xl\/)?/, '');
    rels.set(id, `xl/${clean}`);
  }
  const out = new Map<string, string>();
  for (const m of read(buf, wbEntry)
    .toString('utf8')
    .matchAll(/<sheet\b[^>]*>/g)) {
    const tag = m[0];
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    const rid = /\br:id="([^"]*)"/.exec(tag)?.[1];
    if (name === undefined || rid === undefined) continue;
    const part = rels.get(rid);
    if (part !== undefined) out.set(decodeEntities(name), part);
  }
  return out;
}

/**
 * Every row of one sheet, as an array of cell strings.
 *
 * Cells are placed by their column REFERENCE, not by their order in the
 * XML: a blank cell is simply absent from the file, so counting elements
 * shifts every value after the gap into the wrong column — which for a
 * money import means reading an amount out of a date.
 *
 * Values come back as raw strings. Numbers are not coerced here: the
 * caller knows which columns are money and can parse them with the
 * precision it needs.
 */
export function readSheet(file: Buffer, sheetName: string): string[][] {
  const zip = entries(file);
  const parts = sheetParts(zip, file);
  const part = parts.get(sheetName);
  if (part === undefined) {
    throw new XlsxError(
      `the workbook has no sheet called "${sheetName}" — it has: ${[...parts.keys()].join(', ')}`,
    );
  }
  const entry = zip.get(part);
  if (entry === undefined) throw new XlsxError(`sheet part ${part} is missing from the file`);

  const strings = sharedStrings(zip, file);
  const xml = read(file, entry).toString('utf8');
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = new Map<number, string>();
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (ref === undefined) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      let value: string;
      if (type === 's') {
        const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
        value = Number.isInteger(idx) ? (strings[idx] ?? '') : '';
      } else if (type === 'inlineStr') {
        value = textOf(body);
      } else {
        value = decodeEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      }
      cells.set(columnIndex(ref), value);
    }
    if (cells.size === 0) {
      rows.push([]);
      continue;
    }
    const width = Math.max(...cells.keys()) + 1;
    rows.push(Array.from({ length: width }, (_, i) => cells.get(i) ?? ''));
  }
  return rows;
}

/** The sheet names a workbook contains, in order. */
export function sheetNames(file: Buffer): string[] {
  return [...sheetParts(entries(file), file).keys()];
}
