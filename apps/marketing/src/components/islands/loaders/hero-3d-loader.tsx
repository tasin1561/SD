'use client';

import dynamic from 'next/dynamic';
import type { ReactElement } from 'react';

/**
 * The ONLY door to the three.js chunk. `ssr: false` is not allowed in a
 * Server Component in Next 15, which is why this loader is a client file;
 * the section that renders it stays a server component.
 */
const Scene = dynamic(() => import('@/three/spike-scene'), { ssr: false, loading: () => null });

export function Hero3D(): ReactElement {
  return <Scene />;
}
