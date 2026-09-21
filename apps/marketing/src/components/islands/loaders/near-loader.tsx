'use client';

import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { openWhenNear } from '@/lib/near-gate';

/** Wraps an island whose `dynamic()` factory awaits `nearGate(id)`; opens the gate when near. */
export function NearLoader({ id, children }: { id: string; children: ReactNode }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => openWhenNear(id, ref.current), [id]);
  return (
    <div ref={ref} data-near-gate={id}>
      {children}
    </div>
  );
}
