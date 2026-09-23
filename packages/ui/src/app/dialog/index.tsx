'use client';

import * as RDialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { Check, Info, OctagonX, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Button } from '../button';
import './dialog.css';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Pinned under the scrolling body — put the buttons here. */
  footer?: ReactNode;
  /** Optional icon chip beside the title. */
  icon?: ReactNode;
  /** `xl` is for a dialog that carries a table. */
  size?: DialogSize | undefined;
  /** `critical` for anything irreversible: red rule, red title, red chip. */
  tone?: 'default' | 'critical' | undefined;
  /** While true, Escape / outside click / the close control do nothing. */
  locked?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Dialog (Radix): focus is trapped inside and returned to the trigger on
 * close, Escape and an outside click close it, the page behind is inert.
 * Enters with scale + fade from the centre (a bottom sheet below 640 px,
 * where a centred box puts its buttons out of thumb reach). The header and
 * footer stay pinned; only the body scrolls.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  icon,
  size = 'md',
  tone = 'default',
  locked = false,
  className,
}: DialogProps): ReactElement {
  return (
    <RDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && locked) return;
        onOpenChange(next);
      }}
    >
      <RDialog.Portal>
        <RDialog.Overlay className="sk-dialog__scrim" />
        <RDialog.Content
          className={clsx('sk-dialog', className)}
          data-size={size}
          data-tone={tone}
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
        >
          <div className="sk-dialog__head">
            {icon ? (
              <span className="sk-dialog__chip" aria-hidden>
                {icon}
              </span>
            ) : null}
            <div className="sk-dialog__titles">
              <RDialog.Title className="sk-dialog__title">{title}</RDialog.Title>
              {description !== undefined ? (
                <RDialog.Description className="sk-dialog__desc">{description}</RDialog.Description>
              ) : null}
            </div>
            <RDialog.Close asChild>
              <button
                type="button"
                className="sk-dialog__close"
                aria-label="Close"
                disabled={locked}
              >
                <X size={16} aria-hidden />
              </button>
            </RDialog.Close>
          </div>
          {children !== undefined ? <div className="sk-dialog__body">{children}</div> : null}
          {footer !== undefined ? <div className="sk-dialog__foot">{footer}</div> : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Buttons row: stacked full-width on a phone (confirm on top), right-aligned from 640 px. */
export function DialogFooter({ children }: { children: ReactNode }): ReactElement {
  return <div className="sk-dialog__actions">{children}</div>;
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The act, as a question or a verb phrase: "Refund this ticket?" */
  title: ReactNode;
  /** WHO or WHAT it acts on, restated in full: "Menev Store", "SD-2026-38-000101". */
  entity: string;
  /** Render the entity in the identifier face (order ID, AWB, serial, SKU). */
  entityIsIdentifier?: boolean | undefined;
  /** The money it moves — pass your own `<Money>`; this never formats money. */
  amount?: ReactNode;
  /** What happens, in one plain sentence: "The seller's wallet is credited at once." */
  consequence: string;
  confirmLabel: string;
  cancelLabel?: string | undefined;
  /** The real request. The confirm button is busy exactly while it runs. */
  onConfirm: () => Promise<unknown> | void;
  /** The server's verdict after a refusal, shown VERBATIM (FE-2). The caller sets it. */
  error?: ReactNode;
  /** Red confirm, critical tone. For anything that cannot be taken back. */
  destructive?: boolean | undefined;
  /** Extra inputs the act needs (a reason field). */
  children?: ReactNode;
  /** Close by itself when `onConfirm` resolves. Default true. */
  closeOnSuccess?: boolean | undefined;
}

/**
 * ConfirmDialog — for money-moving and irreversible acts. Its API makes
 * the restating REQUIRED: the entity, the consequence and (when money
 * moves) the amount are always on screen above the confirm button, so
 * nobody confirms "Are you sure?" without seeing what they are sure of.
 *
 * The confirm is wired to `onConfirm`: busy while it runs (and the dialog
 * cannot be dismissed mid-request), closed when it resolves, left open
 * when it rejects so the caller's `error` — the server verdict, verbatim —
 * can be read and the act retried.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  entity,
  entityIsIdentifier = false,
  amount,
  consequence,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  error,
  destructive = false,
  children,
  closeOnSuccess = true,
}: ConfirmDialogProps): ReactElement {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function confirm(): Promise<void> {
    setBusy(true);
    try {
      await onConfirm();
      if (!alive.current) return;
      setBusy(false);
      if (closeOnSuccess) onOpenChange(false);
    } catch {
      // The caller turns the rejection into `error`; we only stop being busy.
      if (alive.current) setBusy(false);
    }
  }

  const hasError = error !== undefined && error !== null && error !== false && error !== '';

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      tone={destructive ? 'critical' : 'default'}
      icon={destructive ? <TriangleAlert size={18} /> : <Info size={18} />}
      size="sm"
      locked={busy}
      footer={
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            loading={busy}
            onClick={() => {
              void confirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      }
    >
      <div className="sk-confirm">
        <div className="sk-confirm__subject">
          <span className={clsx('sk-confirm__entity', entityIsIdentifier && 'sk-ident')}>
            {entity}
          </span>
          {amount !== undefined && amount !== null ? (
            <span className="sk-confirm__amount sk-figure">{amount}</span>
          ) : null}
        </div>
        <p className="sk-confirm__consequence">{consequence}</p>
        {children}
        {hasError ? (
          <div className="sk-confirm__error" role="alert">
            <OctagonX size={16} aria-hidden />
            <div>{error}</div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

export interface SuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One line. */
  body: ReactNode;
  continueLabel?: string | undefined;
  /** Runs before the dialog closes (e.g. go to the new order). */
  onContinue?: (() => void) | undefined;
}

/**
 * SuccessDialog (u11) — a gradient card with a decorative arc, a scalloped
 * badge whose check draws itself, a title, one line and a Continue pill.
 * Enters with scale + fade. Show it only after a REAL success.
 */
export function SuccessDialog({
  open,
  onOpenChange,
  title,
  body,
  continueLabel = 'Continue',
  onContinue,
}: SuccessDialogProps): ReactElement {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="sk-dialog__scrim" />
        <RDialog.Content className="sk-okdlg">
          <span className="sk-okdlg__arc" aria-hidden />
          <span className="sk-okdlg__badge" aria-hidden>
            <svg viewBox="0 0 48 48" className="sk-okdlg__scallop" focusable="false">
              <path d="M24 2l4.6 3.4 5.6-1 2.3 5.2 5.4 2 .3 5.7 4.3 3.7-2.6 5 2.6 5-4.3 3.7-.3 5.7-5.4 2-2.3 5.2-5.6-1L24 46l-4.6-3.4-5.6 1-2.3-5.2-5.4-2-.3-5.7L1.5 27l2.6-5-2.6-5 4.3-3.7.3-5.7 5.4-2 2.3-5.2 5.6 1z" />
            </svg>
            <Check size={22} strokeWidth={3} className="sk-okdlg__check" />
          </span>
          <RDialog.Title className="sk-okdlg__title">{title}</RDialog.Title>
          <RDialog.Description className="sk-okdlg__body">{body}</RDialog.Description>
          <button
            type="button"
            className="sk-okdlg__continue"
            onClick={() => {
              onContinue?.();
              onOpenChange(false);
            }}
          >
            {continueLabel}
          </button>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
