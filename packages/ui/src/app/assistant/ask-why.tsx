'use client';

import { Sparkles } from 'lucide-react';
import { useSyncExternalStore, type ReactElement } from 'react';
import { useUiT } from '../i18n-client';
import { recordLastError } from '../last-error';
import './ask-why.css';

/**
 * "Ask AI why" — ONE shared hook-up between every place a console shows a
 * server error and the assistant widget, so no screen has to know the
 * assistant exists.
 *
 * Two tiny pieces of module state, memory only:
 *  - how many assistant widgets are mounted AND switched on for this console
 *    (the widget asks `…/status` once; off, or unreachable, means no button);
 *  - a window event the widget listens for, carrying the pre-filled question.
 *
 * The error itself travels the way it already does: it is written to the
 * last-error slot, and the widget sends it as the page context.
 */
export const ASK_ASSISTANT_EVENT = 'skydrop:assistant-ask';

export interface AskAssistantDetail {
  readonly question: string;
}

let available = 0;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

/** The widget calls this when its console's assistant is on; call the returned function to undo it. */
export function registerAssistantAvailable(): () => void {
  available += 1;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    available -= 1;
    emit();
  };
}

export function isAssistantAvailable(): boolean {
  return available > 0;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAssistantAvailable(): boolean {
  return useSyncExternalStore(subscribe, isAssistantAvailable, () => false);
}

/** `[CODE] message` (the server's verdict, FE-2) split back into its two parts. */
export function splitVerdict(text: string): { code: string | null; message: string } {
  const m = /^\[([A-Za-z0-9_.:-]{1,80})\]\s*([\s\S]*)$/.exec(text.trim());
  if (m === null) return { code: null, message: text.trim() };
  return { code: m[1] ?? null, message: (m[2] ?? '').trim() };
}

/** Load the error as the page context and ask the open widget to show the question. */
export function askAssistantWhy(errorText: string, question: string): void {
  if (typeof window === 'undefined') return;
  const { code, message } = splitVerdict(errorText);
  if (message === '') return;
  recordLastError(code, message);
  window.dispatchEvent(
    new CustomEvent<AskAssistantDetail>(ASK_ASSISTANT_EVENT, { detail: { question } }),
  );
}

/**
 * The small labelled button. Renders nothing unless an assistant is on, so a
 * console (or a test) without one looks exactly as it did before.
 */
export function AskAiWhy({
  message,
  className,
}: {
  /** The error as shown: `[CODE] message` or plain text. */
  readonly message: string;
  readonly className?: string | undefined;
}): ReactElement | null {
  const t = useUiT();
  const on = useAssistantAvailable();
  if (!on || message.trim() === '') return null;
  return (
    <button
      type="button"
      className={className === undefined ? 'sk-askwhy' : `sk-askwhy ${className}`}
      onClick={() => askAssistantWhy(message, t('ui.assistant.askWhyQuestion'))}
    >
      <Sparkles size={14} aria-hidden="true" />
      <span>{t('ui.assistant.askWhy')}</span>
    </button>
  );
}
