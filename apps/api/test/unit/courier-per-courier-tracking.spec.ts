import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The tracking and NDR half of the 2026-09-19 courier audit.
 *
 * These are SOURCE checks rather than behavioural ones, and that is the
 * point: the bugs were a module-level `const COURIER_CODE = 'delhivery'`
 * stamped on rows written for every courier, and a literal in an audit
 * row. Neither throws, neither fails a behavioural test, and both are
 * invisible until somebody reads a row and finds it names the wrong
 * company. A structural check is the only thing that sees them.
 */

const MODULES = join(__dirname, '../../src/modules');

function read(rel: string): string {
  return readFileSync(join(MODULES, rel), 'utf8');
}

/** Comments explain the literals these fixes removed; strip them. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the tracking poll stamps the courier that CARRIED the parcel', () => {
  const src = code(read('tracking-poll/services/tracking-poll.service.ts'));

  /**
   * THE BUG. A module-level `COURIER_CODE = 'delhivery'` was written to
   * `tracking_events.courierCode` on every row the poll appended — for
   * every courier it polled — and quoted in the transition reason. The
   * poll is a fan-out over COURIER_TRACKING_SOURCES, so a Shiprocket
   * parcel's scans were stored saying Delhivery had scanned them, and
   * the order's timeline said "via delhivery". The webhook processor
   * and manual tracking both stamp the real courier, so the two halves
   * of one parcel's history disagreed.
   */
  it('has no module-level courier constant left', () => {
    expect(src).not.toMatch(/(?:const|let)\s+\w+\s*=\s*'delhivery'/);
  });

  it('takes the courier from the SOURCE being polled', () => {
    // Every appended row and the transition reason read it off `source`,
    // which is the only thing in the loop that knows.
    expect(src).toMatch(/courierCode: source\.courierCode/);
    expect(src).toMatch(/via \$\{source\.courierCode\}/);
  });

  it('refuses an unattributed scan rather than normalising it as Delhivery', () => {
    // The lookup fell back to `this.sources[0]`. A wrong normalisation
    // is a wrong STATUS, not a wrong label — their vocabularies overlap
    // enough to map to something plausible.
    expect(src).not.toMatch(/normalizerByAwb\.get\(awb\)\s*\?\?\s*this\.sources\[0\]/);
    expect(src).toMatch(/NO_TRACKING_SOURCE_FOR_AWB/);
  });
});

describe('the webhook processor refuses a courier it has no source for', () => {
  const src = code(read('tracking-ingestion/services/webhook-processor.service.ts'));

  it('no longer falls back to Delhivery’s adapter', () => {
    // It injected `DelhiveryTrackingService` purely as that fallback, so
    // the dependency going with the fix is the evidence.
    expect(src).not.toMatch(/courierDelhivery/);
    expect(src).not.toMatch(/DelhiveryTrackingService/);
  });

  it('ignores the payload BY NAME instead', () => {
    expect(src).toMatch(/NO_TRACKING_SOURCE/);
  });
});

describe('the NDR alert names the courier it is actually about', () => {
  const src = code(read('courier-ndr-runner/services/ndr-reconciliation.service.ts'));

  /**
   * THE BUG. A CRITICAL audit row carrying `courierCode: 'delhivery'`
   * literally — the one signal that a courier accepts our re-attempt
   * requests and acts on none of them. An alert about Shiprocket would
   * have sent somebody to read Delhivery's panel.
   */
  it('carries no hard-coded courier', () => {
    expect(src).not.toMatch(/courierCode:\s*'delhivery'/);
  });

  it('counts per courier, read off each request’s own parcel', () => {
    // `ndr_action_requests` has no courier column — the shipment is the
    // only thing that knows which company was asked.
    expect(src).toMatch(/shipment:\s*\{\s*select:\s*\{\s*courierCode:\s*true/);
    expect(src).toMatch(/byCourier/);
  });
});

describe('the UPL poller asks only couriers that hand back a handle', () => {
  const src = code(read('courier-ndr-runner/services/ndr-upl-poller.service.ts'));

  /**
   * THE BUG. It queried EVERY SUBMITTED row and put each to Delhivery's
   * `checkStatus`. Shiprocket's NDR is SYNCHRONOUS — the reply is the
   * outcome and there is no UPL — so such a row would be read as "the
   * submit produced no handle", closed FAILED and escalated to a person
   * as a re-attempt the courier ignored. It had worked.
   */
  it('filters the query by courier', () => {
    expect(src).toMatch(/shipment:\s*\{\s*courierCode:\s*\{\s*in:/);
  });

  it('asks the NDR dispatcher which those are, rather than naming one', () => {
    expect(src).toMatch(/pollsOutcome/);
    expect(src).not.toMatch(/(?:const|let)\s+\w+\s*=\s*'delhivery'/);
  });
});

describe('the NDR runner does not spend a courier read on a manual parcel', () => {
  const src = code(read('courier-ndr-runner/services/ndr-runner.service.ts'));

  /**
   * THE BUG. No courier filter, so a MANUAL parcel — a waybill an
   * operator read off a paper docket, with no account behind it — was
   * pulled into the sweep and cost a rate-limited Delhivery tracking
   * read before the dispatcher refused the action by name. The refusal
   * was right; the read was taken from a budget whose exhaustion has
   * the WAF block our whole egress IP.
   */
  it('selects only couriers an NDR action can be asked of', () => {
    expect(src).toMatch(/courierCode:\s*\{\s*in:\s*\[\.\.\.this\.ndr\.adapterCourierCodes\(\)\]/);
    expect(src).toMatch(/isManualCourier:\s*false/);
  });
});

describe('a document is never fetched from a courier that does not hold it', () => {
  const src = code(read('courier-ops/services/courier-shipment-insight.service.ts'));

  /**
   * THE BUG. `document()` resolves the shipment directly rather than
   * through `requireAwb`, so it had no courier guard: everything that
   * was not Shiprocket fell through to DELHIVERY'S document endpoint —
   * including a MANUAL parcel, asking Delhivery for the paperwork of a
   * waybill they never issued.
   */
  it('refuses any courier with no document integration, by name', () => {
    expect(src).toMatch(/shipment\.courierCode !== 'delhivery'/);
    expect(src).toMatch(/placed by hand/);
  });
});

describe('the global courier split is weighted by SETTING, not by courier code', () => {
  const src = code(read('courier-shared/services/courier-distribution.service.ts'));

  /**
   * THE BUG SHAPE. `a.courier.code === 'delhivery' ? share : 100 - share`
   * gives EVERY non-Delhivery account the full remainder, so a third
   * courier silently doubles the share of everyone who is not Delhivery
   * while the setting still claims a two-way split. The split is defined
   * by two named settings; the weight should read those.
   */
  it('weights on which setting named the account', () => {
    expect(src).toMatch(/weight:\s*a\.id === delhiveryId \? share : 100 - share/);
  });
});

describe('ticket handling agrees with the adapters about what software can raise', () => {
  const src = read('ticket-handling/services/ticket-handling.service.ts');

  /**
   * THE BUG. `AUTOMATED_COURIERS = ['delhivery']` contradicted
   * Delhivery's OWN support adapter, which reports `raiseTicket: false`
   * (their MCP is read-only; CUR-20 says support tickets are manual for
   * every courier). Dormant behind a seeded-off switch — which is
   * exactly why it could be wrong for months: the day somebody enabled
   * the switch, Delhivery tickets would have been stamped AUTO and then
   * moved by nobody.
   */
  it('names no courier, because no adapter can raise a ticket', () => {
    expect(code(src)).toMatch(/const AUTOMATED_COURIERS: readonly string\[\] = \[\]/);
  });

  it('keeps the LIST mechanism rather than deleting the concept', () => {
    // The answer is a property of what we have BUILT, not of the
    // courier — so the list is the right shape even while empty.
    expect(src).toMatch(/AUTOMATED_COURIERS\.includes/);
  });
});
