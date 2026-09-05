'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Card, CardBody, PageHeader, Section } from '@skydrop/ui/components';
import {
  useClearNotificationSubscription,
  useNotificationSubscriptions,
  useNotificationTopics,
  useSetNotificationSubscription,
  type TopicDef,
} from '@/lib/notification-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * What reaches this person, per topic.
 *
 * Its own page rather than a card under the inbox: these are standing
 * decisions — set once, changed rarely — and they were pushing a list
 * that is read several times a day down the screen every time somebody
 * came to see what had happened.
 */
export function NotificationSettingsView(): ReactElement {
  const topics = useNotificationTopics();
  const subs = useNotificationSubscriptions();
  const setSub = useSetNotificationSubscription();
  const clearSub = useClearNotificationSubscription();
  const [error, setError] = useState<string | null>(null);

  // A topic with no row follows its default, which is ON. Only an
  // explicit MUTED row switches something off.
  const muted = new Set((subs.data ?? []).filter((s) => s.mode === 'MUTED').map((s) => s.topic));
  const grouped = (topics.data ?? []).reduce<Record<string, TopicDef[]>>((acc, t) => {
    (acc[t.group] ??= []).push(t);
    return acc;
  }, {});

  return (
    <Section>
      <Link
        href="/notifications"
        className="text-text-muted hover:text-text-body mb-4 inline-flex items-center gap-1.5 text-xs transition-colors"
      >
        <ArrowLeft size={12} /> Notifications
      </Link>

      <PageHeader
        title="What reaches you"
        subtitle="Switch off anything you would rather not see. Messages about your account and credentials are not listed — they only ever go to your email, and cannot be silenced."
      />

      {error !== null && (
        <Card>
          <CardBody>
            <p className="text-status-failed-fg text-sm">{error}</p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          {topics.isLoading ? (
            <p className="text-text-muted text-sm">Loading…</p>
          ) : (
            Object.entries(grouped).map(([group, defs]) => (
              <div key={group} className="mt-4 first:mt-0">
                <h3 className="text-text-faint text-xs font-medium tracking-wide uppercase">
                  {group}
                </h3>
                <ul className="divide-border-subtle mt-1 divide-y">
                  {defs.map((d) => {
                    const on = !muted.has(d.topic);
                    return (
                      <li key={d.topic} className="flex items-start justify-between gap-4 py-2.5">
                        <div className="min-w-0">
                          <div className="text-sm">{d.label}</div>
                          <div className="text-text-muted text-xs">{d.description}</div>
                        </div>
                        <label className="flex shrink-0 items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={on}
                            aria-label={`Notify me about: ${d.label}`}
                            onChange={() => {
                              setError(null);
                              if (on) {
                                setSub.mutate(
                                  { topic: d.topic, mode: 'MUTED' },
                                  { onError: (e) => setError(serverVerdict(e)) },
                                );
                              } else {
                                clearSub.mutate(d.topic, {
                                  onError: (e) => setError(serverVerdict(e)),
                                });
                              }
                            }}
                          />
                          <span className="text-text-faint">{on ? 'On' : 'Off'}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </Section>
  );
}
