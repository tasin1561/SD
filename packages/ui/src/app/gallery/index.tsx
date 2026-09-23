'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { applyMotionPreference } from '../motion/motion';
import type { GalleryEntry } from './types';
import { FORM_ENTRIES } from './entries-forms';
import { ACTION_ENTRIES } from './entries-actions';
import { STRUCTURE_ENTRIES } from './entries-structure';
import './gallery.css';

/**
 * The `/dev/ui` gallery: every app primitive, every state, live.
 *
 * Mounted by each app at `src/app/dev/ui/page.dev.tsx`, which is compiled
 * only when `APPS_DEV_ROUTES=1` (`pageExtensions`), so it never reaches a
 * production build. The three controls act on <html>, exactly where the
 * real theme pin, the real motion preference and `--motion-slow` live, so
 * what the gallery shows is what the apps will do:
 *
 *   Theme   System (no pin — follows the OS) · Light · Dark
 *   Motion  Full · Reduced (`data-reduced="1"`, the reduced path)
 *   Speed   1× · 0.25× (`--motion-slow: 4`)
 *
 * Nothing here is persisted: leaving the page restores the app's own theme
 * pin on the next load.
 */
const GROUPS: ReadonlyArray<{ readonly title: string; readonly entries: readonly GalleryEntry[] }> =
  [
    { title: 'Forms', entries: FORM_ENTRIES },
    { title: 'Actions and feedback', entries: ACTION_ENTRIES },
    { title: 'Structure and data', entries: STRUCTURE_ENTRIES },
  ];

type Theme = 'system' | 'light' | 'dark';
type Motion = 'full' | 'reduced';
type Speed = '1' | '0.25';

function Segment<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (v: T) => void;
}): ReactElement {
  return (
    <fieldset className="sk-gallery__seg">
      <legend>{legend}</legend>
      <span className="sk-gallery__opts">
        {options.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className="sk-gallery__opt"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
          >
            {label}
          </button>
        ))}
      </span>
    </fieldset>
  );
}

export function UiGallery({ appName }: { readonly appName: string }): ReactElement {
  const [theme, setTheme] = useState<Theme>('system');
  const [motion, setMotion] = useState<Motion>('full');
  const [speed, setSpeed] = useState<Speed>('1');

  // Start from whatever the app had pinned, so the first render is honest.
  useEffect(() => {
    const t = document.documentElement.getAttribute('data-theme');
    setTheme(t === 'light' || t === 'dark' ? t : 'system');
    setMotion(document.documentElement.getAttribute('data-reduced') === '1' ? 'reduced' : 'full');
  }, []);

  function pickTheme(t: Theme): void {
    setTheme(t);
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }
  function pickMotion(m: Motion): void {
    setMotion(m);
    applyMotionPreference(m);
  }
  function pickSpeed(s: Speed): void {
    setSpeed(s);
    document.documentElement.style.setProperty('--motion-slow', s === '1' ? '1' : '4');
  }

  return (
    <div className="sk-gallery">
      <header className="sk-gallery__bar">
        <h1 className="sk-gallery__title">
          UI gallery<small>{appName} · dev only</small>
        </h1>
        <div className="sk-gallery__controls">
          <Segment
            legend="Theme"
            value={theme}
            options={[
              ['system', 'System'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ]}
            onChange={pickTheme}
          />
          <Segment
            legend="Motion"
            value={motion}
            options={[
              ['full', 'Full'],
              ['reduced', 'Reduced'],
            ]}
            onChange={pickMotion}
          />
          <Segment
            legend="Speed"
            value={speed}
            options={[
              ['1', '1×'],
              ['0.25', '0.25×'],
            ]}
            onChange={pickSpeed}
          />
        </div>
      </header>
      <div className="sk-gallery__body">
        <nav className="sk-gallery__nav" aria-label="Primitives">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h2>{g.title}</h2>
              <ul>
                {g.entries.map((e) => (
                  <li key={e.id}>
                    <a href={`#${e.id}`}>{e.name}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <main>
          {GROUPS.map((g) => (
            <section key={g.title} className="sk-gallery__group" aria-label={g.title}>
              <h2>{g.title}</h2>
              {g.entries.length === 0 ? (
                <p className="sk-gallery__empty">Nothing in this group yet.</p>
              ) : (
                g.entries.map((e) => (
                  <article
                    key={e.id}
                    id={e.id}
                    className="sk-gallery__entry"
                    data-gallery-entry={e.id}
                  >
                    <div className="sk-gallery__entry-head">
                      <h3>{e.name}</h3>
                      {e.patterns.map((p) => (
                        <span key={p} className="sk-gallery__pattern">
                          {p}
                        </span>
                      ))}
                      <p className="sk-gallery__used">{e.usedFor}</p>
                    </div>
                    <div className="sk-gallery__states" data-wide={e.wide || undefined}>
                      {e.states.map((s) => (
                        <div key={s.label} className="sk-gallery__state">
                          <p className="sk-gallery__state-label">{s.label}</p>
                          {s.render()}
                        </div>
                      ))}
                    </div>
                  </article>
                ))
              )}
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
