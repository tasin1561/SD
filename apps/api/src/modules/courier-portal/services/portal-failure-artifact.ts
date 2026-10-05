import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';

/**
 * A picture of the page at the moment a portal job failed.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * The nightly Delhivery wallet sync captured NOTHING when it failed. The
 * billing probe has saved screenshots and raw files to
 * `courier-probes/delhivery-billing/<runId>/` since September; the
 * sync — the job that actually runs every night and is the only thing
 * keeping `shipments.actualCourierCostInr` moving — saved nothing at all.
 *
 * Measured on 5 October 2026, an hour after the credential fix got the
 * sync past the company picker:
 *
 *   page.waitForEvent: Timeout 120000ms exceeded while waiting for event "download"
 *
 * The wait is correctly armed before the click, so the click landed and
 * Delhivery produced no file inside two minutes. Whether their export
 * got slower, whether the button has become a format menu, or whether
 * the page was still drawing is UNANSWERABLE from that sentence — and
 * each has a different fix. Somebody had to go and look by hand, which
 * is the loop an artifact closes.
 *
 * ── ON FAILURE ONLY ──────────────────────────────────────────────────
 * Never on a successful run. A nightly screenshot of a signed-in
 * finances page is a standing privacy and storage cost for a page whose
 * contents we already parsed, and the success path reports everything
 * useful about it already.
 *
 * ── WHAT MAY BE IN THE PICTURE, AND WHAT MAY NOT BE IN THE TEXT ──────
 * The screenshot is of a signed-in portal page, so it can show a wallet
 * balance, the company name and parcel ids. That is fine: it is the
 * operator's own account and they are debugging it.
 *
 * The KEY, the issue detail and the audit row are different — they are
 * read on a board, quoted in chat and stored append-only — so they
 * carry only: ids we generated, the URL with its query string removed
 * (their panel signs some of them — the `shiprocket-portal-network`
 * rule), and a control's own on-page label, capped. None of those can
 * hold a credential value, because nothing here ever puts one in a URL
 * or a button label, and the error message travelling beside them has
 * already been through `makeCredentialRedactor` at the session's
 * credential boundary (CUR-1).
 */

/** One convention for portal artefacts, shared with the billing probe. */
export const PORTAL_FAILURE_PREFIX = 'courier-probes/portal-failures';

/** Enough of the page to see what was on screen; short enough to read. */
const MAX_PAGE_TEXT = 20_000;
/** A control's label, not its subtree. */
const MAX_CONTROL_TEXT = 300;
/** A screenshot must never hold up the failure it is describing. */
const SCREENSHOT_TIMEOUT_MS = 20_000;

export interface PortalFailureArtifact {
  /** Where the page was, query string stripped. */
  readonly url: string | null;
  readonly screenshotKey: string | null;
  readonly textKey: string | null;
  /**
   * What the control the job was waiting on actually looked like. The
   * failure message says what we waited FOR; this says what was there.
   */
  readonly control: string | null;
  /** Non-null when the capture itself went wrong. Never thrown. */
  readonly error: string | null;
}

/**
 * Where the artefact is remembered: a NON-ENUMERABLE property on the
 * thrown error.
 *
 * On the error rather than in a return value because the capture
 * happens where the browser is (the fetcher) and the artefact is needed
 * where the issue is raised (the sync), with a `throw` in between.
 * Non-enumerable so a `JSON.stringify(err)` somewhere else does not
 * silently start copying it into a log line.
 */
const ARTIFACT_KEY = '__skydropPortalFailureArtifact';

export function attachPortalFailureArtifact<E>(err: E, artifact: PortalFailureArtifact): E {
  if (typeof err !== 'object' || err === null) return err;
  try {
    Object.defineProperty(err, ARTIFACT_KEY, {
      value: artifact,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  } catch {
    // A frozen error. The failure still has to reach the caller.
  }
  return err;
}

export function portalFailureArtifactOf(err: unknown): PortalFailureArtifact | null {
  if (typeof err !== 'object' || err === null) return null;
  const found = (err as Record<string, unknown>)[ARTIFACT_KEY];
  return typeof found === 'object' && found !== null ? (found as PortalFailureArtifact) : null;
}

/** One line per artefact, for an issue detail a person reads. */
export function describePortalFailureArtifact(a: PortalFailureArtifact): string {
  const lines = [
    a.url === null ? null : `Page: ${a.url}`,
    a.control === null ? null : `What was on the control we waited for: ${a.control}`,
    a.screenshotKey === null ? null : `Screenshot: ${a.screenshotKey}`,
    a.textKey === null ? null : `Page text: ${a.textKey}`,
    a.error === null ? null : `(the capture itself failed: ${a.error})`,
  ].filter((l): l is string => l !== null);
  return lines.length === 0 ? '' : `What was on screen when it failed:\n${lines.join('\n')}`;
}

/** Strip the query string: their panel signs some of them. */
function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

@Injectable()
export class PortalFailureArtifactService {
  private readonly logger = new Logger(PortalFailureArtifactService.name);

  constructor(private readonly spaces: SpacesService) {}

  /**
   * Save what is on screen. NEVER throws and never rejects: it is
   * called from inside a catch block, and a capture that became the
   * failure would replace a diagnosable problem with an undiagnosable
   * one.
   *
   * `describeControl` is the caller's — only the page object knows which
   * locator it was waiting on, and reading it here would mean this
   * service knowing every portal page's selectors.
   */
  async capture(input: {
    readonly page: Page;
    readonly job: string;
    readonly runId: string;
    readonly courierAccountId: string;
    readonly describeControl?: () => Promise<string | null>;
  }): Promise<PortalFailureArtifact> {
    const dir = `${PORTAL_FAILURE_PREFIX}/${input.job}/${input.runId}/${input.courierAccountId.slice(0, 8)}`;
    let url: string | null = null;
    let control: string | null = null;
    let screenshotKey: string | null = null;
    let textKey: string | null = null;
    const problems: string[] = [];

    try {
      url = safeUrl(input.page.url());
    } catch (err) {
      problems.push(`url: ${short(err)}`);
    }

    if (input.describeControl !== undefined) {
      try {
        const described = await input.describeControl();
        control = described === null ? null : clip(described, MAX_CONTROL_TEXT);
      } catch (err) {
        problems.push(`control: ${short(err)}`);
      }
    }

    // The TEXT first and the screenshot second: the text is what a grep
    // finds and it is a tenth of the bytes, so if only one of the two
    // survives a slow page it should be that one. (The Shiprocket probe
    // orders its reads the same way, for the same reason.)
    try {
      const text = await input.page.innerText('body');
      if (text.trim() !== '') {
        textKey = await this.put(
          `${dir}/page.txt`,
          Buffer.from(text.slice(0, MAX_PAGE_TEXT), 'utf8'),
          'text/plain; charset=utf-8',
        );
      }
    } catch (err) {
      problems.push(`text: ${short(err)}`);
    }

    try {
      const png = await input.page.screenshot({ fullPage: true, timeout: SCREENSHOT_TIMEOUT_MS });
      screenshotKey = await this.put(`${dir}/page.png`, png, 'image/png');
    } catch (err) {
      problems.push(`screenshot: ${short(err)}`);
    }

    const artifact: PortalFailureArtifact = {
      url,
      screenshotKey,
      textKey,
      control,
      error: problems.length === 0 ? null : problems.join('; ').slice(0, 300),
    };
    this.logger.warn({ ...artifact, job: input.job }, 'Captured a portal failure artefact');
    return artifact;
  }

  private async put(key: string, body: Buffer, contentType: string): Promise<string | null> {
    try {
      await this.spaces.putObject(key, body, contentType);
      return key;
    } catch (err) {
      this.logger.error({ key, err: short(err) }, 'Could not store a portal failure artefact');
      return null;
    }
  }
}

const short = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 160);

const clip = (s: string, max: number): string => s.replace(/\s+/g, ' ').trim().slice(0, max);
