'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps, ReactElement } from 'react';
import type HeroSceneType from '@/three/hero-scene';

/**
 * The ONLY door to the three.js chunk. `ssr: false` is not allowed in a
 * Server Component in Next 15, which is why this loader is a client file;
 * the island that renders it decides WHEN (gate + idle + on screen) and
 * nothing else may import `@/three/*`.
 */
const Scene = dynamic(() => import('@/three/hero-scene'), { ssr: false, loading: () => null });

export function Hero3D(props: ComponentProps<typeof HeroSceneType>): ReactElement {
  return <Scene {...props} />;
}
