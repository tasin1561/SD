'use client';

import { useState, type ReactElement } from 'react';
import { Switch } from '@skydrop/ui/app/switch';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { AcAlert, AcCard, AcHeader, AcPage } from '../../../settings/_components/ac-parts';
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
    <AcPage width="narrow">
      <AcHeader
        crumbs={[{ label: 'Notifications', href: '/notifications' }, { label: 'What reaches you' }]}
        title="What reaches you"
        subtitle="Switch off anything you would rather not see. Messages about your account and credentials are not listed — they only ever go to your email, and cannot be silenced."
      />

      {error !== null && <AcAlert message={error} />}

      <AcCard flush>
        {topics.isLoading ? (
          <SkeletonRows rows={4} cols={2} />
        ) : (
          Object.entries(grouped).map(([group, defs]) => (
            <div key={group} className="ac-topic-group">
              <h3 className="ac-topic-group__title">{group}</h3>
              <ul className="ac-rows">
                {defs.map((d) => {
                  const on = !muted.has(d.topic);
                  return (
                    <li key={d.topic} className="ac-row">
                      <div className="ac-row__main">
                        <span className="ac-row__title">{d.label}</span>
                        <span className="ac-muted">{d.description}</span>
                      </div>
                      <div className="ac-row__side">
                        <Switch
                          checked={on}
                          aria-label={`Notify me about: ${d.label}`}
                          onCheckedChange={() => {
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
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </AcCard>
    </AcPage>
  );
}
