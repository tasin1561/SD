'use client';

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import { UatFieldsProvider, type UatFieldMap } from '@skydrop/ui/app/uat-fields';
import type { ReactElement, ReactNode } from 'react';

/**
 * Fetches the UAT field switches and hands them to the provider.
 *
 * It lives in the app rather than in `@skydrop/ui` because the client
 * that knows this console's origin, its auth and its single-flight
 * refresh lives here (FE-3/FE-5). The package owns the shape and the
 * fail-closed default; this owns the request.
 *
 * A failure is not retried and is not surfaced: the answer then is
 * "every field hidden", which is what the client asked for and what the
 * form showed a moment ago anyway.
 */
export function UatFieldsBoundary({ children }: { children: ReactNode }): ReactElement {
  const client = useApiClient();
  const q = useQuery({
    queryKey: ['uat-fields'],
    queryFn: () => client.request<UatFieldMap>('/api/store/uat-fields'),
    // The owner flips these while somebody is watching.
    staleTime: 30_000,
    retry: false,
  });
  return <UatFieldsProvider value={q.data}>{children}</UatFieldsProvider>;
}
