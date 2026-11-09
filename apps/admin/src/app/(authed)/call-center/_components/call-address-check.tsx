'use client';

import { useEffect, useRef, type ReactElement } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { AddressCheckPanel } from '@skydrop/ui/app/address-check';
import { useOrderAddressCheck, useRecheckOrderAddress } from '@/lib/address-check-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';
import { Notice } from '../../orders/_components/order-ops-parts';
import './call-address-check.css';

/**
 * The address verdict on the call bench, and its re-check.
 *
 * ── WHY IT IS ON THIS SCREEN AT ALL ──────────────────────────────────
 * The agent is the only person who ever speaks to the customer, and the
 * score plus its detail is the difference between "confirm your address"
 * and "which post office is that, and is there a house number?" — the
 * questions come from the panel verbatim. It is READING MATERIAL: it
 * disables no outcome and holds no attempt back (FE-2). A low score is
 * something to ask about, not a refusal the agent is left holding.
 *
 * ── THE RE-CHECK IS A CONSEQUENCE, NEVER A GATE ──────────────────────
 * `recheckToken` changes only AFTER the agent's edit has been saved by
 * the server, and the one effect below fires once per value. So the
 * order is always: the edit lands, then we ask again. A re-check that
 * fails leaves the edit exactly where it is and says so here, which is
 * the only outcome that cannot lose somebody's work.
 *
 * While it is in flight the stored verdict stays on screen with a line
 * above it saying it is being re-checked — blanking the panel would
 * take the agent's script away mid-call.
 */
export function CallAddressCheck({
  orderId,
  recheckToken,
}: {
  readonly orderId: string;
  /** Bumped by the recipient form once an ADDRESS field has been saved. */
  readonly recheckToken: number;
}): ReactElement | null {
  const tr = useT();
  const stored = useOrderAddressCheck(orderId);
  const recheck = useRecheckOrderAddress();
  const fired = useRef(0);

  useEffect(() => {
    if (recheckToken === 0 || fired.current === recheckToken) return;
    // Latched BEFORE the call: a re-render while it is in flight must
    // not ask Solustation the same question twice.
    fired.current = recheckToken;
    recheck.mutate(
      { orderId },
      {
        // ONLY on failure. The answer to a successful re-check is the
        // response itself, already in the read's cache — re-reading
        // would be a second request whose only possible effect is to
        // race it and put the older verdict back. On a failure the
        // server has marked the row unavailable, and that IS news.
        onError: () => {
          void stored.refetch();
        },
      },
    );
  }, [recheckToken, orderId, recheck, stored]);

  const view = stored.data ?? null;
  // An order with no check (the common case for anything older than the
  // sweep's window) and no re-check in flight has nothing to show —
  // better than a card of blanks on a screen read with a phone ringing.
  if (view === null && !recheck.isPending && !recheck.isError) return null;

  return (
    <div className="cc-ac">
      {recheck.isPending ? (
        <p className="cc-ac__busy" role="status">
          <Loader2 size={14} aria-hidden className="cc-ac__spin" />
          {tr('callCenterCallAddressCheck.rechecking')}
        </p>
      ) : null}
      {recheck.isError ? (
        // Verbatim `[CODE] message` — the server is the law (FE-2).
        <Notice tone="warn" role="status" icon={<TriangleAlert size={16} />}>
          <p className="oo-p">
            {serverVerdict(recheck.error, tr('callCenterCallAddressCheck.recheckFailed'))}
          </p>
        </Notice>
      ) : null}
      {view !== null ? <AddressCheckPanel result={view} readOnly /> : null}
    </div>
  );
}
