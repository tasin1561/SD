'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Button } from './button';

/**
 * Modal primitive — Radix Dialog under the hood. Handles focus trap,
 * scroll-lock, Escape-to-close, accessibility (proper aria-* +
 * description). We style with our tokens.
 *
 * `tone="critical"` paints the panel in a way that conveys gravity
 * (used by the god-mode confirmation in CP2.10). Default tone is
 * quiet/neutral.
 *
 * Extraction-ready (no `@/...` imports).
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  tone = 'default',
  size = 'md',
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  readonly tone?: 'default' | 'critical';
  readonly size?: 'sm' | 'md' | 'lg';
}): ReactElement {
  const widthClass = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-md';
  const borderClass = tone === 'critical' ? 'border-[var(--color-critical-ring)]' : 'border-border';
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        {/*
         * Below `sm` this is a bottom sheet pinned to the bottom edge,
         * not a centred dialog. Two reasons: a centred box on a phone
         * puts its actions under the reader's thumb-reach and its top
         * under the notch, and a tall form inside a vertically-centred
         * `-translate-y-1/2` box overflows BOTH edges with no way to
         * scroll to either. `max-h` + `overflow-y-auto` on the body is
         * what makes a long form usable at all here.
         */}
        <Dialog.Content
          className={
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[12px] ' +
            `border ${borderClass} bg-surface shadow-[var(--shadow-3)] focus:outline-none ` +
            `sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-[calc(100vw-2rem)] ${widthClass} ` +
            'sm:max-h-[calc(100dvh-4rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[7px]'
          }
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div
            className={
              'flex shrink-0 items-start justify-between gap-4 border-b px-4 py-3 ' +
              (tone === 'critical' ? 'border-[var(--color-critical-ring)]' : 'border-border')
            }
          >
            <div className="min-w-0">
              <Dialog.Title
                className={
                  'text-sm font-medium ' +
                  (tone === 'critical' ? 'text-critical' : 'text-text-bright')
                }
              >
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="text-text-muted text-xs mt-1">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="text-text-muted hover:text-text-body hover:bg-surface-hover -mt-1.5 -mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[5px] transition-colors"
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </Dialog.Close>
          </div>
          {/* The only scrolling region — the header stays pinned so the
              close control never scrolls off a long form. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ModalFooter({ children }: { children: ReactNode }): ReactElement {
  return (
    // Stacked and full-width on a phone (confirm on top, where the
    // thumb is), side-by-side from `sm`. `[&>*]:w-full` reaches the
    // buttons without every call site having to pass a class.
    <div className="border-border mt-3 flex flex-col-reverse gap-2 border-t pt-3 [&>*]:w-full sm:flex-row sm:items-center sm:justify-end sm:[&>*]:w-auto">
      {children}
    </div>
  );
}

/** Lightweight confirmation modal — quiet tone, single confirm button.
 *  For typed-confirmation (god mode) use the full <Modal/> primitive
 *  with a custom body. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  disabled,
  onConfirm,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly confirmLabel?: ReactNode;
  readonly cancelLabel?: ReactNode;
  readonly confirmVariant?: 'primary' | 'destructive' | 'override';
  readonly disabled?: boolean;
  readonly onConfirm: () => void | Promise<void>;
}): ReactElement {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      tone={confirmVariant === 'override' ? 'critical' : 'default'}
      size="sm"
    >
      <ModalFooter>
        <Button variant="ghost" size="md" onClick={() => onOpenChange(false)} disabled={disabled}>
          {cancelLabel}
        </Button>
        <Button
          variant={confirmVariant}
          size="md"
          onClick={() => {
            void onConfirm();
          }}
          disabled={disabled}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
