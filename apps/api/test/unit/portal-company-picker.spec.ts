import {
  PortalCompanyNotOfferedError,
  PortalSessionService,
} from '../../src/modules/courier-portal/services/portal-session.service';

/**
 * The company picker, and the leak it caused.
 *
 * On 29 September 2026 the owner changed their Delhivery portal password
 * and typed the new one into the `portalCompany` credential field.
 * `chooseCompany` built a locator out of that field — `getByText(company)`
 * — and a Playwright locator timeout QUOTES the text it waited for. So
 * six nights of failures wrote the plaintext password into nine
 * `audit_logs` rows (append-only, so they cannot be erased), three
 * `system_issues.detail` rows and the /cost-sync page, and the credential
 * had to be rotated.
 *
 * The misconfiguration was the owner's. Publishing it was ours.
 *
 * The second half is as expensive and much quieter: the failure was a
 * bare selector timeout, which points at our automation rather than at
 * the data, and it cost six days before anybody looked at the field.
 */

/**
 * Every constructor argument spelled out rather than spread — a count
 * that drifts should fail to COMPILE here (the same reason
 * `portal-login-detection.spec.ts` does it).
 */
function svc(): PortalSessionService {
  return new PortalSessionService(
    {} as never, // prisma
    {} as never, // credentials
    {} as never, // settings
    {} as never, // email
    {} as never, // audit
    {} as never, // issues
  );
}

/** What Playwright really says when a text locator times out. */
const locatorTimeout = (text: string): Error =>
  new Error(
    `locator.click: Timeout 8000ms exceeded.\n` +
      `Call log:\n  - waiting for getByText('${text}', { exact: true }).first()\n`,
  );

/**
 * A Page with just enough of Playwright on it: the company control is
 * present, the option click always fails, and `evaluate` returns the
 * dropdown's leaf texts.
 */
function page(opts: { offered: readonly string[] }) {
  return {
    url: () => 'https://one.delhivery.com/v2/login',
    evaluate: async (source: string) =>
      source.includes('data-sd-company') ? undefined : opts.offered,
    locator: () => ({
      first: () => ({
        count: async () => 1,
        click: async () => undefined,
      }),
      count: async () => 1,
    }),
    waitForTimeout: async () => undefined,
    getByText: (text: string) => ({
      first: () => ({
        click: async () => {
          throw locatorTimeout(text);
        },
      }),
    }),
  };
}

/**
 * The private under test, and it is expected to THROW — so this returns
 * the error rather than a union the assertions would each have to narrow.
 */
async function refusal(p: unknown, company: string): Promise<Error> {
  const s = svc() as unknown as {
    chooseCompany: (page: unknown, company: string) => Promise<boolean>;
  };
  try {
    await s.chooseCompany(p, company);
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
  throw new Error('chooseCompany was expected to refuse and did not');
}

describe('the company dropdown has no entry for what is configured', () => {
  const OFFERED = ['M S ENTERPRISE', 'MS EXPORTS'];
  const PASSWORD = 'Tr0ub4dor&3-horse';

  it('does not put the configured value in the failure — that is the leak', async () => {
    const err = await refusal(page({ offered: OFFERED }), PASSWORD);
    expect(err).toBeInstanceOf(PortalCompanyNotOfferedError);
    expect(err.message).not.toContain(PASSWORD);
    // Not a fragment of it either: a password quoted in halves is still
    // a password in an append-only audit row.
    expect(err.message).not.toContain('Tr0ub4dor');
    expect(err.message).not.toContain('horse');
  });

  it('does not carry Playwright’s locator dump, which is where the value came from', async () => {
    const err = await refusal(page({ offered: OFFERED }), PASSWORD);
    expect(err.message).not.toMatch(/getByText/);
    expect(err.message).not.toMatch(/Call log/);
    expect(err.message).not.toMatch(/Timeout \d+ms exceeded/);
  });

  it('says what the dropdown DID show, which is the whole diagnosis', async () => {
    // A bare selector timeout reads as our automation being broken, and
    // that is what sent six days of investigation the wrong way. The
    // options say in one line that the page is fine and the credential
    // is wrong.
    const err = await refusal(page({ offered: OFFERED }), PASSWORD);
    expect(err.message).toContain('M S ENTERPRISE');
    expect(err.message).toContain('MS EXPORTS');
    expect(err.message).toContain('portalCompany');
  });

  it('names the SHAPE when the configured value is not a company name at all', async () => {
    // The check nobody was making. A class, never a value.
    const err = await refusal(page({ offered: OFFERED }), PASSWORD);
    expect(err.message).toMatch(/does not read like a company name/);
  });

  it('stays quiet about the shape when the value is a plausible name', async () => {
    // A real company that is simply not on this login must not be
    // reported as "that looks like a password".
    const err = await refusal(page({ offered: OFFERED }), 'MS IMPORTS');
    expect(err.message).not.toMatch(/does not read like a company name/);
    expect(err.message).not.toContain('MS IMPORTS');
  });

  it('filters the control’s own label out of the offered list', async () => {
    const err = await refusal(
      page({ offered: ['Company', 'Continue', 'MS EXPORTS'] }),
      'NOT THERE',
    );
    expect(err.message).toContain('MS EXPORTS');
    expect(err.message).not.toMatch(/showed: (Company|Continue)/);
  });

  it('says their page may have changed when it can read no options at all', async () => {
    const err = await refusal(page({ offered: [] }), 'MS EXPORTS');
    expect(err.message).toMatch(/login page may have changed/);
  });
});
