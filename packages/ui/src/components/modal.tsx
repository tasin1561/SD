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
  const widthClass =
    size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-md';
  const borderClass =
    tone === 'critical' ? 'border-[var(--color-critical-ring)]' : 'border-border';
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={
            `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] ${widthClass} ` +
            `z-50 rounded-[7px] border ${borderClass} bg-surface shadow-[var(--shadow-3)] ` +
            'focus:outline-none'
          }
        >
          <div
            className={
              'flex items-start justify-between gap-4 px-4 py-3 border-b ' +
              (tone === 'critical'
                ? 'border-[var(--color-critical-ring)]'
                : 'border-border')
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
                className="text-text-muted hover:text-text-body shrink-0 -mr-1 -mt-1 p-1 rounded-[3px] hover:bg-surface-hover transition-colors"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div className="px-4 py-3">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ModalFooter({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="flex items-center justify-end gap-2 pt-3 mt-3 border-t border-border">
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
        <Button
          variant="ghost"
          size="md"
          onClick={() => onOpenChange(false)}
          disabled={disabled}
        >
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
