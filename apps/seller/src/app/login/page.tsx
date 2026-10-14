import type { ReactElement } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSellerSsrIdentity } from '@skydrop/auth/server';
import { OtherPortals, SignInCard } from '@skydrop/ui/app/sign-in';
import { apiOrigin } from '@/lib/api-origin';
import { LoginForm } from './_components/login-form';

/**
 * Login entry. If the visitor already has a valid __Host-sellerRefresh
 * cookie, skip the form and redirect to the dashboard — saves a
 * roundtrip for already-authed sellers who bookmarked /login.
 *
 * The brand line ("Skydrop" + "client portal"), the backdrop and the
 * theme switch belong to the layout's `SignInFrame`; this page renders
 * only its card. It must NOT repeat the wordmark — the login spec
 * requires "Skydrop" exactly once on the page.
 *
 * The way OUT to the other consoles is `OtherPortals`, which renders
 * every console except this one from the shared directory in
 * `@skydrop/ui/app/sign-in`. It replaced a single hand-written link to
 * the store portal: the four consoles look near-identical and only the
 * hostname tells them apart, so somebody who bookmarked the wrong one
 * or was forwarded a colleague's link meets a form that will never
 * accept them and says "invalid credentials" — true and useless. One
 * link was not enough, because an associate who landed here could
 * reach the store portal and from there only come back; the shared list
 * means no console can be left off this page by omission.
 */
export default async function LoginPage(): Promise<ReactElement> {
  const jar = await cookies();
  const cookieValue = jar.get('__Host-sellerRefresh')?.value ?? '';
  if (cookieValue) {
    const result = await resolveSellerSsrIdentity({
      apiOrigin: apiOrigin(),
      identityKind: 'seller',
      cookieValue,
    });
    if (result.state === 'authenticated') {
      redirect('/dashboard');
    }
  }

  return (
    <SignInCard
      title="Sign in"
      note="Use the credentials from your Skydrop invitation."
      footer={
        <>
          <p>
            Forgot your password? <a href="/password-reset">Reset it</a>
          </p>
          <p>
            No account yet? <a href="/sign-up">How to get one</a>
          </p>
          <OtherPortals self="client" />
        </>
      }
    >
      <LoginForm />
    </SignInCard>
  );
}
