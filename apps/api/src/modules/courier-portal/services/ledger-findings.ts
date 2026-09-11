import { SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import type { SystemIssueService } from '../../system-issues/services/system-issue.service';
import type { WalletImportResult } from '../../wallet-ledger/services/wallet-import.service';

/**
 * What an import found wrong with a courier's ledger, said to a person.
 *
 * Shared by every nightly wallet sync — Delhivery's export and
 * Shiprocket's passbook end in the same importer, and its three findings
 * mean the same thing whichever courier produced them. Written once so the
 * two cannot drift into describing the same fault differently.
 */
export async function raiseLedgerFindings(
  issues: SystemIssueService,
  input: {
    readonly courierName: string;
    readonly source: string;
    readonly account: { readonly id: string; readonly label: string };
    readonly result: WalletImportResult;
  },
): Promise<void> {
  const { courierName, source, account, result } = input;

  /*
    THEY EDITED A TRANSACTION WE ALREADY HOLD.

    A courier corrects a charge by adding a reversal, never by
    rewriting history, so this should never fire — which is exactly
    why it is worth an alarm when it does. Our copy is NOT rewritten
    (the importer reports rather than applies); this tells a person
    so the difference is put to the courier while it is fresh.
  */
  if (result.txnsMutated > 0) {
    await issues.raise({
      kind: SystemIssueKind.MONEY,
      severity: SystemIssueSeverity.HIGH,
      title: `${result.txnsMutated} transaction(s) changed in ${account.label}'s ledger`,
      detail:
        `Their latest export carries ${result.txnsMutated} transaction(s) under ids we ` +
        'already hold, with a different amount, direction or waybill. They correct a ' +
        'charge by adding a reversal, not by editing one, so this is history being ' +
        'rewritten.\n\n' +
        result.mutated
          .slice(0, 10)
          .map(
            (m) =>
              `${m.txnId} · ${m.awbNumber ?? 'no AWB'} · ours ${m.ourKind} ₹${m.ourAmountInr} → theirs ${m.theirKind} ₹${m.theirAmountInr}`,
          )
          .join('\n') +
        `\n\nOur recorded copy has been kept unchanged. Ask ${courierName} in writing which is ` +
        'correct.',
      source,
      dedupeKey: `wallet-txn-mutated:${account.id}`,
      metadata: {
        courierAccountId: account.id,
        label: account.label,
        count: result.txnsMutated,
        mutated: result.mutated.slice(0, 25).map((m) => ({ ...m })),
      },
    });
  }

  /*
    THEIR LEDGER DROPPED SOMETHING WE HOLD.

    The importer has already stamped the rows and stopped netting them;
    this is the part that tells a person, because a charge vanishing
    from a courier's own history is a question to put to the courier,
    in writing, while the dates are fresh.
  */
  if (result.txnsMissing > 0) {
    const total = result.missing.reduce(
      (a, m) => a + (m.kind === 'DEBIT' ? 1 : -1) * Number(m.amountInr),
      0,
    );
    await issues.raise({
      kind: SystemIssueKind.MONEY,
      severity: SystemIssueSeverity.HIGH,
      title: `${result.txnsMissing} transaction(s) vanished from ${account.label}'s ledger`,
      detail:
        `Their latest export covers these dates but no longer contains ` +
        `${result.txnsMissing} transaction(s) we recorded earlier (net ₹${total.toFixed(2)}). ` +
        'Not a changed amount — the rows are gone.\n\n' +
        result.missing
          .slice(0, 10)
          .map(
            (m) =>
              `${m.txnId} · ${m.awbNumber ?? 'no AWB'} · ${m.kind} ₹${m.amountInr} · ${m.occurredAt.slice(0, 10)}`,
          )
          .join('\n') +
        '\n\nThey are kept on our side as evidence and no longer counted in parcel costs, ' +
        'because the current export still balances to the live wallet without them. Ask ' +
        `${courierName} in writing why they were removed.`,
      source,
      dedupeKey: `wallet-txn-missing:${account.id}`,
      metadata: {
        courierAccountId: account.id,
        label: account.label,
        count: result.txnsMissing,
        missing: result.missing.slice(0, 25).map((m) => ({ ...m })),
      },
    });
  }

  /*
    ONE OF OUR PARCELS NETS BELOW ZERO.

    Nobody is paid to carry a parcel, so this means our ledger is
    missing one of its debits — a charge dated before we held its
    history, or one that has since vanished. The importer refused to
    stamp it (a negative cost would be subtracted from the P&L); this
    is the half that tells somebody which parcels to look at.
  */
  if (result.incompleteHistory > 0) {
    await issues.raise({
      kind: SystemIssueKind.MONEY,
      severity: SystemIssueSeverity.HIGH,
      title: `${result.incompleteHistory} of our parcels net below zero in ${account.label}'s ledger`,
      detail:
        `Their charges and refunds for ${result.incompleteHistory} of our parcels add up ` +
        'to LESS than nothing, so a debit is missing from what we hold. Their cost was not ' +
        'changed.\n\n' +
        result.incomplete
          .slice(0, 10)
          .map((p) => `${p.awbNumber} · net ₹${p.netInr}`)
          .join('\n') +
        '\n\nFind the original charge on their panel; if it predates our ledger, record ' +
        'the cost by hand on the order.',
      source,
      dedupeKey: `wallet-negative-net:${account.id}`,
      metadata: {
        courierAccountId: account.id,
        label: account.label,
        count: result.incompleteHistory,
        incomplete: result.incomplete.slice(0, 25).map((p) => ({ ...p })),
      },
    });
  }
}
