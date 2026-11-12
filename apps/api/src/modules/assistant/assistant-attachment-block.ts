import type Anthropic from '@anthropic-ai/sdk';

/**
 * What a stored user turn holds in place of a file. The bytes are NOT in
 * the JSONB: the block names the attachment, and `toApiMessages` resolves
 * it at replay from the IMMUTABLE bytes in the private bucket, so every
 * replay of a turn is byte-identical to the first (Haiku 5.5 binds its
 * thinking blocks to the exact prior bytes, and a changed prefix is a 400).
 *
 * `tokens` is stored with the block so the history window can price a turn
 * without reading the bucket.
 */
export const ATTACHMENT_BLOCK_TYPE = 'skydrop_attachment';

export interface StoredAttachmentBlock {
  readonly type: typeof ATTACHMENT_BLOCK_TYPE;
  readonly id: string;
  readonly mediaType: string;
  readonly tokens: number;
}

export function isAttachmentBlock(b: unknown): b is StoredAttachmentBlock {
  if (typeof b !== 'object' || b === null) return false;
  const o = b as Record<string, unknown>;
  return (
    o['type'] === ATTACHMENT_BLOCK_TYPE &&
    typeof o['id'] === 'string' &&
    typeof o['mediaType'] === 'string'
  );
}

export function attachmentBlocksIn(content: unknown): StoredAttachmentBlock[] {
  return Array.isArray(content) ? (content as unknown[]).filter(isAttachmentBlock) : [];
}

/** The API content block for a rebuilt file. Pure and deterministic: same bytes in, same block out. */
export function apiBlockFor(
  mediaType: string,
  bytes: Buffer,
): Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam {
  const data = bytes.toString('base64');
  if (mediaType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
      data,
    },
  };
}
