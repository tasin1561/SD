/**
 * Attachments end to end through the service layer (in-memory store and
 * bucket; the real-database isolation proof is the e2e spec).
 *
 * The four things that matter:
 *  - nobody but the owner can send or download a file (404);
 *  - a replay of a turn that carried a file is byte-identical;
 *  - a question whose files cannot fit is refused BEFORE Claude is called;
 *  - a bucket failure is a plain notice, never a 500.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createHash } from 'node:crypto';
import { attachmentBlocksIn } from '../../src/modules/assistant/assistant-attachment-block';
import {
  estimateTokens,
  toApiMessages,
  windowStart,
  HISTORY_TOKEN_BUDGET,
} from '../../src/modules/assistant/assistant-history';
import { SendAssistantMessageDto } from '../../src/modules/assistant/dto/assistant.dto';
import type { AssistantStreamEvent } from '../../src/modules/assistant/assistant.types';
import { visibleText } from '../../src/modules/assistant/services/assistant-conversation.service';
import { chatRig, message, scope, storeScope, USER_B } from '../helpers/assistant-fixtures';
import { hostilePdf, pictureBytes, plainPdf } from '../helpers/assistant-attachment-files';

const text = (t: string) => ({ type: 'text', text: t, citations: null }) as never;
const thinking = () => ({ type: 'thinking', thinking: '', signature: 'sig-abc' }) as never;

type Rig = ReturnType<typeof chatRig>;
const file = (buffer: Buffer, name = 'photo.jpg') => ({
  buffer,
  size: buffer.length,
  originalname: name,
});

async function ask(rig: Rig, convId: string, q: string, ids: string[] = [], who = scope()) {
  const events: AssistantStreamEvent[] = [];
  await rig.chat.send(who, convId, q, (e) => events.push(e), null, ids);
  return events;
}

describe('upload', () => {
  it('stores the REBUILT bytes under an unguessable key, with sha256, size, type, pages', async () => {
    const rig = chatRig([]);
    const conv = rig.store.seedConversation();
    const input = await pictureBytes('jpeg', { exif: true, width: 3000, height: 2000 });
    const view = await rig.attachments.upload(scope(), conv.id, file(input, 'C:\\x\\IMG_1.jpg'));
    expect(view).toMatchObject({ kind: 'IMAGE', mediaType: 'image/jpeg', name: 'IMG_1.jpg' });
    expect(view.previewUrl).toContain('https://signed.example/');

    const row = rig.store.attachments[0]!;
    expect(row.storageKey).toMatch(new RegExp(`^assistant/${conv.id}/[0-9a-f-]{36}$`));
    const stored = rig.spaces.objects.get(row.storageKey)!;
    expect(Buffer.compare(stored, input)).not.toBe(0); // the original is never stored
    expect(stored.includes('SECRET')).toBe(false);
    expect(row.sha256).toBe(createHash('sha256').update(stored).digest('hex'));
    expect(row.bytes).toBe(stored.length);
    expect(row.width).toBe(1568);
    // exactly one object in the bucket: no copy of the upload
    expect(rig.spaces.objects.size).toBe(1);
  });

  it('a PDF records its page count and is stored without its JavaScript', async () => {
    const rig = chatRig([]);
    const conv = rig.store.seedConversation();
    const { bytes, names } = await hostilePdf(3);
    const view = await rig.attachments.upload(scope(), conv.id, file(bytes, 'bad.pdf'));
    expect(view).toMatchObject({ kind: 'PDF', pages: 3, mediaType: 'application/pdf' });
    expect(view.previewUrl).toBeUndefined(); // a PDF is never previewed inline
    const scan = rig.spaces.objects.get(rig.store.attachments[0]!.storageKey)!.toString('latin1');
    for (const n of names) expect(scan).not.toContain(n);
  });

  it('a refusal stores nothing, is coded, logged-and-counted', async () => {
    const rig = chatRig([]);
    const conv = rig.store.seedConversation();
    await expect(
      rig.attachments.upload(scope(), conv.id, file(Buffer.from('MZ' + 'x'.repeat(400)), 'a.jpg')),
    ).rejects.toMatchObject({ response: { code: 'ATTACHMENT_TYPE_NOT_ALLOWED' } });
    await expect(
      rig.attachments.upload(scope(), conv.id, file(await plainPdf(21), 'big.pdf')),
    ).rejects.toMatchObject({ response: { code: 'ATTACHMENT_PDF_TOO_MANY_PAGES' } });
    expect(rig.spaces.objects.size).toBe(0);
    expect(rig.store.attachments).toHaveLength(0);
    expect(rig.attachments.refusalCounts()).toEqual({
      ATTACHMENT_TYPE_NOT_ALLOWED: 1,
      ATTACHMENT_PDF_TOO_MANY_PAGES: 1,
    });
  });

  it('10 MB + 1 byte is refused before any decoding', async () => {
    const rig = chatRig([]);
    const conv = rig.store.seedConversation();
    await expect(
      rig.attachments.upload(scope(), conv.id, file(Buffer.alloc(10 * 1024 * 1024 + 1, 0xff))),
    ).rejects.toMatchObject({ response: { code: 'ATTACHMENT_TOO_LARGE' } });
  });

  it('no file in the request is a 400', async () => {
    const rig = chatRig([]);
    const conv = rig.store.seedConversation();
    await expect(rig.attachments.upload(scope(), conv.id, undefined)).rejects.toMatchObject({
      response: { code: 'ATTACHMENT_MISSING' },
    });
  });
});

describe('only the owner can send or download a file (404)', () => {
  async function uploaded() {
    const rig = chatRig([message({ content: [text('ok')] }), message({ content: [text('ok')] })]);
    const conv = rig.store.seedConversation();
    const other = rig.store.seedConversation();
    const a = await rig.attachments.upload(scope(), conv.id, file(await pictureBytes('png')));
    return { rig, conv, other, a };
  }

  it('someone else’s attachment id is a 404 on send and on download', async () => {
    const { rig, conv, a } = await uploaded();
    const stranger = scope({ userId: USER_B });
    await expect(ask(rig, conv.id, 'what is this?', [a.id], stranger)).rejects.toMatchObject({
      status: 404,
    });
    await expect(rig.attachments.downloadUrl(stranger, conv.id, a.id)).rejects.toMatchObject({
      status: 404,
    });
    // an associate/store member of the same seller company is a stranger too
    await expect(rig.attachments.downloadUrl(storeScope(), conv.id, a.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(rig.gateway.requests).toHaveLength(0);
    expect(rig.store.rows).toHaveLength(0); // nothing was stored either
  });

  it('a support session’s file is invisible to the real owner, and the reverse', async () => {
    const { rig, conv, a } = await uploaded();
    const staffInSession = scope({ impersonatingStaffId: USER_B });
    await expect(rig.attachments.downloadUrl(staffInSession, conv.id, a.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('an attachment from another conversation is a 404', async () => {
    const { rig, other, a } = await uploaded();
    await expect(ask(rig, other.id, 'q', [a.id])).rejects.toMatchObject({ status: 404 });
    await expect(rig.attachments.downloadUrl(scope(), other.id, a.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('an id that does not exist is the same 404', async () => {
    const { rig, conv } = await uploaded();
    await expect(
      rig.attachments.requireUnsent(scope(), conv.id, ['0191a000-0000-7000-8000-00000000ffff']),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('an already-sent attachment cannot be sent again', async () => {
    const { rig, conv, a } = await uploaded();
    await ask(rig, conv.id, 'first', [a.id]);
    await expect(ask(rig, conv.id, 'second', [a.id])).rejects.toMatchObject({ status: 404 });
  });

  it('the owner downloads through a short-lived link that forces a download', async () => {
    const { rig, conv, a } = await uploaded();
    const dl = await rig.attachments.downloadUrl(scope(), conv.id, a.id);
    expect(dl.expiresInSeconds).toBeLessThanOrEqual(60);
    const url = decodeURIComponent(dl.url);
    expect(url).toContain('attachment; filename=');
    expect(url).toContain('ttl=60');
  });

  it('four ids is a 400; so is the request DTO', async () => {
    const { rig, conv } = await uploaded();
    const ids = [1, 2, 3, 4].map((n) => `0191a000-0000-7000-8000-00000000000${n}`);
    await expect(rig.attachments.requireUnsent(scope(), conv.id, ids)).rejects.toMatchObject({
      status: 400,
    });
    const dto = plainToInstance(SendAssistantMessageDto, { text: 'hi', attachmentIds: ids });
    const errs = await validate(dto);
    expect(errs.map((e) => e.property)).toContain('attachmentIds');
    const three = plainToInstance(SendAssistantMessageDto, {
      text: 'hi',
      attachmentIds: ids.slice(0, 3),
    });
    expect(await validate(three)).toHaveLength(0);
    const notUuid = plainToInstance(SendAssistantMessageDto, {
      text: 'hi',
      attachmentIds: ['nope'],
    });
    expect(await validate(notUuid)).not.toHaveLength(0);
  });
});

describe('replay is byte-identical across turns', () => {
  it('the second request carries the first turn’s file exactly as the first did', async () => {
    const rig = chatRig([
      message({ content: [thinking(), text('It is a red square.')] }),
      message({ content: [thinking(), text('Still red.')] }),
    ]);
    const conv = rig.store.seedConversation();
    const a = await rig.attachments.upload(scope(), conv.id, file(await pictureBytes('jpeg')));
    await ask(rig, conv.id, 'what colour is this?', [a.id]);
    await ask(rig, conv.id, 'and now?');

    const [r1, r2] = rig.gateway.requests;
    const first = JSON.stringify(r1!.messages[0]);
    expect(first).toContain('"type":"image"');
    expect(first).toContain('"type":"base64"');
    expect(JSON.stringify(r2!.messages[0])).toBe(first);
    // and the answer, thinking included, is replayed unmodified after it
    expect(JSON.stringify(r2!.messages[1])).toContain('sig-abc');
  });

  it('a PDF is replayed as a document block, identically', async () => {
    const rig = chatRig([message({ content: [text('a')] }), message({ content: [text('b')] })]);
    const conv = rig.store.seedConversation();
    const a = await rig.attachments.upload(scope(), conv.id, file(await plainPdf(2), 'in.pdf'));
    await ask(rig, conv.id, 'summarise', [a.id]);
    await ask(rig, conv.id, 'more');
    const [r1, r2] = rig.gateway.requests;
    expect(JSON.stringify(r1!.messages[0])).toContain('"type":"document"');
    expect(JSON.stringify(r1!.messages[0])).toContain('application/pdf');
    expect(JSON.stringify(r2!.messages[0])).toBe(JSON.stringify(r1!.messages[0]));
  });

  it('the stored turn holds a placeholder, never base64; the transcript shows no file bytes', async () => {
    const rig = chatRig([message({ content: [text('ok')] })]);
    const conv = rig.store.seedConversation();
    const a = await rig.attachments.upload(scope(), conv.id, file(await pictureBytes('jpeg')));
    await ask(rig, conv.id, 'look', [a.id]);
    const q = rig.store.rows.find((r) => r.isQuestion === true)!;
    const stored = JSON.stringify(q.content);
    expect(stored).not.toContain('base64');
    expect(stored).toContain('skydrop_attachment');
    expect(attachmentBlocksIn(q.content)).toHaveLength(1);
    expect(visibleText(q.content)).toBe('look');
    // the linked row is what the transcript chips are built from
    expect(rig.store.attachments[0]!.messageId).toBe(q.id);
  });

  it('a bytes change in the bucket is caught (sha256), never sent as a different prompt', async () => {
    const rig = chatRig([message({ content: [text('a')] })]);
    const conv = rig.store.seedConversation();
    const a = await rig.attachments.upload(scope(), conv.id, file(await pictureBytes('jpeg')));
    rig.spaces.objects.set(rig.store.attachments[0]!.storageKey, Buffer.from('tampered'));
    const events = await ask(rig, conv.id, 'look', [a.id]);
    expect(events.find((e) => e.type === 'notice')).toMatchObject({
      code: 'ATTACHMENT_UNAVAILABLE',
    });
    expect(rig.gateway.requests).toHaveLength(0);
  });
});

describe('a bucket failure is a plain notice, never a 500', () => {
  it('while reading the files of the question being sent: nothing is stored, Claude is not called', async () => {
    const rig = chatRig([message({ content: [text('a')] })]);
    const conv = rig.store.seedConversation();
    const a = await rig.attachments.upload(scope(), conv.id, file(await pictureBytes('jpeg')));
    rig.spaces.failReads = true;
    const events = await ask(rig, conv.id, 'look', [a.id]);
    expect(events.map((e) => e.type)).toEqual(['notice', 'done']);
    expect(events[0]).toMatchObject({ code: 'ATTACHMENT_UNAVAILABLE' });
    expect(rig.store.rows).toHaveLength(0);
    expect(rig.gateway.requests).toHaveLength(0);
    expect(rig.store.attachments[0]!.messageId).toBeNull(); // still sendable later
  });

  it('while replaying an earlier turn’s file', async () => {
    const rig = chatRig([message({ content: [text('a')] }), message({ content: [text('b')] })]);
    const conv = rig.store.seedConversation();
    const a = await rig.attachments.upload(scope(), conv.id, file(await pictureBytes('jpeg')));
    await ask(rig, conv.id, 'look', [a.id]);
    rig.spaces.failReads = true;
    const events = await ask(rig, conv.id, 'and?');
    expect(events[0]).toMatchObject({ type: 'notice', code: 'ATTACHMENT_UNAVAILABLE' });
    expect(rig.gateway.requests).toHaveLength(1); // only the first turn reached Claude
  });
});

describe('tokens: the window and the budget count the files', () => {
  it('a turn’s files are priced from the stored block, not its JSON', () => {
    const block = {
      type: 'skydrop_attachment',
      id: 'x',
      mediaType: 'application/pdf',
      tokens: 60_000,
    };
    const plain = estimateTokens([{ type: 'text', text: 'hello' }]);
    expect(estimateTokens([block, { type: 'text', text: 'hello' }])).toBe(60_000 + plain);
    // content with no file is counted exactly as before
    expect(estimateTokens([{ type: 'text', text: 'hello' }])).toBe(
      Math.ceil((JSON.stringify([{ type: 'text', text: 'hello' }]).length / 3) * 1.3),
    );
  });

  it('old turns with big files fall out of the window first', () => {
    const q = (id: string, tokens: number) => ({
      id,
      role: 'USER' as const,
      isQuestion: true,
      createdAt: new Date(),
      content: [
        { type: 'skydrop_attachment', id, mediaType: 'application/pdf', tokens },
        { type: 'text', text: 'q' },
      ],
    });
    const a = (id: string) => ({
      id,
      role: 'ASSISTANT' as const,
      isQuestion: false,
      createdAt: new Date(),
      content: [{ type: 'text', text: 'a' }],
    });
    const rows = [q('1', 40_000), a('2'), q('3', 30_000), a('4')];
    expect(40_000 + 30_000).toBeGreaterThan(HISTORY_TOKEN_BUDGET);
    expect(windowStart(rows)).toBe(2);
  });

  it('toApiMessages refuses to guess: an unloaded file is an error, not a silent drop', () => {
    const rows = [
      {
        id: '1',
        role: 'USER' as const,
        isQuestion: true,
        createdAt: new Date(),
        content: [{ type: 'skydrop_attachment', id: 'x', mediaType: 'image/jpeg', tokens: 1 }],
      },
    ];
    expect(() => toApiMessages(rows, 0, 0)).toThrow(/not loaded/);
  });

  it('a question whose files cannot fit is refused BEFORE Claude is called and BEFORE it is stored', async () => {
    const rig = chatRig([message({ content: [text('never')] })]);
    const conv = rig.store.seedConversation();
    // 17 pages x 3K = 51K > the 50K a question's files may cost
    const a = await rig.attachments.upload(scope(), conv.id, file(await plainPdf(17), 'big.pdf'));
    const events = await ask(rig, conv.id, 'summarise', [a.id]);
    expect(events[0]).toMatchObject({ type: 'notice', code: 'ATTACHMENTS_TOO_LARGE' });
    expect(rig.gateway.requests).toHaveLength(0);
    expect(rig.store.rows).toHaveLength(0);
    expect(rig.store.attachments[0]!.messageId).toBeNull(); // the person can remove one and retry
  });

  it('16 pages fits', async () => {
    const rig = chatRig([message({ content: [text('ok')] })]);
    const conv = rig.store.seedConversation();
    const a = await rig.attachments.upload(scope(), conv.id, file(await plainPdf(16), 'ok.pdf'));
    const events = await ask(rig, conv.id, 'summarise', [a.id]);
    expect(events.find((e) => e.type === 'notice')).toBeUndefined();
    expect(rig.gateway.requests).toHaveLength(1);
  });
});
