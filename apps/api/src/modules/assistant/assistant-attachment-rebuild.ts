import { PDFDocument, PDFName, type PDFDict } from 'pdf-lib';
import sharp, { type Sharp } from 'sharp';

/**
 * Attachment safety is REBUILD, never trust. Nothing a person uploads is
 * stored or forwarded: the bytes are sniffed, decoded, and re-encoded into
 * a fresh file that carries only what we put in it. Everything here is a
 * pure function of the input bytes, so each rule is testable by feeding it
 * a hostile file and looking at the bytes that come out.
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 3;
/** Anthropic refuses a request over 32 MB; base64 adds a third, so the files of ONE question share 20 MB. */
export const MAX_QUESTION_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 20;
export const MAX_IMAGE_EDGE = 1568;
export const MAX_INPUT_PIXELS = 40_000_000;
/** Anthropic's per-image ceiling is 5 MB; stay under it with room to spare. */
const MAX_REBUILT_IMAGE_BYTES = 4_500_000;

export type AttachmentRefusalCode =
  | 'ATTACHMENT_EMPTY'
  | 'ATTACHMENT_TOO_LARGE'
  | 'ATTACHMENT_TYPE_NOT_ALLOWED'
  | 'ATTACHMENT_IMAGE_TOO_LARGE_DIMENSIONS'
  | 'ATTACHMENT_IMAGE_UNREADABLE'
  | 'ATTACHMENT_PDF_ENCRYPTED'
  | 'ATTACHMENT_PDF_TOO_MANY_PAGES'
  | 'ATTACHMENT_PDF_UNREADABLE';

/** A refusal with a stable code and a message that is safe to show verbatim. */
export class AttachmentRefusal extends Error {
  constructor(
    readonly code: AttachmentRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'AttachmentRefusal';
  }
}

export type SniffedType = 'jpeg' | 'png' | 'gif' | 'webp' | 'pdf';

const startsWith = (b: Buffer, sig: readonly number[], at = 0): boolean =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/**
 * What the BYTES say the file is. The filename and the declared
 * Content-Type are never consulted: both are the sender's claim.
 */
export function sniffType(b: Buffer): SniffedType | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  const head6 = b.subarray(0, 6).toString('latin1');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif';
  if (
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'webp';
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return null;
}

export interface RebuiltImage {
  readonly kind: 'IMAGE';
  readonly bytes: Buffer;
  readonly mediaType: 'image/jpeg' | 'image/png';
  readonly width: number;
  readonly height: number;
}

export interface RebuiltPdf {
  readonly kind: 'PDF';
  readonly bytes: Buffer;
  readonly mediaType: 'application/pdf';
  readonly pages: number;
}

export type Rebuilt = RebuiltImage | RebuiltPdf;

/**
 * Sniff, then rebuild. The caller has already enforced the size limit on
 * the bytes it received; it is checked again here so the function is safe
 * on its own.
 */
export async function rebuildAttachment(input: Buffer): Promise<Rebuilt> {
  if (input.length === 0) {
    throw new AttachmentRefusal('ATTACHMENT_EMPTY', 'That file is empty.');
  }
  if (input.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentRefusal('ATTACHMENT_TOO_LARGE', 'That file is larger than 10 MB.');
  }
  const type = sniffType(input);
  if (type === null) {
    throw new AttachmentRefusal(
      'ATTACHMENT_TYPE_NOT_ALLOWED',
      'Only JPEG, PNG, WebP, GIF and PDF files can be attached.',
    );
  }
  return withRebuildSlot(() => (type === 'pdf' ? rebuildPdf(input) : rebuildImage(input)));
}

/**
 * At most this many rebuilds at once per API process. Decoding a 40 MP
 * image holds ~160 MB of raw pixels; the droplet has ~1.5 GB free and
 * runs ONE API process, so ten uploads at once must queue, not all decode
 * together and take the API down (the failure ClamAV was rejected for).
 */
export const MAX_CONCURRENT_REBUILDS = 2;
let activeRebuilds = 0;
const waitingRebuilds: Array<() => void> = [];

export async function withRebuildSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeRebuilds >= MAX_CONCURRENT_REBUILDS) {
    await new Promise<void>((resolve) => waitingRebuilds.push(resolve));
  } else {
    activeRebuilds++;
  }
  try {
    return await work();
  } finally {
    // Hand the slot straight to the next waiter (the count stays the same),
    // or free it.
    const next = waitingRebuilds.shift();
    if (next !== undefined) next();
    else activeRebuilds--;
  }
}

/**
 * A fresh JPEG (or PNG when the picture has transparency). Sharp decodes
 * to raw pixels and encodes new bytes: no metadata block is carried over
 * (EXIF, GPS, XMP, IPTC, ICC and comments are all dropped, because
 * `withMetadata` is never called), `.rotate()` applies the EXIF
 * orientation first so the picture still looks upright, and an animated
 * file contributes its first frame only.
 */
export async function rebuildImage(input: Buffer): Promise<RebuiltImage> {
  try {
    const open = (): Sharp =>
      sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false });
    const meta = await open().metadata();
    // Transparency that is actually used keeps a PNG; an alpha channel that
    // is fully opaque (every GIF carries one) is just a JPEG.
    const alpha = meta.hasAlpha === true && !(await open().stats()).isOpaque;
    const prepare = (): Sharp =>
      open().rotate().resize({
        width: MAX_IMAGE_EDGE,
        height: MAX_IMAGE_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      });

    let out = await (alpha ? prepare().png() : prepare().jpeg({ quality: 85 })).toBuffer({
      resolveWithObject: true,
    });
    let mediaType: 'image/jpeg' | 'image/png' = alpha ? 'image/png' : 'image/jpeg';
    if (out.data.length > MAX_REBUILT_IMAGE_BYTES) {
      // A big PNG photo: flatten onto white and ship it as a JPEG instead.
      out = await prepare()
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      mediaType = 'image/jpeg';
    }
    return {
      kind: 'IMAGE',
      bytes: out.data,
      mediaType,
      width: out.info.width,
      height: out.info.height,
    };
  } catch (e) {
    if (e instanceof AttachmentRefusal) throw e;
    if (/pixel limit/i.test(e instanceof Error ? e.message : '')) {
      throw new AttachmentRefusal(
        'ATTACHMENT_IMAGE_TOO_LARGE_DIMENSIONS',
        'That picture has too many pixels. Please attach a smaller one.',
      );
    }
    throw new AttachmentRefusal(
      'ATTACHMENT_IMAGE_UNREADABLE',
      'That picture could not be read. Please attach a different one.',
    );
  }
}

/**
 * Page-level keys that can run something or hide something. `Annots` is
 * every link, form widget and file-attachment annotation on the page;
 * `AA` is the page's additional-actions dictionary (JavaScript and
 * friends). Neither survives.
 */
const PAGE_KEYS_TO_DROP = ['Annots', 'AA'] as const;

function stripPage(node: PDFDict): void {
  for (const k of PAGE_KEYS_TO_DROP) node.delete(PDFName.of(k));
}

/**
 * A new PDF made of the old one's pages and nothing else.
 *
 * The source is loaded WITHOUT `ignoreEncryption` (an encrypted file
 * throws, and is refused). The pages are cleaned in the SOURCE before
 * they are copied, so the annotations and their actions never enter the
 * new document's object table either: pdf-lib writes every object it
 * holds, referenced or not, so deleting `/Annots` from a page that had
 * already been copied would leave the dead annotation objects, JavaScript
 * included, in the saved bytes. The new document gets a catalog of its
 * own, so `/OpenAction`, `/AA`, `/Names` (JavaScript, EmbeddedFiles),
 * `/AcroForm`, `/XFA` and every other catalog-level key of the original
 * are never copied. The result is saved without object streams and
 * re-loaded once; the re-load also asserts the properties above on the
 * actual output.
 */
export async function rebuildPdf(input: Buffer): Promise<RebuiltPdf> {
  try {
    return await rebuildPdfUnchecked(input);
  } catch (e) {
    if (e instanceof AttachmentRefusal) throw e;
    throw new AttachmentRefusal(
      'ATTACHMENT_PDF_UNREADABLE',
      'That PDF could not be read. Please attach a different one.',
    );
  }
}

async function rebuildPdfUnchecked(input: Buffer): Promise<RebuiltPdf> {
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(input, { updateMetadata: false });
  } catch (e) {
    if (e instanceof Error && /encrypt/i.test(`${e.name} ${e.message}`)) {
      throw new AttachmentRefusal(
        'ATTACHMENT_PDF_ENCRYPTED',
        'That PDF is password protected. Remove the password and attach it again.',
      );
    }
    throw new AttachmentRefusal(
      'ATTACHMENT_PDF_UNREADABLE',
      'That PDF could not be read. Please attach a different one.',
    );
  }
  if (src.isEncrypted) {
    throw new AttachmentRefusal(
      'ATTACHMENT_PDF_ENCRYPTED',
      'That PDF is password protected. Remove the password and attach it again.',
    );
  }
  const count = src.getPageCount();
  if (count === 0) {
    throw new AttachmentRefusal('ATTACHMENT_PDF_UNREADABLE', 'That PDF has no pages.');
  }
  if (count > MAX_PDF_PAGES) {
    throw new AttachmentRefusal(
      'ATTACHMENT_PDF_TOO_MANY_PAGES',
      `That PDF has ${count} pages. The limit is ${MAX_PDF_PAGES} pages.`,
    );
  }

  let bytes: Uint8Array;
  try {
    for (const page of src.getPages()) stripPage(page.node);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, src.getPageIndices());
    for (const page of copied) {
      // Belt and braces: the source pages were cleaned above.
      stripPage(page.node);
      out.addPage(page);
    }
    bytes = await out.save({ useObjectStreams: false });
  } catch {
    throw new AttachmentRefusal(
      'ATTACHMENT_PDF_UNREADABLE',
      'That PDF could not be read. Please attach a different one.',
    );
  }

  const output = Buffer.from(bytes);
  const pages = await assertCleanPdf(output, count);
  return { kind: 'PDF', bytes: output, mediaType: 'application/pdf', pages };
}

/** The catalog keys a rebuilt PDF must never carry. */
const FORBIDDEN_CATALOG_KEYS = [
  'OpenAction',
  'AA',
  'Names',
  'AcroForm',
  'XFA',
  'Extensions',
  'Perms',
  'URI',
  'Dests',
  'Outlines',
] as const;

/** Re-load the output: it must parse, keep its page count, and carry none of the forbidden keys. */
async function assertCleanPdf(output: Buffer, expectedPages: number): Promise<number> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(output, { updateMetadata: false });
  } catch {
    throw new AttachmentRefusal(
      'ATTACHMENT_PDF_UNREADABLE',
      'That PDF could not be rebuilt safely. Please attach a different one.',
    );
  }
  const catalog = doc.catalog;
  for (const k of FORBIDDEN_CATALOG_KEYS) {
    if (catalog.has(PDFName.of(k))) {
      throw new AttachmentRefusal(
        'ATTACHMENT_PDF_UNREADABLE',
        'That PDF could not be rebuilt safely. Please attach a different one.',
      );
    }
  }
  const pages = doc.getPages();
  if (pages.length !== expectedPages) {
    throw new AttachmentRefusal(
      'ATTACHMENT_PDF_UNREADABLE',
      'That PDF could not be rebuilt safely. Please attach a different one.',
    );
  }
  for (const page of pages) {
    if (page.node.has(PDFName.of('Annots')) || page.node.has(PDFName.of('AA'))) {
      throw new AttachmentRefusal(
        'ATTACHMENT_PDF_UNREADABLE',
        'That PDF could not be rebuilt safely. Please attach a different one.',
      );
    }
  }
  return pages.length;
}

/** Tokens a rebuilt file adds to a prompt: images ~ w*h/750; a PDF page is counted as 3K (it is 1.5-3K). */
export function attachmentTokens(a: {
  readonly kind: 'IMAGE' | 'PDF';
  readonly width?: number | null | undefined;
  readonly height?: number | null | undefined;
  readonly pages?: number | null | undefined;
}): number {
  if (a.kind === 'PDF') return Math.max(1, a.pages ?? 1) * 3000;
  return Math.ceil(((a.width ?? MAX_IMAGE_EDGE) * (a.height ?? MAX_IMAGE_EDGE)) / 750);
}

/** A display name: control characters out, trimmed, at most 120 characters. */
export function cleanFileName(raw: string | undefined | null): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, '').trim();
  const out = Array.from(cleaned).slice(0, 120).join('').trim();
  return out === '' ? 'attachment' : out;
}
