import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import sharp from 'sharp';

/** A small solid-colour picture of the given type, with EXIF (and GPS) on JPEGs. */
export async function pictureBytes(
  type: 'jpeg' | 'png' | 'webp' | 'gif',
  opts: { width?: number; height?: number; exif?: boolean; alpha?: boolean } = {},
): Promise<Buffer> {
  const width = opts.width ?? 100;
  const height = opts.height ?? 80;
  let img = sharp({
    create: {
      width,
      height,
      channels: opts.alpha === true ? 4 : 3,
      background: opts.alpha === true ? { r: 200, g: 30, b: 30, alpha: 0.5 } : '#c81e1e',
    },
  });
  if (opts.exif === true) {
    img = img.withExif({
      IFD0: { Copyright: 'SECRET-OWNER-NAME', Software: 'SECRET-CAMERA' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '51/1 30/1 0/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '0/1 7/1 0/1',
      },
    });
  }
  return img.toFormat(type).toBuffer();
}

/** A one-colour picture of `w`x`h` pixels: tiny on disk, huge once decoded. */
export function pixelBomb(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: '#808080' } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export interface HostilePdf {
  readonly bytes: Buffer;
  /** Every name the file must NOT carry once rebuilt. */
  readonly names: readonly string[];
}

/** A PDF carrying JavaScript, an OpenAction, embedded files, an AcroForm, XFA and annotation actions. */
export async function hostilePdf(pages = 2): Promise<HostilePdf> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++)
    doc.addPage([200, 200]).drawText(`page ${i + 1}`, { x: 20, y: 100 });
  const ctx = doc.context;
  const js = ctx.register(ctx.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }));
  const annot = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [0, 0, 50, 50],
      A: js,
      AA: ctx.obj({ E: js }),
    }),
  );
  const first = doc.getPage(0).node;
  first.set(PDFName.of('Annots'), ctx.obj([annot]));
  first.set(PDFName.of('AA'), ctx.obj({ O: js }));
  const filespec = ctx.register(ctx.obj({ Type: 'Filespec', F: PDFString.of('evil.exe') }));
  doc.catalog.set(PDFName.of('OpenAction'), js);
  doc.catalog.set(PDFName.of('AA'), ctx.obj({ WC: js }));
  doc.catalog.set(
    PDFName.of('Names'),
    ctx.obj({
      JavaScript: ctx.obj({ Names: [PDFString.of('boot'), js] }),
      EmbeddedFiles: ctx.obj({ Names: [PDFString.of('evil.exe'), filespec] }),
    }),
  );
  doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [], XFA: PDFString.of('<xfa/>') }));
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  return {
    bytes,
    names: [
      'JavaScript',
      '/JS',
      'OpenAction',
      '/AA',
      'EmbeddedFile',
      'AcroForm',
      'XFA',
      'Annots',
      'Filespec',
      'evil.exe',
      'app.alert',
    ],
  };
}

export async function plainPdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++)
    doc.addPage([200, 200]).drawText(`page ${i + 1}`, { x: 20, y: 100 });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** A PDF whose trailer names an /Encrypt dictionary. */
export async function encryptedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const ctx = doc.context;
  ctx.trailerInfo.Encrypt = ctx.register(
    ctx.obj({
      Filter: 'Standard',
      V: 1,
      R: 2,
      O: PDFString.of('x'.repeat(32)),
      U: PDFString.of('y'.repeat(32)),
      P: -4,
    }),
  );
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
