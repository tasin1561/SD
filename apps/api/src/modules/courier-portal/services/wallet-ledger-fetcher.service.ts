import { Injectable, Logger } from '@nestjs/common';
import { WalletLedgerPage } from '../pages/wallet-ledger.page';
import type { WalletWindow } from '../pages/wallet-date-range';
import { PortalSessionService } from './portal-session.service';
import {
  attachPortalFailureArtifact,
  PortalFailureArtifactService,
} from './portal-failure-artifact';

/**
 * Get the wallet ledger file. One job, and it owns the browser.
 *
 * Separate from the sync service on purpose: that one decides WHETHER
 * to run, how wide a window to ask for and whether the result may be
 * written, and none of those decisions should need Chromium to test.
 * Everything Playwright-shaped lives behind this seam.
 */
@Injectable()
export class WalletLedgerFetcherService {
  private readonly logger = new Logger(WalletLedgerFetcherService.name);

  constructor(
    private readonly session: PortalSessionService,
    private readonly artifacts: PortalFailureArtifactService,
  ) {}

  async fetch(
    courierAccountId: string,
    from: Date,
    to: Date,
    /**
     * Groups this run's artefacts. Passed in rather than made here so
     * two accounts failing on one night land under one folder.
     */
    runId: string,
  ): Promise<{ bytes: Buffer; rangeApplied: boolean; window: WalletWindow }> {
    // Signed in AS THAT ACCOUNT's company — each has its own wallet, and
    // reading the wrong one would import another company's costs.
    const page = await this.session.page(courierAccountId);
    const ledger = new WalletLedgerPage(page);
    try {
      const { bytes, rangeApplied, window } = await ledger.download(from, to);
      this.logger.log(
        {
          courierAccountId,
          bytes: bytes.length,
          from: from.toISOString(),
          to: to.toISOString(),
          // False means the export is whatever range their page defaults
          // to, not the one we asked for.
          rangeApplied,
          window,
        },
        'Downloaded the Delhivery wallet ledger',
      );
      return { bytes, rangeApplied, window };
    } catch (err) {
      /*
        CAPTURE BEFORE THE PAGE GOES.

        This is the only moment the evidence exists: the `finally` below
        closes the tab, and after that "waiting for event download timed
        out" is all anybody will ever have — which is true of a slower
        export, of a button that has become a format menu and of a page
        that was still drawing, and those need three different fixes.
        Measured live on 5 October 2026, and it cost the owner a manual
        look.

        The artefact rides ON the error so the failure keeps its class
        (the sync classifies a challenge off the message, and a wrapper
        would rewrite it) and so the issue the sync raises can point at
        the screenshot.
      */
      const artifact = await this.artifacts.capture({
        page,
        job: 'delhivery-wallet-sync',
        runId,
        courierAccountId,
        describeControl: () => ledger.describeDownloadControl(),
      });
      throw attachPortalFailureArtifact(err, artifact);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}
