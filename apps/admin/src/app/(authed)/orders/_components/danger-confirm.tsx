'use client';

import { ShieldAlert } from 'lucide-react';
import type { ReactElement } from 'react';
import { TextField } from '@skydrop/ui/app/text-field';
import { richMessage, useT } from '@/i18n/client';

/**
 * Pieces shared by the three god-mode dialogs (Force-mutate, Release
 * reservations, Restore stock claim).
 *
 * ── THE TYPED ORDER NUMBER IS A CLIENT-SIDE SPEED BUMP, NOTHING MORE ──
 * It stops a stray Enter on the wrong order. It is never sent to the API
 * (no request body in these dialogs reads it), and it is not a policy the
 * server relies on — the server still decides (FE-2). It is compared
 * trimmed and case-SENSITIVE: `sd-2026-1` is not `SD-2026-1`, because the
 * point is that the operator read the number.
 */
export function typedMatchesOrderNo(typed: string, orderNo: string): boolean {
  return orderNo !== '' && typed.trim() === orderNo;
}

/** The permanent-override warning, with its danger icon, for the top of a dialog. */
export function DangerBanner(): ReactElement {
  const t = useT();
  return (
    <div className="oc-god-panel od-danger-banner" role="note">
      <p className="oc-god-panel__title">
        <ShieldAlert size={14} aria-hidden />
        {t('ordersOrderActionsPanel.godModeOrd2')}
      </p>
      <p className="oc-god-panel__body">
        {richMessage(t('ordersOrderActionsPanel.bypassTheStateMachineAnd'), {
          span: <span className="sk-ident">CRITICAL</span>,
          span2: <span className="sk-ident">hasAdminOverride</span>,
        })}
      </p>
    </div>
  );
}

/** "Type SD-… to confirm". The value lives in the parent; this only reflects it. */
export function TypeToConfirm({
  orderNo,
  value,
  onChange,
  disabled = false,
}: {
  readonly orderNo: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly disabled?: boolean;
}): ReactElement {
  const t = useT();
  return (
    <TextField
      className="oo-god__typed od-typed-order"
      label={t('orderDetail.danger.typeToConfirm', { orderNo })}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={orderNo}
      disabled={disabled}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
    />
  );
}
