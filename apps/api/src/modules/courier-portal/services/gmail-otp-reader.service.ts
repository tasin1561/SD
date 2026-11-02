import { Injectable, Logger } from '@nestjs/common';

/**
 * Reading a courier's one-time code out of a mailbox.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * Shiprocket's panel asks for an emailed OTP when it does not recognise
 * the sign-in, and it never recognises ours: a fresh browser profile
 * arriving from a datacentre proxy is the exact shape step-up auth is
 * built to stop. Before this, the run screenshotted the 2FA box and gave
 * up, so the portal half of the cost sync had been dead since
 * 2026-10-01 and two months of P&L closed PROVISIONALLY with courier
 * costs missing.
 *
 * ── NO SDK ───────────────────────────────────────────────────────────
 * Gmail's REST API is three GETs and a POST, so this is `fetch` and
 * nothing else. A dependency for that would be a dependency to audit,
 * pin and upgrade for the rest of the project's life.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────
 * `gmail.readonly`. It can read mail and cannot send, delete or modify
 * any of it. The refresh token is a courier credential like any other —
 * AES-256-GCM in `courier_credentials`, decrypted with an audit row
 * (CUR-1), and handed to this service as an argument. Nothing here
 * touches the database or holds a secret between calls.
 *
 * ── THE CODE IS NEVER LOGGED ─────────────────────────────────────────
 * Not at debug, not in an error, not in a network summary. The only
 * thing that leaves this file is the return value.
 */

/** Google's token endpoint — swaps a refresh token for an access token. */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const HTTP_TIMEOUT_MS = 15_000;

export interface GmailOtpCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export interface GmailOtpQuery {
  /**
   * Only a message delivered at or after this instant counts.
   *
   * THE WHOLE CORRECTNESS OF THIS SERVICE SITS ON THIS FIELD. An
   * inbox holds every OTP the account was ever sent, and they all look
   * alike. Typing yesterday's is not a near miss — it is a wrong code
   * submitted to an account that also moves COD money, against a panel
   * whose tolerance for failed attempts nobody here knows.
   */
  readonly notBeforeMs: number;
  /** Narrows the search; the sender as Gmail would match it. */
  readonly from: string;
  /** How many digits the courier's code has. */
  readonly digits: number;
}

interface GmailMessageRef {
  readonly id: string;
}

/** Only the fields this service reads. */
interface GmailMessage {
  readonly internalDate?: string;
  readonly snippet?: string;
  readonly payload?: GmailPart;
}

interface GmailPart {
  readonly mimeType?: string;
  readonly headers?: readonly { readonly name: string; readonly value: string }[];
  readonly body?: { readonly data?: string };
  readonly parts?: readonly GmailPart[];
}

@Injectable()
export class GmailOtpReaderService {
  private readonly logger = new Logger(GmailOtpReaderService.name);

  /**
   * The newest code delivered at or after `notBeforeMs`, or null.
   *
   * ONE LOOK, NOT A WAIT. The caller polls, because only the caller
   * knows what else is worth watching while it waits — a panel that
   * loaded anyway, a survey that needs dismissing, an error that means
   * stop. A sleep in here would blind all of that.
   */
  async readOtp(creds: GmailOtpCredentials, query: GmailOtpQuery): Promise<string | null> {
    const token = await this.accessToken(creds);
    if (token === null) return null;

    // `after:` takes whole SECONDS and is inclusive, so this floors —
    // better to consider one message too many (every candidate is
    // re-checked against the exact millisecond below) than to miss the
    // one that arrived in the same second we asked.
    const afterSec = Math.floor(query.notBeforeMs / 1000);
    const q = `from:${query.from} after:${afterSec}`;
    const list = await this.get<{ messages?: readonly GmailMessageRef[] }>(
      `${GMAIL_API}/messages?maxResults=5&q=${encodeURIComponent(q)}`,
      token,
    );
    if (list === null || list.messages === undefined || list.messages.length === 0) return null;

    // Newest first is Gmail's own order; the first match wins so a
    // resent code beats the one it replaced.
    for (const ref of list.messages) {
      const msg = await this.get<GmailMessage>(`${GMAIL_API}/messages/${ref.id}`, token);
      if (msg === null) continue;

      // THE EXACT CHECK, in milliseconds. `after:` is a coarse filter
      // and resolves to a second; this is the one that decides.
      const at = Number.parseInt(msg.internalDate ?? '', 10);
      if (!Number.isFinite(at) || at < query.notBeforeMs) continue;

      const code = extractCode(textOf(msg), query.digits);
      if (code !== null) return code;
    }
    return null;
  }

  /**
   * Swapped fresh on every login rather than cached.
   *
   * An access token lives an hour and a sign-in happens at most a few
   * times a month, so a cache would hold a secret in memory for a
   * thousand times longer than it saves anything — against one extra
   * request on a path that is already opening a browser.
   */
  private async accessToken(creds: GmailOtpCredentials): Promise<string | null> {
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          refresh_token: creds.refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) {
        // The STATUS only. Google echoes nothing secret in the body, but
        // this is a credential exchange and the body is not ours to log.
        this.logger.warn(
          { status: res.status },
          'Gmail refused the refresh token; no OTP will be read',
        );
        return null;
      }
      const body = (await res.json()) as { access_token?: unknown };
      return typeof body.access_token === 'string' && body.access_token !== ''
        ? body.access_token
        : null;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Could not reach Google for an access token',
      );
      return null;
    }
  }

  private async get<T>(url: string, token: string): Promise<T | null> {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
}

/**
 * Subject and snippet FIRST, body last.
 *
 * A one-time code is put where a person can read it without opening the
 * mail, so it is in the subject or the first line. The body is the same
 * message wrapped in a footer, an unsubscribe link and a support phone
 * number — all of which are digits, and some of which are six of them.
 */
export function textOf(msg: {
  readonly snippet?: string;
  readonly payload?: GmailPart;
}): readonly string[] {
  const out: string[] = [];
  const subject = (msg.payload?.headers ?? []).find(
    (h) => h.name.toLowerCase() === 'subject',
  )?.value;
  if (subject !== undefined) out.push(subject);
  if (msg.snippet !== undefined && msg.snippet !== '') out.push(msg.snippet);
  const body = plainBody(msg.payload);
  if (body !== null) out.push(body);
  return out;
}

function plainBody(part: GmailPart | undefined): string | null {
  if (part === undefined) return null;
  if (part.mimeType === 'text/plain' && typeof part.body?.data === 'string') {
    try {
      return Buffer.from(part.body.data, 'base64url').toString('utf8');
    } catch {
      return null;
    }
  }
  for (const child of part.parts ?? []) {
    const found = plainBody(child);
    if (found !== null) return found;
  }
  return null;
}

/**
 * The first run of EXACTLY `digits` digits, not a longer number's tail.
 *
 * The boundaries matter more than they look. A tracking number, an
 * order id and a phone number all contain six consecutive digits, and
 * matching the middle of one yields a plausible wrong code — the worst
 * possible outcome, because it is submitted rather than skipped.
 */
export function extractCode(sources: readonly string[], digits: number): string | null {
  const exact = new RegExp(`(?<!\\d)(\\d{${digits}})(?!\\d)`);
  for (const s of sources) {
    const m = exact.exec(s);
    if (m?.[1] !== undefined) return m[1];
  }
  return null;
}
