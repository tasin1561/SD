import type { ReactElement } from 'react';
import { PageHeader, EmptyState } from '@skydrop/ui/components';

/**
 * Profile — company info, contact, bank details (Phase 1B
 * remittance-adjacent — surfaced read-only in 1A). Profile editing
 * is a fast-follow after the CP2 pattern-setters establish form +
 * audit conventions.
 */
export default function ProfilePage(): ReactElement {
  return (
    <>
      <PageHeader title="Profile" subtitle="Company info + contact." />
      <EmptyState
        title="Profile editing — fast-follow"
        description="Read-only company info from the SSR identity is sufficient for CP2 pattern-setters; full edit form lands once the catalog write surface stabilises."
      />
    </>
  );
}
