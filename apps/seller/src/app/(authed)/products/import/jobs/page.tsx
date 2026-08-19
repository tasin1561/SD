import type { ReactElement } from 'react';
import { ImportJobsIndex } from '../_components/import-jobs-index';

/**
 * The full catalog-import history.
 *
 * Sits under /products/import so it inherits that route's `catalog.import`
 * permission from PAGE_PERMISSIONS — the same permission the server's
 * `@RequireSellerPermissions('catalog.import')` enforces on the
 * controller these pages read.
 */
export default function CatalogImportJobsPage(): ReactElement {
  return <ImportJobsIndex />;
}
