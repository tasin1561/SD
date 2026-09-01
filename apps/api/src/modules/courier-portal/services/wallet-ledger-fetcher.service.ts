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

  async fetch(from: Date, to: Date): Promise<Buffer> {
    const page = await this.session.page();
    try {
      const bytes = await new WalletLedgerPage(page).download(from, to);
      this.logger.log(
        { bytes: bytes.length, from: from.toISOString(), to: to.toISOString() },
        'Downloaded the Delhivery wallet ledger',
      );
      return bytes;
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}
