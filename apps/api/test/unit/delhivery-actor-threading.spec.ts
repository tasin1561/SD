import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every courier call says who asked for it.
 *
 * ── WHY THIS IS A STRUCTURAL TEST ────────────────────────────────────
 * The amended CUR-10 (2026-08-05) turns on one distinction: a courier
 * call is either operator-triggered, or fired by a runner whose write
 * channel an operator enabled. Before the actor was threaded, every
 * decrypt audited as `SYSTEM` with a null id, so the audit log could
 * show THAT a call happened and never which branch it took. An
 * invariant that cannot be evidenced has not really been adopted.
 *
 * The actor parameter is deliberately OPTIONAL — a live courier path
 * should not throw because someone forgot an argument. That safety is
 * exactly what makes a behavioural test useless here: omitting the actor
 * compiles, runs, and returns the right answer. It is only wrong in the
 * audit log, weeks later, when somebody asks which branch fired.
 *
 * So this reads the sources, in the `worker-role.spec.ts` idiom.
 *
 * ── HOW CALL SITES ARE FOUND ─────────────────────────────────────────
 * By the constructor's injected property names, NOT by method name.
 * `.update(`, `.fetch(` and `.cancel(` are also Prisma, and a name-based
 * scan would either drown in false positives or be narrowed until it
 * matched only the lines that already pass.
 */

const SRC = join(__dirname, '../../src/modules');

/** Delhivery capability services. Anything injected from here must be called with an actor. */
const CAPABILITY_CLASS = /^Delhivery(?!Http|RateLimit|WriteGuard)[A-Za-z]*Service$/;

/** Consumers that reach the adapter. A new one must be added here. */
const CONSUMERS = [
  'courier-ops/services/courier-shipment-action.service.ts',
  'courier-ops/services/courier-shipment-insight.service.ts',
  'courier-ops/services/courier-warehouse-registration.service.ts',
  // Pickup, cancel and warehouse registration all reach their courier
  // through the ops dispatcher now, which is where the actor must be
  // threaded. courier-pickup itself no longer talks to a courier.
  'courier-ops/services/courier-ops-dispatch.service.ts',
  'courier-ops/services/courier-margin-report.service.ts',
  // The AWB saga no longer calls a courier itself — multi-courier
  // failover moved that behind the dispatcher, which is now the thing
  // that must thread the actor through to whichever adapter answers.
  'courier-awb/services/courier-awb-dispatch.service.ts',
  // The poller sweeps every courier now, so it holds tracking SOURCES
  // rather than Delhivery's services. The actor is threaded by the
  // Delhivery source, which is where the Delhivery call now lives.
  'courier-delhivery/services/delhivery-tracking-source.service.ts',
  'courier-delhivery/queue/waybill-refill.worker.ts',
  'courier-delhivery/controllers/admin-delhivery-ops.controller.ts',
];

/**
 * Which methods REQUIRE an actor — read off the capability services
 * themselves, as the set of methods declaring an `actor` parameter.
 *
 * This is the load-bearing choice in the whole file. A hand-written list
 * of method names would drift, and requiring an actor from every method
 * is simply wrong: `checkEligibility` (pure NSL logic), `normalizeScan`
 * (pure parsing), `requiresEwaybill` (a predicate) and `stats` (a local
 * DB read) never decrypt anything and have nobody to attribute. Keying
 * on the signature means a NEW networked method brings its call sites
 * under the rule automatically, and a pure one stays out of it — without
 * anyone maintaining a list.
 */
function methodsRequiringActor(): Map<string, Set<string>> {
  const dir = join(SRC, 'courier-delhivery/services');
  const byClass = new Map<string, Set<string>>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.service.ts'))) {
    const src = readFileSync(join(dir, file), 'utf8');
    const cls = /export class ([A-Za-z0-9_]+)/.exec(src)?.[1];
    if (cls === undefined) continue;
    const methods = new Set<string>();
    // Signature = from `async name(` to the `)` that closes its params.
    for (const m of src.matchAll(/\n {2}async ([A-Za-z0-9_]+)\(/g)) {
      let depth = 0;
      let i = m.index + m[0].length - 1;
      for (; i < src.length; i += 1) {
        if (src[i] === '(') depth += 1;
        else if (src[i] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const name = m[1];
      if (name !== undefined && /\bactor\??:/.test(src.slice(m.index, i))) methods.add(name);
    }
    byClass.set(cls, methods);
  }
  return byClass;
}

const ACTOR_METHODS = methodsRequiringActor();

/** Property names bound to a Delhivery capability service, with their class. */
function injectedCapabilityProps(src: string): { prop: string; cls: string }[] {
  const props: { prop: string; cls: string }[] = [];
  const re = /(?:private|public|protected)\s+readonly\s+([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const prop = m[1];
    const cls = m[2];
    if (prop !== undefined && cls !== undefined && CAPABILITY_CLASS.test(cls))
      props.push({ prop, cls });
  }
  return props;
}

/** The argument text of `this.<prop>.<method>(...)`, paren-matched. */
function callArgs(src: string, prop: string): { method: string; args: string }[] {
  const found: { method: string; args: string }[] = [];
  // `this.prop\n  .method(` is a real formatting in this codebase, so the
  // dot may be separated from the property by whitespace.
  const re = new RegExp(`this\\.${prop}\\s*\\.\\s*([A-Za-z0-9_]+)\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const method = m[1] ?? '';
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i + 1;
    for (; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    found.push({ method, args: src.slice(start, i) });
  }
  return found;
}

describe('every Delhivery call passes an actor (structural)', () => {
  it('finds the consumers it claims to check', () => {
    // A rename that emptied this list would otherwise pass silently.
    expect(CONSUMERS.length).toBeGreaterThan(5);
    for (const rel of CONSUMERS) {
      expect(() => readFileSync(join(SRC, rel), 'utf8')).not.toThrow();
    }
  });

  for (const rel of CONSUMERS) {
    const src = readFileSync(join(SRC, rel), 'utf8');
    const props = injectedCapabilityProps(src);

    it(`${rel} injects at least one capability service`, () => {
      // If this fails the file no longer belongs in CONSUMERS, or the
      // injection style changed and the scan below is finding nothing.
      expect(props.length).toBeGreaterThan(0);
    });

    for (const { prop, cls } of props) {
      const required = ACTOR_METHODS.get(cls) ?? new Set<string>();
      for (const { method, args } of callArgs(src, prop)) {
        if (!required.has(method)) continue; // pure logic — nothing to attribute
        it(`${rel}: this.${prop}.${method}() passes an actor`, () => {
          expect(args).toMatch(/courierActor\.(operator|runner|webhook)\(|(^|[\s,({])actor\b/);
        });
      }
    }
  }
});

describe('the http choke point forwards the actor', () => {
  const dir = join(SRC, 'courier-delhivery/services');
  const files = readdirSync(dir).filter((f) => f.endsWith('.service.ts'));

  it('finds the service files it claims to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const src = readFileSync(join(dir, file), 'utf8');
    // Only files that actually issue a request.
    if (!src.includes('this.http.request')) continue;

    it(`${file}: every request() carries an actor`, () => {
      // The single place where forgetting is invisible: request() would
      // happily default to an unattributed SYSTEM decrypt.
      for (const m of src.matchAll(/this\.http\.request/g)) {
        const open = src.indexOf('({', m.index);
        expect(src.slice(open, open + 400)).toMatch(/\bactor,/);
      }
    });
  }
});
