import {
  extractCode,
  textOf,
} from '../../src/modules/courier-portal/services/gmail-otp-reader.service';

/**
 * The two pure decisions in reading a code out of a mailbox, which are
 * also the two that can submit a WRONG code rather than no code.
 *
 * Nothing here touches Google. The network half is three fetches whose
 * failure modes all return null and all mean the same thing to the
 * caller; the judgement is in these two functions.
 */
describe('extractCode', () => {
  it('takes a six-digit code from the subject', () => {
    expect(extractCode(['Your Shiprocket OTP is 481920'], 6)).toBe('481920');
  });

  it('REFUSES the middle of a longer number', () => {
    // An order id, a tracking number and a phone number all contain six
    // consecutive digits. Matching inside one yields a plausible code,
    // which is worse than no code: it gets submitted.
    expect(extractCode(['Order 1234567890 shipped'], 6)).toBeNull();
    expect(extractCode(['Call us on +919876543210'], 6)).toBeNull();
  });

  it('takes a code that ends a sentence or is bracketed', () => {
    expect(extractCode(['Code: 100200.'], 6)).toBe('100200');
    expect(extractCode(['(778899)'], 6)).toBe('778899');
  });

  it('keeps leading zeros — it is a string, not a number', () => {
    expect(extractCode(['Your code is 004219'], 6)).toBe('004219');
  });

  it('prefers the earlier source, so subject beats body footer', () => {
    expect(extractCode(['OTP 111111', 'support 999999'], 6)).toBe('111111');
  });

  it('returns null rather than guessing when nothing matches', () => {
    expect(extractCode(['No numbers here'], 6)).toBeNull();
    expect(extractCode([], 6)).toBeNull();
  });
});

describe('textOf', () => {
  it('reads subject first, then snippet, then the plain-text body', () => {
    const body = Buffer.from('body says 222222', 'utf8').toString('base64url');
    const out = textOf({
      snippet: 'snippet says 111111',
      payload: {
        mimeType: 'multipart/alternative',
        headers: [{ name: 'Subject', value: 'subject says 000000' }],
        parts: [{ mimeType: 'text/plain', body: { data: body } }],
      },
    });
    expect(out).toEqual(['subject says 000000', 'snippet says 111111', 'body says 222222']);
    // Order is the point: the code is put where a person reads it
    // without opening the mail, and the body carries the footer.
    expect(extractCode(out, 6)).toBe('000000');
  });

  it('survives a message with no body, no snippet and no subject', () => {
    expect(textOf({})).toEqual([]);
  });

  it('finds a plain-text part nested below the top level', () => {
    const data = Buffer.from('deep 345678', 'utf8').toString('base64url');
    const out = textOf({
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [{ mimeType: 'text/plain', body: { data } }],
          },
        ],
      },
    });
    expect(out).toEqual(['deep 345678']);
  });

  it('ignores an html-only body rather than scraping tags for digits', () => {
    const data = Buffer.from('<p>code 987654</p>', 'utf8').toString('base64url');
    const out = textOf({
      payload: { mimeType: 'text/html', body: { data } },
    });
    expect(out).toEqual([]);
  });
});
