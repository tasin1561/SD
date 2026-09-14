import { redirect } from 'next/navigation';

/**
 * Root index → redirect into the authed area. The (authed) layout
 * resolves identity via SSR cookie→/me; on 401 it redirects to
 * /login. So this is just the entry shim.
 */
export default function HomePage(): never {
  redirect('/dashboard');
}
