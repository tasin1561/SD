'use client';

import { useState, type ReactElement } from 'react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { DropZone } from '@skydrop/ui/app/drop-zone';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { AfCard, AfSection, Notice } from '@/app/(authed)/system/_components/af-parts';
import './delhivery.css';
import { useImportWalletLedger, type WalletImportResult } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';

/**
 * What Delhivery actually charged, read off their wallet export.
 *
 * ── WHY A FILE ───────────────────────────────────────────────────────
 * They have no billing API. Their whole documented surface offers one
 * cost endpoint and it is a CALCULATOR — it answers "what does a parcel
 * of this shape cost", never "what was this parcel billed", and it
 * cannot see a revision. The wallet ledger is the only record of what
 * really left the account.
 *
 * ── WHY YOU RUN IT AGAIN ─────────────────────────────────────────────
 * A charge is not final. Generating the AWB debits immediately; a weight
 * recheck, a zone change or an RTO refunds that and charges again —
 * sometimes weeks after delivery. So this OVERWRITES what it wrote
 * before, and the count of revisions is shown, because a cost quietly
 * moving is the thing worth noticing.
 */
export function WalletImportPanel(): ReactElement | null {
  const t = useT();
  const mayImport = usePermission('money.treasury.manage');
  const run = useImportWalletLedger();
  const [fileName, setFileName] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [result, setResult] = useState<WalletImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!mayImport) return null;

  async function pick(file: File): Promise<void> {
    setError(null);
    setResult(null);
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    // Chunked, because spreading a megabyte of bytes into
    // String.fromCharCode at once overflows the call stack.
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    setBase64(btoa(binary));
  }

  function go(dryRun: boolean): void {
    if (base64 === null) return;
    setError(null);
    run.mutate(
      { fileBase64: base64, dryRun },
      { onSuccess: setResult, onError: (e) => setError(serverVerdict(e)) },
    );
  }

  return (
    <AfSection
      title={t('delhiveryWalletImportPanel.whatDelhiveryCharged')}
      note={t('delhiveryWalletImportPanel.financesDownloadLedgerThenDrop')}
    >
      <AfCard>
        <DropZone
          accept=".xlsx"
          label={t('delhiveryWalletImportPanel.dropTheLedgerExportHere')}
          buttonText={t('delhiveryWalletImportPanel.chooseTheXlsx')}
          hint={t('delhiveryWalletImportPanel.theWalletLedgerAsDelhivery')}
          onFiles={(files) => {
            const f = files[0];
            if (f) void pick(f);
          }}
        />

        {fileName !== null && (
          <div className="af-row">
            <Button
              variant="secondary"
              size="sm"
              disabled={base64 === null || run.isPending}
              loading={run.isPending}
              onClick={() => go(true)}
            >
              {t('delhiveryWalletImportPanel.checkFirst')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={base64 === null || run.isPending}
              onClick={() => go(false)}
            >
              {t('delhiveryWalletImportPanel.import')}
            </Button>
          </div>
        )}

        {error !== null && (
          <ErrorState title={t('delhiveryWalletImportPanel.notImported')} message={error} />
        )}

        {result !== null && (
          <div className="af-inner">
            <p className="af-title">
              {result.dryRun
                ? t('delhiveryWalletImportPanel.nothingWasWrittenThisIs')
                : t('delhiveryWalletImportPanel.imported')}
            </p>
            <dl className="dl-result">
              <dt>{t('delhiveryWalletImportPanel.rows')}</dt>
              <dd>
                {t('delhiveryWalletImportPanel.read', {
                  rowsRead: result.rowsRead,
                  value:
                    result.rowsSkipped > 0
                      ? t('delhiveryWalletImportPanel.skippedN', { n: result.rowsSkipped })
                      : '',
                })}
              </dd>
              <dt>{t('delhiveryWalletImportPanel.costsSet')}</dt>
              <dd>
                {t('delhiveryWalletImportPanel.deliveryReturn', {
                  forwardWritten: result.forwardWritten,
                  rtoWritten: result.rtoWritten,
                })}
              </dd>
              {/* The number that deserves a second look: a figure that
                  was already recorded has MOVED. */}
              <dt>{t('delhiveryWalletImportPanel.revised')}</dt>
              <dd className={result.revised > 0 ? 'af-warn af-strong' : undefined}>
                {result.revised}
              </dd>
              <dt>{t('delhiveryWalletImportPanel.unchanged')}</dt>
              <dd>{result.unchanged}</dd>
              <dt>{t('delhiveryWalletImportPanel.notOurs')}</dt>
              <dd>
                {t('delhiveryWalletImportPanel.awbsInTheFileWe', {
                  unknownAwbs: result.unknownAwbs,
                })}
              </dd>
              <dt>{t('delhiveryWalletImportPanel.total')}</dt>
              <dd>
                <Money amount={result.sumInr} currency="INR" convert={false} />
                {result.totalsAgree === true && (
                  <span className="af-faint">
                    {' '}
                    {t('delhiveryWalletImportPanel.matchesTheFileSOwn')}
                  </span>
                )}
              </dd>
            </dl>
            {result.totalsAgree === false && (
              <Notice tone="warn">
                <p>{t('delhiveryWalletImportPanel.theRowsDoNotAdd')}</p>
              </Notice>
            )}
          </div>
        )}
      </AfCard>
    </AfSection>
  );
}
