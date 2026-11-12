import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';
import { apiBlockFor, type StoredAttachmentBlock } from '../assistant-attachment-block';
import {
  AttachmentRefusal,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  attachmentTokens,
  cleanFileName,
  rebuildAttachment,
} from '../assistant-attachment-rebuild';
import type { CallerScope } from '../assistant.types';
import { AssistantStoreService, type AttachmentRow } from './assistant-store.service';

/** Unsent files one conversation may hold: stops a loop of uploads that are never asked about. */
export const MAX_UNSENT_ATTACHMENTS = 10;
const PREVIEW_TTL_SECONDS = 5 * 60;
const DOWNLOAD_TTL_SECONDS = 60;

export interface UploadedFile {
  readonly buffer: Buffer;
  readonly size: number;
  readonly originalname: string;
}

export interface AttachmentView {
  readonly id: string;
  readonly kind: 'IMAGE' | 'PDF';
  readonly mediaType: string;
  readonly name: string;
  readonly bytes: number;
  readonly pages: number | null;
  readonly previewUrl?: string;
}

/** A stored file could not be read back (bucket down, object missing, bytes changed). */
export class AttachmentUnavailable extends Error {
  constructor(readonly attachmentId: string) {
    super('attachment unavailable');
    this.name = 'AttachmentUnavailable';
  }
}

const notFound = (): NotFoundException =>
  new NotFoundException({
    code: 'ASSISTANT_ATTACHMENT_NOT_FOUND',
    message: 'Attachment not found',
  });

/**
 * Attachments: rebuild on the way in, own-or-404 on every way out.
 *
 * Every read goes through `AssistantStoreService.findOwnedAttachments`,
 * whose predicate is the conversation's own ownership predicate plus the
 * attachment's mirrored owner columns; the caller's `conversationId` is
 * part of it too. An id that is someone else's, from another conversation,
 * or that does not exist all fail the same way, with the same 404.
 */
@Injectable()
export class AssistantAttachmentService {
  private readonly log = new Logger(AssistantAttachmentService.name);
  /** Refusals by code since the process started (also logged, one line each). */
  private readonly refusals = new Map<string, number>();

  constructor(
    private readonly store: AssistantStoreService,
    private readonly spaces: SpacesService,
  ) {}

  refusalCounts(): Record<string, number> {
    return Object.fromEntries(this.refusals);
  }

  private noteRefusal(code: string, scope: CallerScope, size: number): void {
    this.refusals.set(code, (this.refusals.get(code) ?? 0) + 1);
    // Code, audience and size. Never the file, its name, or the person.
    this.log.warn(
      `assistant attachment refused code=${code} audience=${scope.audience} bytes=${size}`,
    );
  }

  /** The caller's conversation or a 404. */
  private async requireConversation(scope: CallerScope, id: string): Promise<void> {
    if ((await this.store.findOwned(scope, id)) === null) {
      throw new NotFoundException({
        code: 'ASSISTANT_CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    }
  }

  async upload(
    scope: CallerScope,
    conversationId: string,
    file: UploadedFile | undefined,
  ): Promise<AttachmentView> {
    await this.requireConversation(scope, conversationId);
    if (file === undefined || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException({
        code: 'ATTACHMENT_MISSING',
        message: 'Attach one file in the "file" field.',
      });
    }
    if (file.buffer.length > MAX_ATTACHMENT_BYTES) {
      this.noteRefusal('ATTACHMENT_TOO_LARGE', scope, file.buffer.length);
      throw new BadRequestException({
        code: 'ATTACHMENT_TOO_LARGE',
        message: 'That file is larger than 10 MB.',
      });
    }
    if (
      (await this.store.countUnsentAttachments(scope, conversationId)) >= MAX_UNSENT_ATTACHMENTS
    ) {
      throw new BadRequestException({
        code: 'ATTACHMENT_TOO_MANY_PENDING',
        message: 'Too many files are waiting to be sent. Send your question first.',
      });
    }

    let rebuilt;
    try {
      rebuilt = await rebuildAttachment(file.buffer);
    } catch (e) {
      if (e instanceof AttachmentRefusal) {
        this.noteRefusal(e.code, scope, file.buffer.length);
        throw new BadRequestException({ code: e.code, message: e.message });
      }
      throw e;
    }

    const sha256 = createHash('sha256').update(rebuilt.bytes).digest('hex');
    // A v4 token, not v7: the key's whole job is to be unguessable.
    const storageKey = `assistant/${conversationId}/${randomUUID()}`;
    await this.spaces.putObject(storageKey, rebuilt.bytes, rebuilt.mediaType);
    let row: AttachmentRow;
    try {
      row = await this.store.createAttachment({
        scope,
        conversationId,
        kind: rebuilt.kind,
        mediaType: rebuilt.mediaType,
        originalName: cleanFileName(file.originalname),
        bytes: rebuilt.bytes.length,
        pages: rebuilt.kind === 'PDF' ? rebuilt.pages : null,
        width: rebuilt.kind === 'IMAGE' ? rebuilt.width : null,
        height: rebuilt.kind === 'IMAGE' ? rebuilt.height : null,
        sha256,
        storageKey,
      });
    } catch (e) {
      await this.spaces.deleteObjects([storageKey]).catch(() => undefined);
      throw e;
    }
    const view = this.view(row);
    if (row.kind !== 'IMAGE') return view;
    const previewUrl = await this.spaces
      .presignGetUrl(row.storageKey, PREVIEW_TTL_SECONDS)
      .catch(() => undefined);
    return previewUrl === undefined ? view : { ...view, previewUrl };
  }

  view(row: AttachmentRow): AttachmentView {
    return {
      id: row.id,
      kind: row.kind,
      mediaType: row.mediaType,
      name: row.originalName,
      bytes: row.bytes,
      pages: row.pages,
    };
  }

  /**
   * The ids a question wants to carry, checked: at most 3, no repeats,
   * every one the caller's, in THIS conversation, and not yet sent.
   * Anything else is a 404 (a 400 only for the count).
   */
  async requireUnsent(
    scope: CallerScope,
    conversationId: string,
    ids: readonly string[],
  ): Promise<AttachmentRow[]> {
    if (ids.length === 0) return [];
    if (ids.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new BadRequestException({
        code: 'ATTACHMENT_TOO_MANY',
        message: `Attach at most ${MAX_ATTACHMENTS_PER_MESSAGE} files to one question.`,
      });
    }
    const unique = [...new Set(ids)];
    const rows = await this.store.findOwnedAttachments(scope, conversationId, unique, true);
    if (rows.length !== unique.length) throw notFound();
    // Keep the order the caller gave.
    const byId = new Map(rows.map((r) => [r.id, r]));
    return unique.map((id) => byId.get(id) as AttachmentRow);
  }

  /** The block a question stores for an attachment. */
  storedBlock(row: AttachmentRow): StoredAttachmentBlock {
    return {
      type: 'skydrop_attachment',
      id: row.id,
      mediaType: row.mediaType,
      tokens: attachmentTokens(row),
    };
  }

  /**
   * The immutable bytes of each attachment, as API blocks. Every byte is
   * checked against the sha256 written at upload: a replay that differed
   * from the first would be a 400 from the API, so a changed or missing
   * object is an error here, never a different prompt.
   */
  async loadBlocks(
    conversationId: string,
    ids: readonly string[],
  ): Promise<Map<string, Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam>> {
    const out = new Map<string, Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam>();
    if (ids.length === 0) return out;
    const rows = await this.store.attachmentsByIds(conversationId, [...new Set(ids)]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of new Set(ids)) {
      const row = byId.get(id);
      if (row === undefined) throw new AttachmentUnavailable(id);
      let bytes: Buffer | null;
      try {
        bytes = await this.spaces.getObject(row.storageKey);
      } catch {
        bytes = null;
      }
      if (bytes === null || createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
        throw new AttachmentUnavailable(id);
      }
      out.set(id, apiBlockFor(row.mediaType, bytes));
    }
    return out;
  }

  /** The caller's own attachment, as a short-lived signed URL that downloads (never renders). */
  async downloadUrl(
    scope: CallerScope,
    conversationId: string,
    attachmentId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    await this.requireConversation(scope, conversationId);
    const [row] = await this.store.findOwnedAttachments(
      scope,
      conversationId,
      [attachmentId],
      false,
    );
    if (row === undefined) throw notFound();
    const url = await this.spaces
      .presignGetUrl(row.storageKey, DOWNLOAD_TTL_SECONDS, {
        contentDisposition: dispositionFor(row.originalName),
        contentType: row.mediaType,
      })
      .catch((e: unknown) => {
        this.log.error(
          `assistant attachment presign failed: ${e instanceof Error ? e.name : 'unknown'}`,
        );
        throw new HttpException(
          { code: 'ATTACHMENT_UNAVAILABLE', message: 'That file cannot be opened right now.' },
          503,
        );
      });
    return { url, expiresInSeconds: DOWNLOAD_TTL_SECONDS };
  }
}

/** `attachment`, with a header-safe ASCII fallback name and the real one RFC 5987 encoded. */
export function dispositionFor(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["%;]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
