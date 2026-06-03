import type { ReactElement } from 'react';
import { AcceptInvitationForm } from './_components/accept-invitation-form';

/**
 * Public route — the invitee lands here from the email link. Sets
 * password + creates the staff account. On success, the API issues
 * a session cookie + the page navigates to /dashboard.
 */
export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<ReactElement> {
  const { token } = await searchParams;
  return <AcceptInvitationForm initialToken={token ?? ''} />;
}
