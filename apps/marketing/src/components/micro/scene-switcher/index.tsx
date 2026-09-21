'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ms, reducedMotion } from '../motion';
import '../micro.css';
import './scene-switcher.css';

export interface Scene {
  id: string;
  hue: string;
  label: ReactNode;
  /** The giant ghost word behind the scene. */
  ghost: string;
  art: ReactNode;
  content: ReactNode;
}

/**
 * 11 · Scene switcher. Picking a thumbnail swaps art, content, ghost word
 * and the tint in ONE 500 ms move. The background is `--{hue}-surface` —
 * in dark the page navy mixed with the hue plus its glow, never the 950
 * (a saffron-950 scene was a brown panel) — the panels slide out toward the old
 * scene, swap, and slide in from the new one. The services showcase is
 * this component with four scenes.
 */
export function SceneSwitcher({
  scenes,
  label,
}: {
  scenes: readonly Scene[];
  label: string;
}): ReactElement {
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState(0);
  const [switching, setSwitching] = useState(false);
  const dir = useRef(24);
  useEffect(() => {
    if (active === shown) return;
    dir.current = active > shown ? 24 : -24;
    if (reducedMotion()) {
      setShown(active);
      return;
    }
    setSwitching(true);
    const t = window.setTimeout(() => {
      setShown(active);
      setSwitching(false);
    }, ms(250));
    return () => window.clearTimeout(t);
  }, [active, shown]);
  const scene = scenes[shown] ?? scenes[0];
  if (!scene) return <div className="mi mi-scene" />;
  const style = {
    '--scene-tint': `var(--${scene.hue}-surface)`,
    '--scene-glow': `var(--${scene.hue}-glow)`,
    '--scene-ink': `var(--${scene.hue}-text)`,
    '--dir': `${dir.current}px`,
  } as CSSProperties;
  return (
    <section className="mi mi-scene" style={style} data-switching={switching} aria-label={label}>
      <div className="mi-scene__ghost" aria-hidden>
        {scene.ghost}
      </div>
      <div className="mi-scene__stage">
        <div className="mi-scene__panel">{scene.content}</div>
        <div className="mi-scene__panel" aria-hidden>
          {scene.art}
        </div>
      </div>
      <div className="mi-scene__rail" role="tablist" aria-label={label}>
        {scenes.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            className="mi-scene__thumb"
            aria-selected={i === active}
            onClick={() => setActive(i)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </section>
  );
}
