/**
 * Attachment safety is REBUILD. Each test feeds a hostile file in and
 * inspects the bytes that come out, because that is the claim: what we
 * store and send is a fresh file, not the one that arrived.
 */
import sharp from 'sharp';
import {
  AttachmentRefusal,
  MAX_ATTACHMENT_BYTES,
  MAX_PDF_PAGES,
  attachmentTokens,
  cleanFileName,
  rebuildAttachment,
  sniffType,
} from '../../src/modules/assistant/assistant-attachment-rebuild';
import {
  encryptedPdf,
  hostilePdf,
  pictureBytes,
  pixelBomb,
  plainPdf,
} from '../helpers/assistant-attachment-files';

const refusal = async (input: Buffer): Promise<AttachmentRefusal> => {
  try {
    await rebuildAttachment(input);
  } catch (e) {
    expect(e).toBeInstanceOf(AttachmentRefusal);
    return e as AttachmentRefusal;
  }
  throw new Error('expected a refusal');
};

describe('magic bytes decide the type, never the name or the Content-Type', () => {
  it('an executable renamed .jpg is refused', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2000, 7)]);
    expect((await refusal(exe)).code).toBe('ATTACHMENT_TYPE_NOT_ALLOWED');
  });
  it('SVG, HTML and text are refused even though a browser would render them', async () => {
    for (const s of [
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      '<html><script>1</script>',
      'hello',
    ]) {
      expect((await refusal(Buffer.from(s))).code).toBe('ATTACHMENT_TYPE_NOT_ALLOWED');
    }
  });
  it('an empty file is refused', async () => {
    expect((await refusal(Buffer.alloc(0))).code).toBe('ATTACHMENT_EMPTY');
  });
  it('10 MB + 1 byte is refused, with the size named in the message', async () => {
    const big = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(MAX_ATTACHMENT_BYTES),
    ]);
    expect(big.length).toBeGreaterThan(MAX_ATTACHMENT_BYTES);
    const r = await refusal(big);
    expect(r.code).toBe('ATTACHMENT_TOO_LARGE');
    expect(r.message).toContain('10 MB');
  });
  it('sniffs each allowed type from its signature', async () => {
    expect(sniffType(await pictureBytes('jpeg'))).toBe('jpeg');
    expect(sniffType(await pictureBytes('png'))).toBe('png');
    expect(sniffType(await pictureBytes('webp'))).toBe('webp');
    expect(sniffType(await pictureBytes('gif'))).toBe('gif');
    expect(sniffType(await plainPdf(1))).toBe('pdf');
    // RIFF that is not WebP
    expect(sniffType(Buffer.from('RIFF\0\0\0\0WAVEfmt '))).toBeNull();
  });
});

describe('images are re-encoded into a fresh file', () => {
  it.each(['jpeg', 'png', 'webp', 'gif'] as const)(
    '%s is accepted and comes out as a JPEG',
    async (type) => {
      const out = await rebuildAttachment(await pictureBytes(type));
      expect(out.kind).toBe('IMAGE');
      expect(out.mediaType).toBe('image/jpeg');
      expect(sniffType(out.bytes)).toBe('jpeg');
    },
  );

  it('a picture with transparency stays a PNG (and is a fresh PNG)', async () => {
    const out = await rebuildAttachment(await pictureBytes('png', { alpha: true }));
    expect(out.mediaType).toBe('image/png');
    expect(sniffType(out.bytes)).toBe('png');
  });

  it('EXIF and GPS are gone from the output bytes', async () => {
    const input = await pictureBytes('jpeg', { exif: true });
    // the fixture really carries them
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(input.includes('SECRET-OWNER-NAME')).toBe(true);

    const out = await rebuildAttachment(input);
    const after = await sharp(out.bytes).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(out.bytes.includes('SECRET-OWNER-NAME')).toBe(false);
    expect(out.bytes.includes('SECRET-CAMERA')).toBe(false);
    expect(out.bytes.includes('Exif')).toBe(false);
    expect(out.bytes.includes('GPS')).toBe(false);
  });

  it('EXIF orientation is applied, then dropped', async () => {
    const tall = await sharp(await pictureBytes('jpeg', { width: 100, height: 80 }))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await sharp(tall).metadata()).orientation).toBe(6);
    const out = await rebuildAttachment(tall);
    if (out.kind !== 'IMAGE') throw new Error('image expected');
    expect([out.width, out.height]).toEqual([80, 100]);
    expect((await sharp(out.bytes).metadata()).orientation).toBeUndefined();
  });

  it('is resized to 1568px on the long edge, never enlarged', async () => {
    const big = await rebuildAttachment(await pictureBytes('png', { width: 3200, height: 1600 }));
    const small = await rebuildAttachment(await pictureBytes('png', { width: 300, height: 200 }));
    if (big.kind !== 'IMAGE' || small.kind !== 'IMAGE') throw new Error('image expected');
    expect([big.width, big.height]).toEqual([1568, 784]);
    expect([small.width, small.height]).toEqual([300, 200]);
  });

  it('an animated GIF contributes its first frame only', async () => {
    const frames = await sharp(
      Buffer.concat([
        await sharp({ create: { width: 40, height: 40, channels: 3, background: '#f00' } })
          .raw()
          .toBuffer(),
        await sharp({ create: { width: 40, height: 40, channels: 3, background: '#00f' } })
          .raw()
          .toBuffer(),
      ]),
      { raw: { width: 40, height: 80, channels: 3, pageHeight: 40 } },
    )
      .gif({ delay: [100, 100], loop: 0 })
      .toBuffer();
    expect((await sharp(frames, { animated: true }).metadata()).pages).toBe(2);
    const out = await rebuildAttachment(frames);
    expect((await sharp(out.bytes, { animated: true }).metadata()).pages ?? 1).toBe(1);
  });

  it('a pixel bomb is refused before it is decoded', async () => {
    const bomb = await pixelBomb(7000, 6000); // 42 MP
    expect(bomb.length).toBeLessThan(MAX_ATTACHMENT_BYTES);
    expect((await refusal(bomb)).code).toBe('ATTACHMENT_IMAGE_TOO_LARGE_DIMENSIONS');
  });

  it('a truncated picture is refused, not half-processed', async () => {
    const good = await pictureBytes('png', { width: 400, height: 400 });
    const r = await refusal(good.subarray(0, Math.floor(good.length / 2)));
    expect(r.code).toBe('ATTACHMENT_IMAGE_UNREADABLE');
  });
});

describe('PDFs are rebuilt page by page into a new document', () => {
  it('the output carries none of JavaScript, OpenAction, EmbeddedFiles, AcroForm, XFA or annotation actions', async () => {
    const { bytes, names } = await hostilePdf();
    // the fixture really carries every one of them
    const hay = bytes.toString('latin1');
    for (const n of names) expect(hay).toContain(n);

    const out = await rebuildAttachment(bytes);
    if (out.kind !== 'PDF') throw new Error('pdf expected');
    expect(out.pages).toBe(2);
    const scan = out.bytes.toString('latin1');
    for (const n of names) expect(scan).not.toContain(n);
    for (const re of [/\/Launch/, /\/URI/, /\/SubmitForm/, /\/Names\b/, /\/Annot\b/]) {
      expect(scan).not.toMatch(re);
    }
    expect(scan.startsWith('%PDF-')).toBe(true);
  });

  it('is a different file from the one that arrived', async () => {
    const input = await plainPdf(3);
    const out = await rebuildAttachment(input);
    expect(Buffer.compare(input, out.bytes)).not.toBe(0);
    if (out.kind !== 'PDF') throw new Error('pdf expected');
    expect(out.pages).toBe(3);
  });

  it('an encrypted PDF is refused', async () => {
    expect((await refusal(await encryptedPdf())).code).toBe('ATTACHMENT_PDF_ENCRYPTED');
  });

  it('21 pages is refused with a message naming the limit; 20 is accepted', async () => {
    const r = await refusal(await plainPdf(MAX_PDF_PAGES + 1));
    expect(r.code).toBe('ATTACHMENT_PDF_TOO_MANY_PAGES');
    expect(r.message).toContain('20 pages');
    expect((await rebuildAttachment(await plainPdf(MAX_PDF_PAGES))).kind).toBe('PDF');
  });

  it('garbage behind a %PDF- header is refused', async () => {
    const r = await refusal(Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(500, 1)]));
    expect(r.code).toBe('ATTACHMENT_PDF_UNREADABLE');
  });
});

describe('helpers', () => {
  it('prices a PDF page at 3K and an image at w*h/750', () => {
    expect(attachmentTokens({ kind: 'PDF', pages: 20 })).toBe(60_000);
    expect(attachmentTokens({ kind: 'IMAGE', width: 1500, height: 1000 })).toBe(2000);
  });
  it('cleans a display name: path, control characters, bidi marks, length', () => {
    expect(cleanFileName('C:\\fakepath\\inv\u0000oice\n.pdf')).toBe('invoice.pdf');
    expect(cleanFileName('a\u202Eb.pdf')).toBe('ab.pdf');
    expect(cleanFileName('x'.repeat(500))).toHaveLength(120);
    expect(cleanFileName('  \u0007 ')).toBe('attachment');
  });
});

describe('rebuilds are rationed, so a burst of uploads cannot exhaust memory', () => {
  it('never runs more than MAX_CONCURRENT_REBUILDS at once, and every queued one finishes', async () => {
    const { withRebuildSlot, MAX_CONCURRENT_REBUILDS } =
      await import('../../src/modules/assistant/assistant-attachment-rebuild');
    let running = 0;
    let peak = 0;
    const job = (i: number) =>
      withRebuildSlot(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return i;
      });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => job(i)));
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(peak).toBe(MAX_CONCURRENT_REBUILDS);
  });

  it('a failing rebuild frees its slot', async () => {
    const { withRebuildSlot } =
      await import('../../src/modules/assistant/assistant-attachment-rebuild');
    const boom = () =>
      withRebuildSlot(async () => {
        throw new Error('bad file');
      });
    await expect(Promise.all([boom(), boom(), boom()])).rejects.toThrow('bad file');
    await expect(withRebuildSlot(async () => 'ok')).resolves.toBe('ok');
  });
});
