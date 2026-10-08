import { Suspense, type ReactElement } from 'react';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { NewIssueForm } from './_components/new-issue-form';

/**
 * Raise an issue about one of this person's own orders.
 *
 * `useSearchParams` needs a Suspense boundary in the App Router, so the
 * form is a child client component and this page is the boundary.
 */
export default function NewIssuePage(): ReactElement {
  return (
    <Suspense fallback={<SkeletonRows rows={3} cols={1} label="Loading" />}>
      <NewIssueForm />
    </Suspense>
  );
}
