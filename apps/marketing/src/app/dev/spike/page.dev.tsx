import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { Hero3D } from '@/components/islands/loaders/hero-3d-loader';

/** Dev route for the three.js size spike — never compiled in production. */
export const metadata: Metadata = {
  title: 'three spike (dev)',
  robots: { index: false, follow: false },
};

export default function SpikePage(): ReactElement {
  return (
    <main className="h-screen w-screen">
      <Hero3D />
    </main>
  );
}
