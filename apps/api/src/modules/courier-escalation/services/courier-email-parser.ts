/**
 * Pull a ticket id and a usable body out of a Delhivery notification
 * email.
 *
 * ── EVERYTHING HERE IS A GUESS UNTIL A REAL EMAIL ARRIVES ────────────
 * TODO(delhivery-api): the exact subject wording, the ticket-id format,
 * and whether the body is HTML or plain text are all UNVERIFIED. The
 * patterns below are written from the ticket ids visible in the One
 * panel and from ordinary support-desk conventions. They are kept in ONE
 * file, as pure functions with no I/O, precisely so correcting them
 * against a real message is a small, testable change rather than a hunt.
 *
 * The parser is deliberately permissive about WHERE it finds the id and
 * strict about the SHAPE, because a false negative (unparsed email) is
 * visible — it lands in the unbound log — while a false positive would
 * attach a courier message to the wrong conversation.
 */

export interface ParsedCourierEmail {
  readonly externalTicketId: string | null;
  /** Quoted history and signatures removed; still VERBATIM otherwise. */
  readonly body: string;
  readonly awbNumber: string | null;
}

/**
 * Ticket id, e.g. `#1234567` or "Ticket ID: 1234567".
 * TODO(delhivery-api): confirm the real prefix and length.
 */
const TICKET_PATTERNS: readonly RegExp[] = [
  /ticket\s*(?:id|no\.?|number)\s*[:#-]?\s*([A-Z0-9-]{4,24})/i,
  /\[\s*#\s*([A-Z0-9-]{4,24})\s*\]/i,
  /#([0-9]{5,12})\b/,
];

/** Delhivery AWBs seen so far are 11–14 digits. */
const AWB_PATTERN = /\b([0-9]{11,14})\b/;

/**
 * Where a reply stops and the quoted thread begins.
 *
 * ── "KEEPING TOO MUCH IS THE SAFE DIRECTION" IS ONLY HALF TRUE ───────
 * For READING, yes: extra quoted history is noise, while over-trimming
 * silently truncates what the courier actually said. But retained
 * history breaks two things that are not about reading at all, and both
 * fail SILENTLY:
 *
 *  1. **Dedup goes inert.** The dedup key is a hash of the body. If the
 *     body carries the growing thread beneath it, the same logical
 *     message read through two channels (an email that quotes history
 *     and a portal re-read that does not) hashes differently and is
 *     stored twice. The unique index never fires, the minute-bucket
 *     never matters, and the pipeline looks like it is working while
 *     quietly duplicating.
 *
 *  2. **Classification sticks.** The matcher runs over the whole body.
 *     One quoted "out for delivery and should be delivered by the end of
 *     the day" from last week makes EVERY later message in that thread
 *     classify as OFD_TODAY, forever, with high confidence.
 *
 * So the markers below are load-bearing, not cosmetic. The check that
 * matters on the first real Delhivery email is NOT whether the text
 * reads nicely: it is ingesting the same message twice and confirming
 * `courier_escalation_messages_dedup` actually fires. If it does not,
 * the stripping is wrong however good the text looks.
 *
 * TODO(delhivery-api): these markers are English-client conventions. A
 * real notification email is what tells us which one Delhivery uses.
 */
const QUOTE_MARKERS: readonly RegExp[] = [
  /^\s*On .+ wrote:\s*$/im,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*_{5,}\s*$/m,
  /^\s*From:\s.+$/im,
];

export function stripQuotedHistory(body: string): string {
  let cut = body.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(body);
    if (m !== null && m.index < cut) cut = m.index;
  }
  return body.slice(0, cut).trim();
}

/**
 * Crude HTML → text. Not a renderer: enough to get readable prose out of
 * a templated support email without pulling in a dependency for a shape
 * we have not yet seen.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseCourierEmail(input: {
  readonly subject: string;
  readonly text?: string | null;
  readonly html?: string | null;
}): ParsedCourierEmail {
  const raw =
    input.text != null && input.text.trim() !== ''
      ? input.text
      : input.html != null
        ? htmlToText(input.html)
        : '';
  const body = stripQuotedHistory(raw);

  // Subject first: support desks put the id there reliably, and the body
  // may quote OTHER ticket ids from a forwarded thread.
  const haystacks = [input.subject, body];
  let externalTicketId: string | null = null;
  outer: for (const h of haystacks) {
    for (const re of TICKET_PATTERNS) {
      const m = re.exec(h);
      if (m?.[1] != null) {
        externalTicketId = m[1];
        break outer;
      }
    }
  }

  const awb = AWB_PATTERN.exec(`${input.subject}\n${body}`);
  return {
    externalTicketId,
    body,
    awbNumber: awb?.[1] ?? null,
  };
}
