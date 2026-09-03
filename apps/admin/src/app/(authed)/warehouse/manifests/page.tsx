import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
import { ManifestsIndex } from './_components/manifests-index';

export default function ManifestsPage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="Manifests"
        subtitle="A record of which parcels went out together. Closing and courier handoff are automatic once a box is packed \u2014 nothing here needs doing unless something went wrong."
      />
      <ManifestsIndex />
    </div>
  );
}
