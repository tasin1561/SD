import type { SellerPermissionKey } from './seller-permissions';

/**
 * The RBAC-1 decision, once, for every guard that admits a seller.
 *
 * `SellerJwtGuard` owned this inline until a SECOND way into a seller
 * endpoint appeared — `ApiKeyGuard`, which authenticated a key and then
 * returned true without consulting the handler's declaration at all. Two
 * doors into the same rooms, and only one of them asked whether the
 * caller was allowed in; a controller carrying `@RequireSellerPermissions`
 * would have been enforced for a browser session and waved through for
 * an API key, with nothing failing and nothing to see.
 *
 * So the rule lives here, pure, and both guards read it. Each still
 * audits and throws in its own words, because who was refused and how it
 * is recorded differ between a person and a machine — but *whether* they
 * are refused cannot.
 *
 * The rule itself is unchanged (RBAC-1): self-service short-circuits the
 * gate; otherwise the handler's declaration, else the class's; holding
 * ANY listed key passes; **an endpoint that declares neither is
 * REFUSED** — reads and writes alike — so forgetting the annotation
 * makes a surface unreachable rather than open.
 */
export type SellerAuthorizationVerdict =
  | { readonly kind: 'ALLOW' }
  | { readonly kind: 'ENDPOINT_NOT_AUTHORIZED' }
  | { readonly kind: 'INSUFFICIENT_PERMISSION'; readonly required: readonly string[] };

export function sellerAuthorizationVerdict(input: {
  readonly selfService: boolean;
  readonly required: readonly SellerPermissionKey[] | undefined;
  readonly held: readonly string[];
}): SellerAuthorizationVerdict {
  if (input.selfService) return { kind: 'ALLOW' };
  if (input.required === undefined || input.required.length === 0) {
    return { kind: 'ENDPOINT_NOT_AUTHORIZED' };
  }
  if (input.required.some((perm) => input.held.includes(perm))) return { kind: 'ALLOW' };
  return { kind: 'INSUFFICIENT_PERMISSION', required: [...input.required] };
}

/** The message `ENDPOINT_NOT_AUTHORIZED` carries, in both guards. */
export const ENDPOINT_NOT_AUTHORIZED_MESSAGE =
  'This endpoint declares no permission and is refused by default. ' +
  'Add @RequireSellerPermissions(...) or @SellerSelfService() to it.';
