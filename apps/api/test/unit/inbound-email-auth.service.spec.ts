import { createHmac } from 'node:crypto';
import { InboundEmailAuthService } from '../../src/modules/courier-escalation/services/inbound-email-auth.service';
import {
  parseCourierEmail,
  stripQuotedHistory,
} from '../../src/modules/courier-escalation/services/courier-email-parser';

const SECRET = 'test-secret-value';

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('hex');
}

describe('InboundEmailAuthService', () => {
  const svc = new InboundEmailAuthService();
  const original = process.env['COURIER_INBOUND_EMAIL_SECRET'];

  afterEach(() => {
    if (original === undefined) delete process.env['COURIER_INBOUND_EMAIL_SECRET'];
    else process.env['COURIER_INBOUND_EMAIL_SECRET'] = original;
  });

  it('FAILS CLOSED when the secret is unset — an open write path is worse than an outage', () => {
    delete process.env['COURIER_INBOUND_EMAIL_SECRET'];
    expect(svc.isConfigured()).toBe(false);
    expect(() => svc.assertValid(Buffer.from('{}'), sign('{}'))).toThrow(/not configured/i);
  });

  it('accepts a correct signature over the RAW BYTES', () => {
    process.env['COURIER_INBOUND_EMAIL_SECRET'] = SECRET;
    const body = '{"subject":"Ticket ID: 123","from":"a@b.c"}';
    expect(() => svc.assertValid(Buffer.from(body, 'utf8'), sign(body))).not.toThrow();
  });

  it('rejects a signature computed over RE-SERIALISED json', () => {
    // The reason the raw bytes matter: JSON.parse → JSON.stringify
    // reorders keys and drops whitespace, so a signature taken over the
    // round-trip does not match the bytes that were sent.
    process.env['COURIER_INBOUND_EMAIL_SECRET'] = SECRET;
    const sent = '{"b":2,  "a":1}';
    const reserialised = JSON.stringify(JSON.parse(sent));
    expect(sent).not.toBe(reserialised);
    expect(() => svc.assertValid(Buffer.from(sent, 'utf8'), sign(reserialised))).toThrow(
      /invalid/i,
    );
  });

  it('rejects a missing signature', () => {
    process.env['COURIER_INBOUND_EMAIL_SECRET'] = SECRET;
    expect(() => svc.assertValid(Buffer.from('{}'), undefined)).toThrow(/missing/i);
  });

  it('rejects a signature made with the wrong secret', () => {
    process.env['COURIER_INBOUND_EMAIL_SECRET'] = SECRET;
    const body = '{}';
    expect(() => svc.assertValid(Buffer.from(body), sign(body, 'other-secret'))).toThrow(
      /invalid/i,
    );
  });

  it('survives a wrong-LENGTH signature without throwing from the comparison', () => {
    // timingSafeEqual throws on a length mismatch, and a thrown
    // comparison is itself a timing signal — hence the length check
    // first. The failure must be the ordinary 401.
    process.env['COURIER_INBOUND_EMAIL_SECRET'] = SECRET;
    expect(() => svc.assertValid(Buffer.from('{}'), 'abc')).toThrow(/invalid/i);
  });
});

describe('courier email parser', () => {
  it('finds the ticket id in the subject', () => {
    const out = parseCourierEmail({ subject: 'Ticket ID: 1234567 — update', text: 'body' });
    expect(out.externalTicketId).toBe('1234567');
  });

  it('prefers the SUBJECT over ids quoted in the body', () => {
    // A forwarded thread can quote other tickets; the subject is the one
    // the desk stamped for THIS message.
    const out = parseCourierEmail({
      subject: '[#111111] update',
      text: 'Regarding ticket id: 999999 mentioned earlier',
    });
    expect(out.externalTicketId).toBe('111111');
  });

  it('returns null rather than guessing when there is no id', () => {
    // A false positive attaches a courier message to the wrong
    // conversation; a false negative is merely visible.
    expect(
      parseCourierEmail({ subject: 'hello', text: 'no ids here' }).externalTicketId,
    ).toBeNull();
  });

  it('strips quoted history so the stored body is what they just said', () => {
    const body = stripQuotedHistory(
      'We are looking into it.\n\nOn Tue, 5 Aug 2026 at 10:00, Skydrop wrote:\n> our original message',
    );
    expect(body).toBe('We are looking into it.');
    expect(body).not.toContain('original message');
  });

  it('falls back to the html part when there is no text part', () => {
    const out = parseCourierEmail({
      subject: 'Ticket ID: 42424 x',
      html: '<p>Out for delivery<br>and should be delivered</p>',
    });
    expect(out.body).toContain('Out for delivery');
    expect(out.body).not.toContain('<p>');
  });

  it('picks up an AWB when one is present', () => {
    const out = parseCourierEmail({
      subject: 'Ticket ID: 42424',
      text: 'Regarding AWB 38061110478262 the shipment is delayed',
    });
    expect(out.awbNumber).toBe('38061110478262');
  });
});
