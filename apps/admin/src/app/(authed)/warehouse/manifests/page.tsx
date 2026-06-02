import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
import { ManifestsIndex } from './_components/manifests-index';

export default function ManifestsPage(): ReactElement {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Manifests"
        subtitle="Find a DRAFT manifest, close it to trigger AWB generation, then confirm courier handoff."
      />
      <ManifestsIndex />
    </div>
  );
}
