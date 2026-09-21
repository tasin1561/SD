import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { MotionGallery } from '@/components/micro/gallery';

/** Dev route — compiled only with MARKETING_DEV_ROUTES=1 (see next.config.mjs). */
export const metadata: Metadata = {
  title: 'Motion gallery (dev)',
  robots: { index: false, follow: false },
};

export default function MotionPage(): ReactElement {
  return <MotionGallery />;
}
