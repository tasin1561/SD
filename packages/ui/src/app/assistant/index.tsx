'use client';

import {
  Check,
  ChevronLeft,
  Copy,
  History,
  Info,
  MessageSquarePlus,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { useLocale, useUiT } from '../i18n-client';
import { readLastError } from '../last-error';
import { trapTab, useInertBackground, useIsPhone } from './phone-sheet';
import {
  ASSISTANT_API_BASE,
  orderSearchHref,
  quickActionsFor,
  type AssistantConsole,
} from './quick-actions';
import { Markdown } from './markdown';
import { readAssistantStream, type HelpLink, type NoticeCode } from './sse';
import { useAssistantSound } from './sound';
import './assistant.css';

export * from './sse';
export * from './markdown';
export * from './quick-actions';
export * from './sound';

/** How the widget reaches the API: each app passes its `ApiClient` (bearer token, single-flight refresh, same-origin proxy). The widget never fetches by itself. */
export interface AssistantTransport {
  request<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T>;
  /** Hand back the raw streaming response, unread (non-2xx must throw). `ApiClient` satisfies this as is. */
  requestStream(
    path: string,
    init?: { method?: 'POST'; body?: unknown; signal?: AbortSignal },
  ): Promise<Response>;
}

export interface AssistantWidgetProps {
  readonly console: AssistantConsole;
  readonly pathname: string | null;
  readonly transport: AssistantTransport;
  /** Client-side navigation for in-app links (next's `router.push`). */
  readonly navigate?: ((href: string) => void) | undefined;
}

interface Notice {
  readonly code: NoticeCode | 'SEND_FAILED';
  readonly text: string;
  readonly helpLinks: readonly HelpLink[];
}

interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly at: string;
  readonly status: 'streaming' | 'done';
  readonly notice?: Notice;
  /** The question to re-send when a send failed. */
  readonly retryText?: string;
}

interface ConversationRow {
  readonly id: string;
  readonly title: string | null;
  readonly updatedAt: string;
}

interface ConversationDetail {
  readonly conversation: { readonly id: string };
  readonly messages: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly text: string;
    readonly at: string;
  }>;
}

export const SEEN_KEY = 'skydrop.assistant.seen';
/** A sticky bottom action bar the launcher must sit above. */
export const BOTTOM_BAR_SELECTOR = '[data-bottom-bar], .as-bar, .prd-savebar';

let counter = 0;
const nextId = (): string => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // storage refused: never nag
  }
}
function writeSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // A cue that cannot be remembered is simply not shown again this visit.
  }
}

/** The page path the model is told about: no query string, bounded. */
export function contextPath(pathname: string | null): string | undefined {
  if (pathname === null || pathname === '') return undefined;
  return pathname.split('?')[0]?.slice(0, 200);
}

/** The optional `context` sent with a question. Undefined when there is nothing to say. */
export function buildContext(
  pathname: string | null,
  now: number = Date.now(),
): { path?: string; lastError?: { code?: string; message: string } } | undefined {
  const path = contextPath(pathname);
  const err = readLastError(now);
  const ctx: { path?: string; lastError?: { code?: string; message: string } } = {};
  if (path !== undefined) ctx.path = path;
  if (err !== null) {
    ctx.lastError = {
      ...(err.code !== null ? { code: err.code.slice(0, 80) } : {}),
      message: err.message.slice(0, 300),
    };
  }
  return ctx.path === undefined && ctx.lastError === undefined ? undefined : ctx;
}

function fmtTime(iso: string, locale: string): string {
  try {
    // `-u-nu-latn`: Western digits 0-9 in every language, Bangla included.
    return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}
function fmtDay(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function plain(text: string): string {
  return text.replace(/[*`#]/g, '');
}

export function AssistantWidget({
  console: consoleName,
  pathname,
  transport,
  navigate,
}: AssistantWidgetProps): ReactElement {
  const t = useUiT();
  const locale = useLocale();
  const sound = useAssistantSound();
  const base = ASSISTANT_API_BASE[consoleName];
  const titleId = useId();
  const inputId = useId();

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [toolName, setToolName] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [nudge, setNudge] = useState(false);
  const [lift, setLift] = useState(0);
  const [history, setHistory] = useState<
    { state: 'loading' } | { state: 'error' } | { state: 'ready'; rows: ConversationRow[] }
  >({ state: 'loading' });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const wasOpen = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const isPhone = useIsPhone();
  // The phone sheet covers the whole screen, so it is modal; the desktop side panel is not.
  const modal = open && isPhone;
  useInertBackground(panelRef, modal);

  const entityHref = useCallback((v: string) => orderSearchHref(consoleName, v), [consoleName]);

  // ── first-ever sight of the launcher: one gentle cue ────────────────
  useEffect(() => {
    if (readSeen()) return;
    writeSeen();
    setNudge(true);
    const id = window.setTimeout(() => setNudge(false), 9000);
    return () => window.clearTimeout(id);
  }, []);

  // ── keep the launcher above any sticky bottom action bar ────────────
  useEffect(() => {
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      let tallest = 0;
      document.querySelectorAll<HTMLElement>(BOTTOM_BAR_SELECTOR).forEach((el) => {
        const r = el.getBoundingClientRect();
        // Only a bar actually sitting at the bottom of the viewport counts.
        if (r.height > 0 && r.bottom >= window.innerHeight - 4 && r.top < window.innerHeight) {
          tallest = Math.max(tallest, window.innerHeight - r.top);
        }
      });
      setLift(Math.round(tallest));
    };
    const schedule = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    schedule();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    return () => {
      mo.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, { capture: true });
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  // ── focus in on open, back to the launcher on close ─────────────────
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      const id = window.requestAnimationFrame(() => inputRef.current?.focus());
      return () => window.cancelAnimationFrame(id);
    }
    if (wasOpen.current) launcherRef.current?.focus();
    return undefined;
  }, [open]);

  // ── stay pinned to the bottom while streaming, unless the reader scrolled up ──
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, busy, view]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const growInput = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const openPanel = (): void => {
    setMounted(true);
    setOpen(true);
    setNudge(false);
  };
  const closePanel = (): void => setOpen(false);

  const patchLast = (fn: (m: ChatMessage) => ChatMessage): void =>
    setMessages((all) => {
      const i = all.length - 1;
      const last = all[i];
      if (last === undefined) return all;
      return [...all.slice(0, i), fn(last)];
    });

  const send = useCallback(
    async (raw: string): Promise<void> => {
      const text = raw.trim();
      if (text === '' || busy) return;
      sound.tick();
      setView('chat');
      setDraft('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      setAnnounce('');
      setBusy(true);
      setToolName(null);
      stickRef.current = true;
      const now = new Date().toISOString();
      setMessages((all) => [
        ...all.filter((m) => m.retryText === undefined),
        { id: nextId(), role: 'user', text, at: now, status: 'done' },
        { id: nextId(), role: 'assistant', text: '', at: now, status: 'streaming' },
      ]);
      const ac = new AbortController();
      abortRef.current = ac;
      let sawNotice = false;
      let answer = '';
      try {
        let id = conversationId;
        if (id === null) {
          const created = await transport.request<{ id: string }>(`${base}/conversations`, {
            method: 'POST',
            body: {},
          });
          id = created.id;
          setConversationId(id);
        }
        const context = buildContext(pathname);
        const res = await transport.requestStream(`${base}/conversations/${id}/messages`, {
          method: 'POST',
          body: context === undefined ? { text } : { text, context },
          signal: ac.signal,
        });
        if (res.body === null) throw new Error('no stream');
        for await (const ev of readAssistantStream(res.body)) {
          if (ac.signal.aborted) return;
          if (ev.type === 'text') {
            answer += ev.delta;
            setToolName(null);
            patchLast((m) => ({ ...m, text: m.text + ev.delta }));
          } else if (ev.type === 'tool') {
            setToolName(ev.name);
          } else if (ev.type === 'notice') {
            sawNotice = true;
            patchLast((m) => ({
              ...m,
              notice: { code: ev.code, text: ev.text, helpLinks: ev.helpLinks },
            }));
          }
        }
        patchLast((m) => ({ ...m, status: 'done' }));
        if (sawNotice) sound.error();
        else {
          sound.chime();
          setAnnounce(plain(answer));
        }
      } catch {
        if (ac.signal.aborted) return;
        patchLast((m) => ({
          ...m,
          status: 'done',
          notice: { code: 'SEND_FAILED', text: t('ui.assistant.sendFailed'), helpLinks: [] },
          retryText: text,
        }));
        sound.error();
      } finally {
        if (abortRef.current === ac) {
          abortRef.current = null;
          setBusy(false);
          setToolName(null);
        }
      }
    },
    [base, busy, conversationId, pathname, sound, t, transport],
  );

  const newChat = (): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setMessages([]);
    setConversationId(null);
    setAnnounce('');
    setView('chat');
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const showHistory = (): void => {
    setView('history');
    setHistory({ state: 'loading' });
    transport
      .request<ConversationRow[]>(`${base}/conversations`)
      .then((rows) => setHistory({ state: 'ready', rows }))
      .catch(() => setHistory({ state: 'error' }));
  };

  const openConversation = (id: string): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    transport
      .request<ConversationDetail>(`${base}/conversations/${id}`)
      .then((d) => {
        setConversationId(d.conversation.id);
        setMessages(
          d.messages.map((m) => ({
            id: nextId(),
            role: m.role,
            text: m.text,
            at: m.at,
            status: 'done' as const,
          })),
        );
        stickRef.current = true;
        setView('chat');
      })
      .catch(() => setHistory({ state: 'error' }));
  };

  const copy = (m: ChatMessage): void => {
    const done = (): void => {
      setCopiedId(m.id);
      window.setTimeout(() => setCopiedId((c) => (c === m.id ? null : c)), 1600);
    };
    try {
      void navigator.clipboard.writeText(m.text).then(done, () => undefined);
    } catch {
      // Clipboard refused (insecure context): nothing to confirm.
    }
  };

  const onPanelKey = (e: KeyboardEvent<HTMLElement>): void => {
    if (modal && trapTab(e, panelRef.current)) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePanel();
    }
  };
  const onInputKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  };
  const onListScroll = (): void => {
    const el = listRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  const go = (href: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!navigate || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(href);
    // A phone's sheet covers the page it just navigated to.
    if (window.matchMedia('(max-width: 640px)').matches) closePanel();
  };

  // A link inside an answer: navigate in the console, and on a phone drop
  // the sheet that would otherwise cover the page it just opened.
  const followLink = navigate
    ? (href: string): void => {
        navigate(href);
        if (isPhone) closePanel();
      }
    : undefined;

  const suggestions = quickActionsFor(consoleName, pathname, readLastError() !== null);

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className="sk-ai-launcher"
        data-nudge={nudge ? '1' : undefined}
        data-hidden={open ? '1' : undefined}
        style={{ ['--sk-ai-lift' as string]: `${lift}px` }}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openPanel}
        tabIndex={open ? -1 : 0}
      >
        <Sparkles size={18} aria-hidden="true" />
        <span>{t('ui.assistant.launcher')}</span>
      </button>

      {mounted && isPhone ? (
        // The dimmed page behind the phone's bottom sheet; a tap on it closes the sheet.
        <div
          className="sk-ai-backdrop"
          data-open={open ? '1' : '0'}
          data-sk-ai-keep=""
          aria-hidden="true"
          onClick={closePanel}
        />
      ) : null}

      {mounted ? (
        <section
          ref={panelRef}
          className="sk-ai-panel"
          role="dialog"
          aria-modal={modal ? 'true' : 'false'}
          aria-labelledby={titleId}
          data-open={open ? '1' : '0'}
          inert={!open}
          onKeyDown={onPanelKey}
        >
          <div className="sk-ai-grab" aria-hidden="true" />
          <header className="sk-ai-head">
            {view === 'history' ? (
              <button
                type="button"
                className="sk-ai-icon"
                onClick={() => setView('chat')}
                aria-label={t('ui.assistant.back')}
                title={t('ui.assistant.back')}
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
            ) : (
              <span className="sk-ai-badge" aria-hidden="true">
                <Sparkles size={16} />
              </span>
            )}
            <h2 id={titleId} className="sk-ai-title">
              {view === 'history' ? t('ui.assistant.historyTitle') : t('ui.assistant.title')}
            </h2>
            <div className="sk-ai-tools">
              <button
                type="button"
                className="sk-ai-icon"
                onClick={newChat}
                aria-label={t('ui.assistant.newChat')}
                title={t('ui.assistant.newChat')}
              >
                <MessageSquarePlus size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="sk-ai-icon"
                onClick={showHistory}
                aria-label={t('ui.assistant.history')}
                title={t('ui.assistant.history')}
              >
                <History size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="sk-ai-icon"
                onClick={sound.toggleMute}
                aria-pressed={sound.muted}
                aria-label={sound.muted ? t('ui.assistant.unmute') : t('ui.assistant.mute')}
                title={sound.muted ? t('ui.assistant.unmute') : t('ui.assistant.mute')}
              >
                {sound.muted ? (
                  <VolumeX size={18} aria-hidden="true" />
                ) : (
                  <Volume2 size={18} aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className="sk-ai-icon"
                onClick={closePanel}
                aria-label={t('ui.assistant.close')}
                title={t('ui.assistant.close')}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </header>

          {view === 'history' ? (
            <div className="sk-ai-body" data-view="history">
              {history.state === 'loading' ? (
                <p className="sk-ai-hint">{t('ui.loading')}</p>
              ) : history.state === 'error' ? (
                <div className="sk-ai-empty">
                  <p>{t('ui.assistant.historyFailed')}</p>
                  <button type="button" className="sk-ai-cta" onClick={showHistory}>
                    {t('ui.retry')}
                  </button>
                </div>
              ) : history.rows.length === 0 ? (
                <div className="sk-ai-empty">
                  <p>{t('ui.assistant.historyEmpty')}</p>
                  <button type="button" className="sk-ai-cta" onClick={newChat}>
                    {t('ui.assistant.historyStart')}
                  </button>
                </div>
              ) : (
                <ul className="sk-ai-history">
                  {history.rows.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="sk-ai-history__row"
                        data-current={r.id === conversationId ? '1' : undefined}
                        onClick={() => openConversation(r.id)}
                      >
                        <span className="sk-ai-history__title">
                          {r.title ?? t('ui.assistant.untitled')}
                        </span>
                        <span className="sk-ai-history__when">{fmtDay(r.updatedAt, locale)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div
              ref={listRef}
              className="sk-ai-body"
              data-view="chat"
              onScroll={onListScroll}
              aria-busy={busy}
            >
              {messages.length === 0 ? (
                <div className="sk-ai-empty">
                  <span className="sk-ai-empty__mark" aria-hidden="true">
                    <Sparkles size={22} />
                  </span>
                  <h3>{t('ui.assistant.emptyTitle')}</h3>
                  <p>{t('ui.assistant.emptyBody')}</p>
                  <p className="sk-ai-hint">{t('ui.assistant.suggestions')}</p>
                  <div className="sk-ai-chips">
                    {suggestions.map((key) => (
                      <button
                        key={key}
                        type="button"
                        className="sk-ai-chip"
                        onClick={() => void send(t(key))}
                      >
                        {t(key)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m) => (
                  <article key={m.id} className="sk-ai-msg" data-role={m.role}>
                    <div className="sk-ai-msg__meta">
                      <span>
                        {m.role === 'user' ? t('ui.assistant.you') : t('ui.assistant.assistant')}
                      </span>
                      <time dateTime={m.at}>{fmtTime(m.at, locale)}</time>
                    </div>
                    {m.role === 'assistant' && m.text === '' && m.notice !== undefined ? null : (
                      <div
                        className="sk-ai-bubble"
                        data-streaming={m.status === 'streaming' ? '1' : undefined}
                      >
                        {m.role === 'user' ? (
                          <p className="sk-ai-plain">{m.text}</p>
                        ) : m.text === '' && m.notice === undefined ? (
                          <span className="sk-ai-typing" role="status">
                            <i />
                            <i />
                            <i />
                            <span className="sk-ai-sr">
                              {toolName !== null
                                ? t('ui.assistant.lookup')
                                : t('ui.assistant.typing')}
                            </span>
                          </span>
                        ) : (
                          <Markdown text={m.text} entityHref={entityHref} onNavigate={followLink} />
                        )}
                        {m.role === 'assistant' &&
                        m.status === 'streaming' &&
                        toolName !== null &&
                        m.text === '' ? (
                          <p className="sk-ai-hint" aria-hidden="true">
                            {t('ui.assistant.lookup')}
                          </p>
                        ) : null}
                      </div>
                    )}
                    {m.notice !== undefined ? (
                      <div className="sk-ai-notice" data-code={m.notice.code}>
                        <Info size={16} aria-hidden="true" />
                        <div>
                          <p>{m.notice.text}</p>
                          {m.notice.helpLinks.length > 0 ? (
                            <ul>
                              {m.notice.helpLinks.map((l) => (
                                <li key={l.path}>
                                  <a href={l.path} onClick={go(l.path)}>
                                    {l.label}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {m.retryText !== undefined ? (
                            <button
                              type="button"
                              className="sk-ai-cta"
                              disabled={busy}
                              onClick={() => void send(m.retryText ?? '')}
                            >
                              {t('ui.retry')}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {m.role === 'assistant' && m.status === 'done' && m.text !== '' ? (
                      <button
                        type="button"
                        className="sk-ai-copy"
                        onClick={() => copy(m)}
                        aria-label={t('ui.assistant.copy')}
                        title={t('ui.assistant.copy')}
                      >
                        {copiedId === m.id ? (
                          <>
                            <Check size={14} aria-hidden="true" />
                            <span>{t('ui.assistant.copied')}</span>
                          </>
                        ) : (
                          <Copy size={14} aria-hidden="true" />
                        )}
                      </button>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          )}

          {/* Announced ONCE, when the answer is complete — never per token. */}
          <div className="sk-ai-sr" aria-live="polite" aria-atomic="true">
            {announce}
          </div>

          <form
            className="sk-ai-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <label htmlFor={inputId} className="sk-ai-sr">
              {t('ui.assistant.inputLabel')}
            </label>
            <textarea
              ref={inputRef}
              id={inputId}
              className="sk-ai-input"
              rows={1}
              maxLength={2000}
              value={draft}
              placeholder={t('ui.assistant.inputPlaceholder')}
              onChange={(e) => {
                setDraft(e.target.value);
                growInput(e.target);
              }}
              onKeyDown={onInputKey}
            />
            <button
              type="submit"
              className="sk-ai-send"
              disabled={busy || draft.trim() === ''}
              aria-label={t('ui.assistant.send')}
              title={t('ui.assistant.send')}
            >
              <Send size={18} aria-hidden="true" />
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
