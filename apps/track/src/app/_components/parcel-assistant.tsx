'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { Send, Sparkles, X } from 'lucide-react';
import './parcel-assistant.css';

/**
 * "Ask about this parcel" — the public tracking page's helper.
 *
 * The browser talks ONLY to this app's own `/<awb>/ask` route (FE-3). The AWB
 * is the page's, never typed by the visitor. Nothing is stored in the browser:
 * the chat key lives in memory, so a reload starts a new chat.
 *
 * Every word on screen arrives as a prop (the server already knows the
 * locale), so this island ships no dictionary. The model's reply is shown as
 * plain text, never as HTML or markdown.
 */
export interface ParcelAssistantStrings {
  readonly button: string;
  readonly title: string;
  readonly badge: string;
  readonly intro: string;
  readonly placeholder: string;
  readonly send: string;
  readonly close: string;
  readonly notice: string;
  readonly typing: string;
  readonly error: string;
  readonly busy: string;
  readonly you: string;
  readonly answerFrom: string;
  readonly suggestions: readonly [string, string, string];
}

interface Line {
  readonly id: number;
  readonly from: 'you' | 'ai';
  readonly text: string;
}

const MAX_CHARS = 300;
const MAX_TURNS = 6;

type SseEvent =
  | { type: 'text'; delta: string }
  | { type: 'notice'; text: string }
  | { type: 'done'; conversationId: string };

function parseFrame(frame: string): SseEvent | null {
  const data = frame
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trimStart())
    .join('');
  if (data === '') return null;
  try {
    const v = JSON.parse(data) as Record<string, unknown>;
    if (v.type === 'text' && typeof v.delta === 'string') return { type: 'text', delta: v.delta };
    if (v.type === 'notice' && typeof v.text === 'string') return { type: 'notice', text: v.text };
    if (v.type === 'done' && typeof v.conversationId === 'string') {
      return { type: 'done', conversationId: v.conversationId };
    }
  } catch {
    /* a frame that is not ours is dropped, never guessed at */
  }
  return null;
}

export function ParcelAssistant({
  awb,
  strings: s,
}: {
  readonly awb: string;
  readonly strings: ParcelAssistantStrings;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const convRef = useRef<string | undefined>(undefined);
  const turnsRef = useRef(0);
  const nextId = useRef(1);
  const fabRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [lines, busy]);

  const close = useCallback((): void => {
    setOpen(false);
    fabRef.current?.focus();
  }, []);

  const ask = useCallback(
    async (raw: string): Promise<void> => {
      const text = raw.trim().slice(0, MAX_CHARS);
      if (text === '' || busy || turnsRef.current >= MAX_TURNS) return;
      keyRef.current ??= crypto.randomUUID();
      turnsRef.current += 1;
      const me = nextId.current++;
      const ai = nextId.current++;
      setLines((l) => [...l, { id: me, from: 'you', text }, { id: ai, from: 'ai', text: '' }]);
      setDraft('');
      setProblem(null);
      setBusy(true);
      const write = (fn: (t: string) => string): void =>
        setLines((l) => l.map((x) => (x.id === ai ? { ...x, text: fn(x.text) } : x)));
      try {
        const res = await fetch(`/${encodeURIComponent(awb)}/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            visitorKey: keyRef.current,
            ...(convRef.current === undefined ? {} : { conversationId: convRef.current }),
          }),
        });
        if (!res.ok || res.body === null) {
          setProblem(res.status === 429 ? s.busy : s.error);
          setLines((l) => l.filter((x) => x.id !== ai));
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';
        let notice: string | null = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          let at = buf.indexOf('\n\n');
          while (at !== -1) {
            const ev = parseFrame(buf.slice(0, at));
            buf = buf.slice(at + 2);
            at = buf.indexOf('\n\n');
            if (ev === null) continue;
            if (ev.type === 'text') write((t) => t + ev.delta);
            else if (ev.type === 'notice') notice = ev.text;
            else if (ev.conversationId !== '') convRef.current = ev.conversationId;
          }
        }
        if (notice !== null) write((t) => (t.trim() === '' ? notice : t));
        else write((t) => (t.trim() === '' ? s.error : t));
      } catch {
        setProblem(s.error);
        setLines((l) => l.filter((x) => x.id !== ai));
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [awb, busy, s.busy, s.error],
  );

  const left = MAX_CHARS - draft.length;

  return (
    <div className="pa-root">
      {!open && (
        <button
          ref={fabRef}
          type="button"
          className="pa-fab"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <span className="pa-chip" aria-hidden>
            <Sparkles size={16} />
          </span>
          <span className="pa-fab__label">{s.button}</span>
        </button>
      )}

      {open && (
        <section
          className="pa-panel"
          role="dialog"
          aria-labelledby={titleId}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
          }}
        >
          <header className="pa-head">
            <span className="pa-chip pa-chip--fill" aria-hidden>
              <Sparkles size={16} />
            </span>
            <h2 id={titleId} className="pa-head__title">
              {s.title}
              <span className="pa-badge">{s.badge}</span>
            </h2>
            <button type="button" className="pa-icon" aria-label={s.close} onClick={close}>
              <X size={18} aria-hidden />
            </button>
          </header>

          <div ref={logRef} className="pa-log" role="log" aria-live="polite" aria-busy={busy}>
            <p className="pa-msg pa-msg--ai pa-msg--intro">{s.intro}</p>
            {lines.map((l) =>
              l.from === 'you' ? (
                <p key={l.id} className="pa-msg pa-msg--you">
                  <span className="pa-sr">{s.you}: </span>
                  {l.text}
                </p>
              ) : (
                <p key={l.id} className="pa-msg pa-msg--ai">
                  {l.text === '' ? (
                    <span className="pa-dots" role="status" aria-label={s.typing}>
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    l.text
                  )}
                </p>
              ),
            )}
            {lines.length === 0 && (
              <div className="pa-sugg">
                {s.suggestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="pa-sugg__btn"
                    onClick={() => void ask(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            {problem !== null && (
              <p className="pa-problem" role="alert">
                {problem}
              </p>
            )}
          </div>

          <form
            className="pa-form"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(draft);
            }}
          >
            <input
              ref={inputRef}
              className="pa-input"
              value={draft}
              maxLength={MAX_CHARS}
              placeholder={s.placeholder}
              aria-label={s.placeholder}
              autoComplete="off"
              enterKeyHint="send"
              disabled={turnsRef.current >= MAX_TURNS && !busy}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="submit"
              className="pa-send"
              aria-label={s.send}
              disabled={busy || draft.trim() === ''}
            >
              <Send size={18} aria-hidden />
            </button>
            {left <= 60 && <span className="pa-count">{left}</span>}
          </form>
          <p className="pa-foot">{s.answerFrom}</p>
          <p className="pa-foot pa-foot--notice">{s.notice}</p>
        </section>
      )}
    </div>
  );
}
