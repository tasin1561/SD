import { Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { courierActor } from '../../courier-shared/services/courier-credential.service';
import { ShiprocketHttpService } from './shiprocket-http.service';

export const ACTION_SHIPROCKET_API_PROBED = 'courier.shiprocket_api.probed';

/**
 * The endpoints asked, in order.
 *
 * Everything money-shaped their published Postman collection carries
 * (apidocs.shiprocket.in, collection 8407119/SzYW1zB2 — 93 requests, 31
 * of them GET), plus the names a wallet ledger would plausibly live
 * under if they ever add one. A 404 is an ANSWER, which is why the
 * guesses are here at all: "we asked and they do not have it" is the
 * finding, and next year somebody will want to know whether it was
 * asked.
 *
 * GET ONLY, and that is structural rather than a habit — `probe()` has
 * no way to send anything else. A read that 404s is information; a write
 * that succeeds against a courier cannot be taken back.
 */
export const SHIPROCKET_PROBE_PATHS: readonly string[] = [
  // Documented, and the two that actually answer.
  '/v1/external/account/details/wallet-balance',
  '/v1/external/account/details/statement',
  '/v1/external/billing/discrepancy',
  '/v1/external/settings/company/pickup',
  // Not documented. Asked because a passbook has to be somewhere.
  '/v1/external/account/details',
  '/v1/external/account/details/passbook',
  '/v1/external/account/details/transactions',
  '/v1/external/account/details/ledger',
  '/v1/external/wallet/balance',
  '/v1/external/wallet/transactions',
  '/v1/external/wallet/statement',
  '/v1/external/wallet/passbook',
  '/v1/external/wallet/ledger',
  '/v1/external/statement',
  '/v1/external/passbook',
  '/v1/external/ledger',
  '/v1/external/transactions',
  '/v1/external/billing',
  '/v1/external/billing/invoices',
  '/v1/external/billing/statement',
  '/v1/external/billing/ledger',
  '/v1/external/invoices',
  '/v1/external/payments',
  '/v1/external/payments/statement',
  '/v1/external/remittance',
  '/v1/external/cod-remittance',
];

/**
 * The four parameter sets tried against whatever endpoint returns rows.
 *
 * Their statement docs name `page`, `per_page`, `from` and `to`; the
 * others are the shapes an undocumented sibling would take. Tried
 * because "the endpoint is empty" and "the endpoint needs a date range
 * we did not send" look identical from one call, and it was the second
 * reading that kept this question open for weeks.
 */
const ROW_QUERIES: readonly {
  readonly label: string;
  readonly query: Record<string, string | number>;
}[] = [
  { label: 'bare', query: {} },
  { label: 'paged', query: { page: 1, per_page: 100 } },
  { label: 'documented-range', query: { page: 1, per_page: 100, from: '', to: '' } },
  { label: 'start-end-range', query: { per_page: 100, start_date: '', end_date: '' } },
];

/** How many rows of a list are described. Shapes, never money. */
const SAMPLE_ROWS = 2;

export interface ShiprocketProbeAttempt {
  readonly label: string;
  readonly query: Record<string, string | number>;
  /** Null when the call threw before a status could be read. */
  readonly rows: number | null;
  /** True when every field of every row was empty — a shaped placeholder. */
  readonly allRowsEmpty: boolean | null;
  readonly error: string | null;
}

export interface ShiprocketProbeEndpoint {
  readonly path: string;
  readonly status: 'ANSWERED' | 'NOT_FOUND' | 'REFUSED' | 'FAILED';
  /** Their own words when they refused, truncated. */
  readonly detail: string | null;
  /** The keys of the body, one level deep — never the values. */
  readonly shape: string | null;
  /** Present only where the body carried a list. */
  readonly attempts: readonly ShiprocketProbeAttempt[];
  /** The field names of the first rows, so a reader can judge usefulness. */
  readonly rowFields: readonly string[];
}

export interface ShiprocketApiProbeFindings {
  readonly runId: string;
  readonly courierCode: 'shiprocket';
  readonly requestedByStaffId: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly courierAccountId: string | null;
  readonly accountLabel: string | null;
  readonly stubMode: boolean;
  readonly note: string | null;
  readonly endpoints: readonly ShiprocketProbeEndpoint[];
  /** The one question this run exists to answer, answered. */
  readonly verdict: string;
}

/** A body's own key names, one level in. Never a value: a statement row
 *  carries our balance and this lands in an audit row. */
function shapeOf(body: unknown, depth = 0): string {
  if (body === null) return 'null';
  if (Array.isArray(body)) {
    return depth > 1
      ? `array(${body.length})`
      : `array(${body.length})<${body.length > 0 ? shapeOf(body[0], depth + 1) : ''}>`;
  }
  if (typeof body === 'object') {
    const keys = Object.keys(body as Record<string, unknown>);
    if (depth > 1) return `object(${keys.length})`;
    const rec = body as Record<string, unknown>;
    return `{${keys
      .slice(0, 30)
      .map((k) => `${k}:${shapeOf(rec[k], depth + 1)}`)
      .join(',')}}`;
  }
  return typeof body;
}

/** The list inside a body, wherever they put it. */
function listIn(body: unknown): readonly unknown[] | null {
  if (Array.isArray(body)) return body;
  if (body === null || typeof body !== 'object') return null;
  const data = (body as Record<string, unknown>)['data'];
  if (Array.isArray(data)) return data;
  if (data !== null && typeof data === 'object') {
    const inner = (data as Record<string, unknown>)['data'];
    if (Array.isArray(inner)) return inner;
  }
  return null;
}

/**
 * Whether every row is a SHAPED PLACEHOLDER — the right fields, no
 * movement.
 *
 * This is the whole reason the probe describes rows at all.
 * `/account/details/statement` answers 200 with ONE row carrying the
 * current wallet balance and nothing else — no id, no date, no amount
 * moved — and Shiprocket's own published sample shows exactly that. A
 * probe that counted rows would have reported "1" for this and "1" for
 * a real ledger of one transaction, which is how a single reading in
 * September 2026 ("their statement endpoint returns nothing") stayed
 * unchecked for weeks while being both true and useless.
 *
 * So the test is not "is every field empty" — the balance is a real
 * value — it is "does any row describe a MOVEMENT": something with an
 * identity, a time and an amount. A row with none of the three is not a
 * transaction whatever else it carries.
 */
const MOVEMENT_FIELDS = /(transaction|txn).*id|^id$|created_at|date|debit|credit|amount$/i;

export function everyRowEmpty(rows: readonly unknown[]): boolean {
  if (rows.length === 0) return false;
  return rows.every((r) => {
    if (r === null || typeof r !== 'object') return false;
    const entries = Object.entries(r as Record<string, unknown>);
    const movement = entries.filter(([k]) => MOVEMENT_FIELDS.test(k) && !/^balance/i.test(k));
    // No movement-shaped field at all: not a ledger row, and not this
    // function's business to judge.
    if (movement.length === 0) return false;
    return movement.every(
      ([, v]) => v === null || v === 0 || (typeof v === 'string' && v.trim() === ''),
    );
  });
}

function rowFieldsOf(rows: readonly unknown[]): readonly string[] {
  const out = new Set<string>();
  for (const r of rows.slice(0, SAMPLE_ROWS)) {
    if (r !== null && typeof r === 'object') {
      for (const k of Object.keys(r as Record<string, unknown>)) out.add(k);
    }
  }
  return [...out];
}

/** Their 404 body, told apart from a network failure or a refusal. */
function classify(message: string): { status: 'NOT_FOUND' | 'REFUSED' | 'FAILED' } {
  if (/ failed \(404\)/.test(message)) return { status: 'NOT_FOUND' };
  if (/ failed \(4\d\d\)/.test(message)) return { status: 'REFUSED' };
  return { status: 'FAILED' };
}

/**
 * A READ-ONLY look at what Shiprocket's public API will tell us about
 * the wallet.
 *
 * ── WHY ──────────────────────────────────────────────────────────────
 * A parcel's real cost is the NET of its wallet transactions (COST-1),
 * and Shiprocket's come off their seller PANEL through a browser in
 * Bangalore (COST-2) because a note from 2026-09-11 said their statement
 * endpoint "returns nothing". That is the most expensive sentence in the
 * Shiprocket integration — it is what keeps a nightly money job
 * depending on somebody else's web app holding still — and it was a
 * single reading, never re-checked. This run re-asks, from the same
 * credential path the adapter uses, and records what came back so the
 * answer can be compared against the next one rather than remembered.
 *
 * Modelled on `DelhiveryBillingProbeService` (COST-3): operator
 * triggered, audited, read-only, findings to one `audit_logs` row. Two
 * differences, both because this one is HTTP rather than a browser — it
 * runs in the API process (no queue, no worker, no Chromium, so nothing
 * can collide with a nightly login) and it returns its findings to the
 * caller directly instead of leaving them to be polled.
 *
 * ── WHAT IT WILL NOT DO ──────────────────────────────────────────────
 * GET only. `probe()` cannot express anything else: every call goes
 * through one private method that hard-codes the method. Exploring a
 * vendor's API with a POST is how a run of reconnaissance books a
 * parcel.
 */
@Injectable()
export class ShiprocketApiProbeService {
  private readonly logger = new Logger(ShiprocketApiProbeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: ShiprocketHttpService,
    private readonly audit: AuditLogService,
  ) {}

  async probe(input: {
    readonly requestedByStaffId?: string | null;
    readonly courierAccountId?: string | null;
  }): Promise<ShiprocketApiProbeFindings> {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const stubMode = await this.http.isStubMode();

    const account =
      input.courierAccountId !== undefined && input.courierAccountId !== null
        ? await this.prisma.client.courierAccount.findFirst({
            where: { id: input.courierAccountId, deletedAt: null },
            select: { id: true, label: true },
          })
        : await this.prisma.client.courierAccount.findFirst({
            where: {
              courier: { code: 'shiprocket' },
              isActive: true,
              deletedAt: null,
              credentialId: { not: null },
            },
            select: { id: true, label: true },
            orderBy: { createdAt: 'asc' },
          });

    if (stubMode || account === null) {
      // A stub would answer from a table inside this process. Reporting
      // that as "what their API exposes" would look exactly like proof.
      return this.finish(
        runId,
        startedAt,
        input.requestedByStaffId ?? null,
        account?.id ?? null,
        account?.label ?? null,
        stubMode,
        stubMode
          ? 'Shiprocket is in stub mode — nothing left this process, so nothing was learned about their API.'
          : 'No active Shiprocket account with a stored credential, so there was nothing to sign in as.',
        [],
        'NOT ASKED',
      );
    }

    const actor = courierActor.runner('shiprocket-api-probe', runId);
    const endpoints: ShiprocketProbeEndpoint[] = [];
    for (const path of SHIPROCKET_PROBE_PATHS) {
      endpoints.push(await this.ask(path, account.id, actor));
    }

    return this.finish(
      runId,
      startedAt,
      input.requestedByStaffId ?? null,
      account.id,
      account.label,
      false,
      null,
      endpoints,
      verdictFor(endpoints),
    );
  }

  /** The only way this service talks to Shiprocket. GET, always. */
  private async ask(
    path: string,
    courierAccountId: string,
    actor: ReturnType<typeof courierActor.runner>,
  ): Promise<ShiprocketProbeEndpoint> {
    let body: unknown;
    try {
      body = await this.http.request<unknown>({
        method: 'GET',
        path,
        actor,
        courierAccountId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        path,
        ...classify(message),
        detail: message.slice(0, 300),
        shape: null,
        attempts: [],
        rowFields: [],
      };
    }

    const rows = listIn(body);
    if (rows === null) {
      return {
        path,
        status: 'ANSWERED',
        detail: null,
        shape: shapeOf(body).slice(0, 600),
        attempts: [],
        rowFields: [],
      };
    }

    // It carried a list. Ask again with the documented parameters before
    // concluding anything about how much of a ledger it holds.
    const attempts: ShiprocketProbeAttempt[] = [
      {
        label: 'bare',
        query: {},
        rows: rows.length,
        allRowsEmpty: everyRowEmpty(rows),
        error: null,
      },
    ];
    const to = new Date();
    const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
    const iso = (d: Date): string => d.toISOString().split('T')[0] ?? '';
    for (const q of ROW_QUERIES.slice(1)) {
      const query: Record<string, string | number> = { ...q.query };
      if ('from' in query) {
        query['from'] = iso(from);
        query['to'] = iso(to);
      }
      if ('start_date' in query) {
        query['start_date'] = iso(from);
        query['end_date'] = iso(to);
      }
      try {
        const again = await this.http.request<unknown>({
          method: 'GET',
          path,
          query,
          actor,
          courierAccountId,
        });
        const list = listIn(again) ?? [];
        attempts.push({
          label: q.label,
          query,
          rows: list.length,
          allRowsEmpty: everyRowEmpty(list),
          error: null,
        });
      } catch (err) {
        attempts.push({
          label: q.label,
          query,
          rows: null,
          allRowsEmpty: null,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        });
      }
    }

    return {
      path,
      status: 'ANSWERED',
      detail: null,
      shape: shapeOf(body).slice(0, 600),
      attempts,
      rowFields: rowFieldsOf(rows),
    };
  }

  private async finish(
    runId: string,
    startedAt: string,
    requestedByStaffId: string | null,
    courierAccountId: string | null,
    accountLabel: string | null,
    stubMode: boolean,
    note: string | null,
    endpoints: readonly ShiprocketProbeEndpoint[],
    verdict: string,
  ): Promise<ShiprocketApiProbeFindings> {
    const findings: ShiprocketApiProbeFindings = {
      runId,
      courierCode: 'shiprocket',
      requestedByStaffId,
      startedAt,
      finishedAt: new Date().toISOString(),
      courierAccountId,
      accountLabel,
      stubMode,
      note,
      endpoints,
      verdict,
    };
    await this.audit.log({
      actorType: requestedByStaffId === null ? ActorType.SYSTEM : ActorType.STAFF,
      actorId: requestedByStaffId,
      ...(requestedByStaffId === null ? {} : { staffUserId: requestedByStaffId }),
      action: ACTION_SHIPROCKET_API_PROBED,
      entityType: 'courier',
      // A uuid column (rule 6); the courier and the run go in metadata.
      entityId: null,
      severity: 'LOW',
      metadata: { ...findings },
    });
    this.logger.log({ runId, verdict, endpoints: endpoints.length }, 'Shiprocket API probe done');
    return findings;
  }
}

/**
 * The one sentence somebody reads.
 *
 * A probe whose output is thirty rows of JSON gets skimmed, and the
 * question it exists to answer ("can the wallet come off the browser?")
 * is a yes or a no.
 */
export function verdictFor(endpoints: readonly ShiprocketProbeEndpoint[]): string {
  const withRows = endpoints.filter((e) => e.attempts.length > 0);
  const real = withRows.filter((e) =>
    e.attempts.some((a) => (a.rows ?? 0) > 0 && a.allRowsEmpty === false),
  );
  if (real.length > 0) {
    return (
      `${real.map((e) => e.path).join(', ')} returned rows with content — re-read COST-2 before ` +
      'changing anything: a ledger read from here must still go through WalletImportService.'
    );
  }
  const placeholder = withRows.filter((e) => e.attempts.some((a) => a.allRowsEmpty === true));
  if (placeholder.length > 0) {
    return (
      `No wallet ledger on the API. ${placeholder.map((e) => e.path).join(', ')} answered with a ` +
      'SHAPED PLACEHOLDER — the right fields, no content — which is not the same as empty and ' +
      'would import as a transaction. The panel read (COST-2) stays.'
    );
  }
  return 'No wallet ledger on the API: nothing asked returned a list with rows. The panel read (COST-2) stays.';
}
