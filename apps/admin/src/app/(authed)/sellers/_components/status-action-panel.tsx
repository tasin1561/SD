'use client';

import { useState, type ReactElement } from 'react';
import { useUpdateSellerStatus } from '@/lib/api-hooks';
import { ApiError, type SellerStatusValue } from '@skydrop/api-client';
import {
  Button,
  FormField,
  Textarea,
  Modal,
  ModalFooter,
} from '@skydrop/ui/components';

/**
 * The well-built "action" of the seller list→detail→action→audit
 * template (CP2 commit 7 emphasis). Suspend ↔ Reapprove via PATCH
 * /admin/sellers/:id/status. The template every later admin action
 * copies:
 *
 *   1. Cosmetic RBAC (FE-2): if the role can't perform the action,
 *      show the affordance but disable it with a tooltip; the server
 *      enforces regardless. (Here: SUPER_ADMIN +
 *      SELLER_APPROVAL_ADMIN per phase-1a-debt M2 RBAC note.)
 *
 *   2. Confirmation modal with the consequence stated plainly.
 *      Destructive variant for SUSPEND, primary for REAPPROVE.
 *
 *   3. Optional reason capture — appears in the server audit trail.
 *      Stored against `metadata.reason` on the
 *      'seller.status_changed' audit log; surfaced in the seller's
 *      audit tab + the global audit log.
 *
 *   4. Server-error surfacing: the server is the boundary; if the
 *      request returns 4xx/5xx we display the body's message, not a
 *      generic "failed". The UI does NOT pre-validate beyond
 *      basics (e.g., we don't enforce reason length client-side —
 *      that would be reimplementing server policy).
 *
 *   5. On success: invalidate the sellers query → list + detail
 *      refetch → the new status badge replaces the old. The user
 *      sees the audit reflection naturally as the page re-renders.
 */
export function StatusActionPanel({
  sellerId,
  currentStatus,
  canChangeStatus,
}: {
  readonly sellerId: string;
  readonly currentStatus: SellerStatusValue;
  readonly canChangeStatus: boolean;
}): ReactElement {
  const [intent, setIntent] = useState<SellerStatusValue | null>(null);
  const [reason, setReason] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const mutate = useUpdateSellerStatus(sellerId);

  function open(target: SellerStatusValue): void {
    setIntent(target);
    setReason('');
    setServerError(null);
  }

  function close(): void {
    setIntent(null);
    setReason('');
    setServerError(null);
  }

  async function confirm(): Promise<void> {
    if (intent === null) return;
    setServerError(null);
    try {
      await mutate.mutateAsync({
        targetStatus: intent,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      close();
    } catch (err) {
      // Surface the server's verdict — do NOT reimplement guardrails
      // client-side. If the server rejected (e.g., a future RBAC
      // gate, or an invariant we don't know about), display its
      // message verbatim. UI is reading material; server is law.
      if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
        const body = err.body as { message?: unknown; code?: unknown };
        const msg = typeof body.message === 'string' ? body.message : err.message;
        const code = typeof body.code === 'string' ? body.code : null;
        setServerError(code ? `[${code}] ${msg}` : msg);
      } else if (err instanceof Error) {
        setServerError(err.message);
      } else {
        setServerError('Failed to change status.');
      }
    }
  }

  // Available actions depend on current status — the API enforces the
  // SellerAccountStatusService transitions; we mirror them cosmetically.
  const actions: Array<{
    target: SellerStatusValue;
    label: string;
    variant: 'primary' | 'destructive';
  }> = [];
  if (currentStatus === 'APPROVED') {
    actions.push({ target: 'SUSPENDED', label: 'Suspend account', variant: 'destructive' });
  } else if (currentStatus === 'SUSPENDED') {
    actions.push({ target: 'APPROVED', label: 'Reapprove account', variant: 'primary' });
  }
  // PENDING / REJECTED have no admin transition exposed via this
  // surface today (a future onboarding-approval workflow would add
  // them — phase-1a-debt M2 RBAC note).

  if (actions.length === 0) {
    return (
      <div className="text-text-muted text-sm">
        No status changes available from the current state ({currentStatus.toLowerCase()}).
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a.target}
            variant={a.variant}
            size="md"
            disabled={!canChangeStatus || mutate.isPending}
            onClick={() => open(a.target)}
            title={
              !canChangeStatus
                ? 'Requires SUPER_ADMIN or SELLER_APPROVAL_ADMIN role'
                : undefined
            }
          >
            {a.label}
          </Button>
        ))}
      </div>
      {!canChangeStatus && (
        <div className="text-text-faint text-xs mt-2">
          Your role can&apos;t change seller status. Contact a super-admin if you
          need this changed.
        </div>
      )}

      <Modal
        open={intent !== null}
        onOpenChange={(o) => !o && close()}
        title={
          intent === 'SUSPENDED' ? 'Suspend this seller?' : 'Reapprove this seller?'
        }
        description={
          intent === 'SUSPENDED'
            ? 'The seller will immediately lose portal access. Existing orders + shipments continue under our operations. A read-only profile view remains for ops.'
            : 'The seller regains full portal access. Their open invitations and existing orders are unaffected by the status change itself.'
        }
        size="md"
      >
        <FormField
          label="Reason (optional, recorded in the audit trail)"
          htmlFor="status-reason"
          hint="Surfaced on the seller's audit timeline + the global audit log."
        >
          <Textarea
            id="status-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g., Customer complaints about fulfillment quality."
            disabled={mutate.isPending}
          />
        </FormField>
        {serverError && (
          <div
            className="mt-3 px-2.5 py-1.5 rounded-[5px] text-critical text-xs"
            style={{
              background: 'var(--color-critical-tint)',
              border: '1px solid var(--color-critical-ring)',
            }}
          >
            {serverError}
          </div>
        )}
        <ModalFooter>
          <Button variant="ghost" size="md" onClick={close} disabled={mutate.isPending}>
            Cancel
          </Button>
          <Button
            variant={intent === 'SUSPENDED' ? 'destructive' : 'primary'}
            size="md"
            onClick={() => {
              void confirm();
            }}
            disabled={mutate.isPending}
          >
            {mutate.isPending
              ? 'Working…'
              : intent === 'SUSPENDED'
                ? 'Suspend'
                : 'Reapprove'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
