import { redirect } from 'next/navigation';

/**
 * Root index → the orders list. The (authed) layout resolves identity via
 * the SSR cookie→/me path; on 401 it redirects to /login. So this is just
 * the entry shim.
 *
 * An associate lands on the orders they placed rather than on a
 * dashboard: there is no dashboard here, because every figure one would
 * carry is either the store's money or the store's margin.
 */
export default function HomePage(): never {
  redirect('/orders');
}
