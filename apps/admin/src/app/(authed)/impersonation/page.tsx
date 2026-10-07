import type { ReactElement } from 'react';
import { ImpersonationReview } from './_components/impersonation-review';

/**
 * The support-session log.
 *
 * Gated on `support.impersonate.review` in `page-access.ts`, which the
 * nav filter and the route boundary both read — so somebody who may use
 * impersonation but not review it never sees a link here. The server
 * refuses the list regardless (FE-2).
 */
export default function ImpersonationPage(): ReactElement {
  return <ImpersonationReview />;
}
