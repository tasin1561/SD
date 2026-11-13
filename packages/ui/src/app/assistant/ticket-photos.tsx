'use client';

import { FileText, ImageIcon } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { useUiT } from '../i18n-client';
import './ticket-photos.css';

/** One file that went with a ticket, as `GET …/assistant/tickets/:id/photos` returns it. */
export interface TicketPhoto {
  readonly id: string;
  readonly kind: 'IMAGE' | 'PDF';
  readonly mediaType: string;
  readonly name: string;
  readonly bytes: number;
  /** Short-lived signed link that DOWNLOADS (`Content-Disposition: attachment`). Null if it could not be signed. */
  readonly url: string | null;
}

export function toTicketPhotos(value: unknown): TicketPhoto[] {
  const items = (value as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: TicketPhoto[] = [];
  for (const raw of items) {
    const v = (raw ?? {}) as Record<string, unknown>;
    if (typeof v['id'] !== 'string' || typeof v['name'] !== 'string') continue;
    out.push({
      id: v['id'],
      kind: v['kind'] === 'PDF' ? 'PDF' : 'IMAGE',
      mediaType: typeof v['mediaType'] === 'string' ? v['mediaType'] : '',
      name: v['name'],
      bytes: typeof v['bytes'] === 'number' ? v['bytes'] : 0,
      url: typeof v['url'] === 'string' && /^https?:\/\//.test(v['url']) ? v['url'] : null,
    });
  }
  return out;
}

/**
 * The photos a person sent the assistant before it raised their ticket.
 *
 * Self-contained so a ticket page needs ONE line:
 *   <TicketPhotos ticketId={id} fetcher={(id) => client.request(`/api/seller/assistant/tickets/${id}/photos`)} />
 * `fetcher` is the console's own authenticated call, so permission and
 * visibility are the server's. Renders nothing while loading, when there are
 * no photos, or when the call is refused: a ticket page without photos looks
 * exactly as it did before.
 */
export function TicketPhotos({
  ticketId,
  fetcher,
}: {
  readonly ticketId: string;
  readonly fetcher: (ticketId: string) => Promise<unknown>;
}): ReactElement | null {
  const t = useUiT();
  const [photos, setPhotos] = useState<readonly TicketPhoto[]>([]);
  // A thumbnail the page cannot load (a console whose CSP does not admit the bucket) falls back to the file icon; the link still downloads.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let live = true;
    setPhotos([]);
    setBroken(new Set());
    fetcher(ticketId)
      .then((r) => {
        if (live) setPhotos(toTicketPhotos(r));
      })
      .catch(() => {
        if (live) setPhotos([]);
      });
    return () => {
      live = false;
    };
    // `fetcher` is usually an inline arrow; the ticket is what the list belongs to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  if (photos.length === 0) return null;
  return (
    <section className="sk-tphotos" aria-label={t('ui.assistant.photos.title')}>
      <h3 className="sk-tphotos__title">
        <ImageIcon size={16} aria-hidden="true" />
        {t('ui.assistant.photos.title')}
      </h3>
      <ul className="sk-tphotos__grid">
        {photos.map((p) => (
          <li key={p.id}>
            <a
              className="sk-tphotos__item"
              href={p.url ?? undefined}
              rel="noopener noreferrer"
              download={p.name}
              aria-disabled={p.url === null ? 'true' : undefined}
              aria-label={t('ui.assistant.photos.open', { name: p.name })}
              title={p.name}
            >
              {p.kind === 'IMAGE' && p.url !== null && !broken.has(p.id) ? (
                // A signed, short-lived link: a plain <img> is the point, not an optimised one.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={() => setBroken((b) => new Set(b).add(p.id))}
                />
              ) : (
                <span className="sk-tphotos__doc" aria-hidden="true">
                  <FileText size={24} />
                </span>
              )}
              <span className="sk-tphotos__name">{p.name}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
