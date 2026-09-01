import { Injectable, Logger } from '@nestjs/common';
import { WalletLedgerPage } from '../pages/wallet-ledger.page';
import { PortalSessionService } from './portal-session.service';

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

  constructor(private readonly session: PortalSessionService) {}

  async fetch(courierAccountId: string, from: Date, to: Date): Promise<Buffer> {
    // Signed in AS THAT ACCOUNT's company — each has its own wallet, and
    // reading the wrong one would import another company's costs.
    const page = await this.session.page(courierAccountId);
    try {
      const bytes = await new WalletLedgerPage(page).download(from, to);
      this.logger.log(
        {
          courierAccountId,
          bytes: bytes.length,
          from: from.toISOString(),
          to: to.toISOString(),
        },
        'Downloaded the Delhivery wallet ledger',
      );
      return bytes;
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}
