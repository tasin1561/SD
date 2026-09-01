'use client';

import { useState, type ReactElement } from 'react';
import { Button, Card, CardBody, CardHeader, ErrorNote, Money } from '@skydrop/ui/components';
import { AlertTriangle } from 'lucide-react';
import { useImportWalletLedger, type WalletImportResult } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';

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
    <Card>
      <CardHeader
        title="What Delhivery charged"
        subtitle="Finances → Download Ledger, then drop the .xlsx here. Export a month at a time."
      />
      <CardBody>
        <div className="space-y-3">
          <input
            type="file"
            accept=".xlsx"
            className="sd-field text-xs"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
            }}
          />

          {fileName !== null && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={base64 === null || run.isPending}
                onClick={() => go(true)}
              >
                {run.isPending ? 'Reading…' : 'Check first'}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={base64 === null || run.isPending}
                onClick={() => go(false)}
              >
                Import
              </Button>
            </div>
          )}

          {error !== null && <ErrorNote message={error} />}

          {result !== null && (
            <div className="border-border rounded-lg border p-3 text-xs space-y-2">
              <div className="text-text-bright">
                {result.dryRun ? 'Nothing was written — this is what would change.' : 'Imported.'}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt className="text-text-faint">Rows</dt>
                <dd>
                  {result.rowsRead} read
                  {result.rowsSkipped > 0 && `, ${result.rowsSkipped} skipped`}
                </dd>
                <dt className="text-text-faint">Costs set</dt>
                <dd>
                  {result.forwardWritten} delivery, {result.rtoWritten} return
                </dd>
                {/* The number that deserves a second look: a figure that
                    was already recorded has MOVED. */}
                <dt className="text-text-faint">Revised</dt>
                <dd className={result.revised > 0 ? 'text-[var(--color-warning)]' : ''}>
                  {result.revised}
                </dd>
                <dt className="text-text-faint">Unchanged</dt>
                <dd>{result.unchanged}</dd>
                <dt className="text-text-faint">Not ours</dt>
                <dd>{result.unknownAwbs} AWBs in the file we have no shipment for</dd>
                <dt className="text-text-faint">Total</dt>
                <dd>
                  <Money amount={result.sumInr} currency="INR" convert={false} />
                  {result.totalsAgree === true && (
                    <span className="text-text-faint"> · matches the file&rsquo;s own total</span>
                  )}
                </dd>
              </dl>
              {result.totalsAgree === false && (
                <div className="text-[var(--color-warning)] flex gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <p>
                    The rows do not add up to the total the file states. Something was mis-read —
                    re-download the export rather than trusting these figures.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
