import type { GlossaryTerm, Guide } from './knowledge.types';
import { GLOSSARY } from './glossary';
import { GUIDES } from './guides';
import { ERROR_CODES } from './generated/error-codes';
import { PAGES_ADMIN, PAGES_ASSOCIATE, PAGES_RESELLER, PAGES_SELLER } from './generated/page-map';
import {
  PORTAL_TEXT_ADMIN,
  PORTAL_TEXT_ASSOCIATE,
  PORTAL_TEXT_RESELLER,
  PORTAL_TEXT_SELLER,
  STAFF_INTERNAL_DOCS,
  STAFF_SETTINGS_TEXT,
} from './generated/help-text';

export type ConsoleKey = 'admin' | 'seller' | 'reseller' | 'associate';
export type TextRow = readonly [key: string, text: string];
export type PageRow = readonly [route: string, title: string, permission: string | null];
export type ErrorRow = readonly [code: string, domains: string, message: string | null];

/**
 * Everything the assistant knows, as plain data. It is assembled from
 * committed modules only (works from `dist`, no filesystem walk) and is
 * handed to the help service as one object so tests can supply their own.
 *
 * ACCESS: which audience may read which part is decided in
 * `assistant-help.service.ts` (HELP_SOURCES), not here.
 */
export interface KnowledgeBase {
  readonly guides: readonly Guide[];
  readonly glossary: readonly GlossaryTerm[];
  readonly portalText: Readonly<Record<ConsoleKey, readonly TextRow[]>>;
  /** STAFF ONLY. */
  readonly settings: readonly TextRow[];
  /** STAFF ONLY. */
  readonly internalDocs: readonly TextRow[];
  readonly errorCodes: readonly ErrorRow[];
  readonly pages: Readonly<Record<ConsoleKey, readonly PageRow[]>>;
}

export function defaultKnowledge(): KnowledgeBase {
  return {
    guides: GUIDES,
    glossary: GLOSSARY,
    portalText: {
      admin: PORTAL_TEXT_ADMIN,
      seller: PORTAL_TEXT_SELLER,
      reseller: PORTAL_TEXT_RESELLER,
      associate: PORTAL_TEXT_ASSOCIATE,
    },
    settings: STAFF_SETTINGS_TEXT,
    internalDocs: STAFF_INTERNAL_DOCS,
    errorCodes: ERROR_CODES,
    pages: {
      admin: PAGES_ADMIN,
      seller: PAGES_SELLER,
      reseller: PAGES_RESELLER,
      associate: PAGES_ASSOCIATE,
    },
  };
}
