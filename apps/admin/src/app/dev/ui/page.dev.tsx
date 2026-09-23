import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import localFont from 'next/font/local';
import '@skydrop/ui/brand/scales.css';
import '@skydrop/ui/brand/theme.css';
import '@skydrop/ui/brand/app.css';
import { UiGallery } from '@skydrop/ui/app/gallery';

/**
 * /dev/ui — the app-primitive gallery. DEV ONLY: `page.dev.tsx` is compiled
 * only when APPS_DEV_ROUTES=1 (see next.config.mjs), so it is absent from a
 * production build. It loads the brand skin and Plus Jakarta Sans itself,
 * because the rest of this app has not switched to them yet.
 */
const sans = localFont({
  src: '../../fonts/plus-jakarta-sans-latin.woff2',
  display: 'swap',
  preload: false,
});
const mono = localFont({
  src: '../../fonts/jetbrains-mono-latin.woff2',
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = {
  title: 'UI gallery',
  robots: { index: false, follow: false },
};

export default function UiGalleryPage(): ReactElement {
  // --app-font / --app-mono are resolved at :root, so they are redefined
  // there (not on a wrapper) — portals (dialogs, toasts) render into <body>.
  const fonts = `:root{--app-font:${sans.style.fontFamily},ui-sans-serif,system-ui,sans-serif;--app-mono:${mono.style.fontFamily},ui-monospace,monospace}`;
  return (
    <>
      <style>{fonts}</style>
      <UiGallery appName="Admin" />
    </>
  );
}
