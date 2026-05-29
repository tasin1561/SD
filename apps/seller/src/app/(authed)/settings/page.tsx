import type { ReactElement } from 'react';
import { PageHeader, EmptyState } from '@skydrop/ui/components';

/**
 * Settings — notification preferences (channels, categories, quiet
 * hours), API keys, locale. Phase 1A surfaces the existing seller-side
 * preferences; full UI is a fast-follow.
 */
export default function SettingsPage(): ReactElement {
  return (
    <>
      <PageHeader title="Settings" subtitle="Notifications, API keys, preferences." />
      <EmptyState
        title="Settings — fast-follow"
        description="The seller-side notification preferences + API key endpoints exist (Module 2 + Module 11); the management UI is post-CP2."
      />
    </>
  );
}
