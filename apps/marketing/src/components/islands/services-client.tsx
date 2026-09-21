'use client';

import { useState, type ReactElement } from 'react';
import { Check } from 'lucide-react';
import { SceneSwitcher } from '@/components/micro/scene-switcher';
import { LiquidBead } from '@/components/micro/liquid-bead';
import { SweepLink } from '@/components/micro/sweep';
import { platform } from '@/content/site';
import { SceneArt } from './scene-art';

type Service = (typeof platform.services)[number];
type Who = (typeof platform.whoWeServe)[number];

export function ServicesClient({
  services,
  whoWeServe,
}: {
  services: readonly Service[];
  whoWeServe: readonly Who[];
}): ReactElement {
  const [who, setWho] = useState<string>(whoWeServe[0]?.id ?? '');
  const current = whoWeServe.find((w) => w.id === who) ?? whoWeServe[0];
  return (
    <>
      <SceneSwitcher
        label="Our services"
        scenes={services.map((s) => ({
          id: s.id,
          hue: s.hue,
          label: s.label,
          ghost: s.ghost,
          art: <SceneArt kind={s.id} />,
          content: (
            <div className="svc__content" data-hue={s.hue}>
              <h3 className="svc__title">{s.title}</h3>
              <p className="svc__body">{s.body}</p>
              <ul className="svc__points">
                {s.points.map((p) => (
                  <li key={p} className="svc__point">
                    <span className="svc__point-ico" aria-hidden>
                      <Check size={12} strokeWidth={3} />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
              <SweepLink
                href={platform.nav.cta.href}
                tone={s.hue === 'saffron' ? 'saffron' : s.hue === 'green' ? 'green' : 'blue'}
                className="svc__cta"
              >
                {platform.nav.cta.label}
              </SweepLink>
            </div>
          ),
        }))}
      />
      <div className="who">
        <LiquidBead
          label="Who we serve"
          className="who__tabs"
          value={who}
          onChange={setWho}
          tabs={whoWeServe.map((w) => ({ id: w.id, label: w.label, hue: w.hue }))}
        />
        {current ? (
          <div
            key={current.id}
            className="who__panel sec-card"
            role="tabpanel"
            data-hue={current.hue}
          >
            <h3 className="who__title">{current.title}</h3>
            <p className="who__body">{current.body}</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
