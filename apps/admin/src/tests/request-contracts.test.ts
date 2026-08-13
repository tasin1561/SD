import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Client request shapes must name the fields the server DTO declares.
 *
 * `apps/api` runs `forbidNonWhitelisted: true`. One wrong field name is
 * not a warning, it is a 400 on every call — and because the failure is
 * uniform, the feature simply never works rather than working oddly.
 *
 * This has now bitten three times:
 *   - PlaceManualAwbRequest sent `trackingUrl`; the DTO wants
 *     `serviceType`. Latent — nothing called it.
 *   - UpdateSellerStatusRequest sent `targetStatus` + `reason`; the DTO
 *     wants `newStatus` + `reasonNote`. NOT latent — every seller
 *     suspend and reapprove 400'd in production, confirmed against the
 *     live API.
 *   - The stock-transfer hook sent `description`; the DTO wants
 *     `reason`. Worse than a 400: blank was dropped, so the note was
 *     silently lost on the happy path and only failed when filled in.
 *
 * Each was found by hand. This pins the ones we know so they cannot
 * regress, and the shape of the check generalises to the next one.
 */

const R = (p: string): string => readFileSync(join(__dirname, p), 'utf8');

/** Property names a class-validator DTO declares (`foo!: T` / `foo?: T`). */
function dtoFields(src: string, className: string): string[] {
  const from = src.indexOf(`class ${className}`);
  if (from === -1) throw new Error(`DTO ${className} not found`);
  // Stop at the next class so a second DTO in the file is not absorbed.
  const nextClass = src.indexOf('class ', from + 6);
  const block = src.slice(from, nextClass === -1 ? undefined : nextClass);
  return Array.from(
    block.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)[?!]:/gm),
    (m) => m[1] as string,
  ).sort();
}

/** Field names an exported TS interface declares. */
function ifaceFields(src: string, name: string): string[] {
  const from = src.indexOf(`interface ${name}`);
  if (from === -1) throw new Error(`interface ${name} not found`);
  const block = src.slice(from, src.indexOf('}', from));
  return Array.from(
    block.matchAll(/readonly ([a-zA-Z][a-zA-Z0-9]*)\??:/g),
    (m) => m[1] as string,
  ).sort();
}

const CASES: ReadonlyArray<{
  readonly label: string;
  readonly clientFile: string;
  readonly iface: string;
  readonly dtoFile: string;
  readonly dto: string;
}> = [
  {
    label: 'seller suspend / reapprove',
    clientFile: '../../../../packages/api-client/src/endpoints/admin-sellers.ts',
    iface: 'UpdateSellerStatusRequest',
    dtoFile: '../../../api/src/modules/admin-seller/dto/update-status.dto.ts',
    dto: 'UpdateSellerStatusDto',
  },
  {
    label: 'manual courier placement',
    clientFile: '../../../../packages/api-client/src/endpoints/admin-warehouse.ts',
    iface: 'PlaceManualAwbRequest',
    dtoFile: '../../../api/src/modules/courier-manual-placement/dto/manual-placement.dto.ts',
    dto: 'PlaceManualAwbDto',
  },
];

describe('client request types name exactly the server DTO fields', () => {
  it.each(CASES)('$label', ({ clientFile, iface, dtoFile, dto }) => {
    const client = ifaceFields(R(clientFile), iface);
    const server = dtoFields(R(dtoFile), dto);
    expect(server.length).toBeGreaterThan(0);
    expect(client).toEqual(server);
  });
});

describe('the specific field names that were wrong', () => {
  it('seller status sends newStatus / reasonNote, never targetStatus / reason', () => {
    const caller = R('../app/(authed)/sellers/_components/status-action-panel.tsx');
    expect(caller).toContain('newStatus: intent');
    expect(caller).toContain('reasonNote:');
    expect(caller).not.toMatch(/targetStatus:/);
  });

  it('stock transfer sends reason, not description', () => {
    const caller = R('../app/(authed)/inventory/transfers/_components/transfers-index.tsx');
    // The local form field may still be called description; the PAYLOAD
    // key is what the server validates.
    expect(caller).toMatch(/\{ reason: form\.description\.trim\(\) \}/);
  });

  it('cycle-count sends bin and batch unconditionally and blocks submit without them', () => {
    // RecordCountItemDto requires both — systemQty is held per bin+batch.
    // The form used to label them "Optional" and drop them when blank.
    const caller = R('../app/(authed)/inventory/cycle-counts/_components/cycle-counts-index.tsx');
    expect(caller).toContain('binId: binId.trim(),');
    expect(caller).toContain('batchId: batchId.trim(),');
    expect(caller).toContain("binId.trim() === ''");
    expect(caller).not.toContain('hint="Optional"');
  });
});

describe('every admin API call carries the /api prefix', () => {
  it('ops-hooks builds courier-ops paths under /api', () => {
    // ApiClient's baseUrl is '' and the admin app proxies only /api/*, so
    // a path without the prefix resolves against the Next origin and
    // 404s. Seven courier-ops calls did exactly that. CI's
    // check-frontend-routes.py cannot see it: that script only inspects
    // literals that already start with /api/.
    const src = R('../lib/ops-hooks.ts');

    // Check the PATH BUILDERS, not the call sites. The call sites
    // interpolate `${opsBase(id)}/insight`, so a regex aimed at literals
    // starting with `/` never sees them — which is the same blind spot
    // that let the bug through CI in the first place.
    const builders = Array.from(src.matchAll(/=>\s*`(\/[^`]*)`/g), (m) => m[1] as string);
    expect(builders.length).toBeGreaterThan(0);
    expect(builders.filter((b) => !b.startsWith('/api/'))).toEqual([]);

    // …and the plain literals too.
    const literals = Array.from(
      src.matchAll(/client\.request<[^>]*>\(\s*`?(\/[a-z][^`'"$)]*)/g),
      (m) => m[1] as string,
    );
    expect(literals.filter((l) => !l.startsWith('/api/'))).toEqual([]);
  });
});

/**
 * The RESPONSE half, which is worse.
 *
 * A wrong request field is a 400 — loud, uniform, and the feature
 * visibly does not work. A wrong RESPONSE field name is silent: the read
 * yields `undefined`, TypeScript is satisfied because the declared type
 * says the field is there, and the UI renders a confident wrong answer.
 *
 * `MoveShipmentResult` named three fields the server has never sent
 * (`fromManifestId` / `toManifestId` / `alreadyMoved` against the real
 * `sourceManifestId` / `targetManifestId` / `alreadyOnTarget`). Nothing
 * called it, so nothing noticed — but the moment a caller existed, the
 * idempotent no-op branch would have reported every already-on-target
 * move as a real one.
 */
describe('client response types name the fields the service returns', () => {
  const service = readFileSync(
    join(__dirname, '../../../api/src/modules/warehouse-manifest/services/manifest.service.ts'),
    'utf8',
  );
  const client = R('../../../../packages/api-client/src/endpoints/admin-warehouse.ts');

  it('MoveShipmentResult matches what moveShipment actually returns', () => {
    const move = service.slice(
      service.indexOf('async moveShipment('),
      service.indexOf('async close('),
    );
    // Both return sites — the idempotent one and the real one.
    expect(move).toContain('alreadyOnTarget: true');
    expect(move).toContain('alreadyOnTarget: false');
    expect(move).toContain('sourceManifestId');
    expect(move).toContain('targetManifestId');

    const iface = client.slice(
      client.indexOf('export interface MoveShipmentResult'),
      client.indexOf('export interface MoveShipmentResult') + 600,
    );
    expect(iface).toContain('sourceManifestId');
    expect(iface).toContain('targetManifestId');
    expect(iface).toContain('alreadyOnTarget');
    // The three names that were there and are not on the wire.
    expect(iface).not.toContain('fromManifestId');
    expect(iface).not.toContain('toManifestId');
    expect(iface).not.toContain('alreadyMoved');
  });

  it('the panel reads the field directly, with no cast papering over it', () => {
    // A cast is how a known-wrong type survives: it silences the error
    // at one call site and leaves the interface lying to the next.
    const panel = R('../app/(authed)/warehouse/manifests/_components/move-shipment-panel.tsx');
    expect(panel).toContain('result.alreadyOnTarget');
    expect(panel).not.toContain('as unknown as');
  });
});
