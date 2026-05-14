import { resolveSender } from '../../src/modules/email/sender-resolver';

describe('resolveSender', () => {
  it.each([
    'staff.password_reset.email',
    'seller.password_reset.email',
    'staff.email_verification.email',
    'seller.email_verification.email',
    'staff.login_alert.email',
    'seller.security_alert.email',
  ])('routes auth/security template %s → security@', (code) => {
    expect(resolveSender(code).from).toContain('security@skydrop.online');
  });

  it.each([
    'seller.invitation.email',
    'seller.welcome.email',
    'seller.approved.email',
    'seller.rejected.email',
    'order.confirmed.seller.email',
    'shipment.rto_initiated.seller.email',
  ])('routes business template %s → hello@', (code) => {
    expect(resolveSender(code).from).toContain('hello@skydrop.online');
  });

  it('always sets reply-to to support@', () => {
    expect(resolveSender('anything.foo.email').replyTo).toContain('support@skydrop.online');
    expect(resolveSender('staff.password_reset.email').replyTo).toContain('support@skydrop.online');
  });

  it('uses friendly display names', () => {
    expect(resolveSender('staff.password_reset.email').from).toMatch(/^Skydrop Security </);
    expect(resolveSender('seller.invitation.email').from).toMatch(/^Skydrop </);
  });
});
