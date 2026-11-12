import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { runImpersonated } from '../../src/common/impersonation/impersonation-context';
import {
  scopeFromSeller,
  scopeFromStaff,
  scopeFromStoreUser,
} from '../../src/modules/assistant/assistant-scope';
import { streamAnswer } from '../../src/modules/assistant/assistant-sse';
import { validateToolInput } from '../../src/modules/assistant/assistant-input';
import { ToolError } from '../../src/modules/assistant/assistant.types';

const seller = {
  id: 'seller-1',
  userId: 'seller-user-1',
  permissions: ['orders.view'],
  email: 'e',
  status: 'ACTIVE',
  emailVerifiedAt: null,
  jti: null,
  roleKey: 'k',
  roleName: 'n',
  roleKeys: ['k'],
  roleNames: ['n'],
  fullName: 'F',
};
const storeUser = (orderScope: 'OWN' | 'ALL') => ({
  id: 'su-1',
  storeId: 'store-1',
  sellerId: 'seller-1',
  email: 'e',
  fullName: 'F',
  emailVerifiedAt: null,
  jti: null,
  roleKey: 'k',
  roleName: 'n',
  roleKeys: ['k'],
  roleNames: ['n'],
  permissions: ['orders.view'],
  orderScope,
  ordersPausedAt: null,
});

describe('CallerScope comes from the authenticated identity', () => {
  it('seller: company id and user id from the guard’s identity', () => {
    expect(scopeFromSeller(seller as never)).toMatchObject({
      audience: 'SELLER',
      userId: 'seller-user-1',
      sellerId: 'seller-1',
      storeId: null,
      impersonatingStaffId: null,
    });
  });

  it('inside a support session the scope is the impersonated seller’s and records the staff member', () => {
    const s = runImpersonated(
      {
        sessionId: 'sess',
        staffUserId: 'staff-9',
        subject: { kind: 'SELLER', id: 'seller-1' },
        mayWrite: true,
      },
      () => scopeFromSeller(seller as never),
    );
    expect(s).toMatchObject({
      audience: 'SELLER',
      sellerId: 'seller-1',
      userId: 'seller-user-1',
      impersonatingStaffId: 'staff-9',
    });
  });

  it('store user: ALL scope is STORE, OWN scope is ASSOCIATE (ASSOC-1), and the store comes from the token', () => {
    expect(scopeFromStoreUser(storeUser('ALL') as never)).toMatchObject({
      audience: 'STORE',
      storeId: 'store-1',
      orderScope: 'ALL',
    });
    expect(scopeFromStoreUser(storeUser('OWN') as never)).toMatchObject({
      audience: 'ASSOCIATE',
      storeId: 'store-1',
      orderScope: 'OWN',
    });
  });

  it('staff: no tenant', () => {
    expect(scopeFromStaff({ id: 'st-1', permissions: ['orders.view'] } as never)).toMatchObject({
      audience: 'STAFF',
      userId: 'st-1',
      sellerId: null,
      storeId: null,
    });
  });
});

describe('tool input validation', () => {
  const schema = {
    type: 'object',
    required: ['identifier'],
    additionalProperties: false,
    properties: {
      identifier: { type: 'string', description: 'd', minLength: 3, maxLength: 5 },
      limit: { type: 'integer', description: 'd', minimum: 1, maximum: 10 },
    },
  } as const;
  const bad = (v: unknown) => () => validateToolInput(schema, v);
  it('accepts valid input and trims', () => {
    expect(validateToolInput(schema, { identifier: ' abcd ', limit: 3 })).toEqual({
      identifier: 'abcd',
      limit: 3,
    });
  });
  it.each([
    [null],
    [[]],
    [{}],
    [{ identifier: 7 }],
    [{ identifier: 'ab' }],
    [{ identifier: 'abcdef' }],
    [{ identifier: 'abc', limit: 0 }],
    [{ identifier: 'abc', limit: 11 }],
    [{ identifier: 'abc', limit: 1.5 }],
    [{ identifier: 'abc', sellerId: 'x' }],
  ])('rejects %j', (v) => {
    expect(bad(v)).toThrow(ToolError);
  });
});

describe('SSE framing', () => {
  it('writes text/event-stream with one JSON event per data: frame and always ends the response', async () => {
    const written: string[] = [];
    const headers: Record<string, string> = {};
    const res = Object.assign(new EventEmitter(), {
      writableEnded: false,
      destroyed: false,
      status: () => res,
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      flushHeaders: () => undefined,
      write: (c: string) => {
        written.push(c);
        return true;
      },
      end: () => {
        res.writableEnded = true;
      },
    });
    await streamAnswer(res as never, async (emit) => {
      emit({ type: 'text', delta: 'hi' });
      emit({ type: 'done', conversationId: 'c' });
    });
    expect(headers['Content-Type']).toMatch(/^text\/event-stream/);
    expect(headers['X-Accel-Buffering']).toBe('no');
    expect(written).toEqual([
      'data: {"type":"text","delta":"hi"}\n\n',
      'data: {"type":"done","conversationId":"c"}\n\n',
    ]);
    expect(res.writableEnded).toBe(true);
  });
});

describe('the assistant is READ-ONLY (phase A)', () => {
  const dir = join(__dirname, '../../src/modules/assistant');
  // `knowledge/generated/` is DATA (help text quoted from the docs), not code:
  // it legitimately contains words like transitionStatus in prose. It has no
  // imports and nothing executes from it, so it is not scanned for calls.
  const sources = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? e.name === 'generated'
          ? []
          : sources(join(d, e.name))
        : e.name.endsWith('.ts')
          ? [join(d, e.name)]
          : [],
    );

  it('no assistant source calls a write on another domain’s service', () => {
    // The assistant writes only its own four tables (via AssistantStoreService).
    const forbidden =
      /\b(transitionStatus|forceMutate|cancelOrder|discardDraft|\.submit\(|requestWithdrawal|credit\(|debit\(|\.postEntry|StockMutationService|WalletWrite|recompute)/;
    const offenders = sources(dir)
      .filter((f) => !f.endsWith('assistant-store.service.ts'))
      .filter((f) => forbidden.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(dir.length));
    expect(offenders).toEqual([]);
  });

  it('only the store service touches prisma', () => {
    const offenders = sources(dir)
      .filter((f) => !f.endsWith('assistant-store.service.ts'))
      .filter((f) => /PrismaService|prisma\.client/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(dir.length));
    expect(offenders).toEqual([]);
  });

  it('messages are append-only: the store has no message update or delete', () => {
    const src = readFileSync(join(dir, 'services/assistant-store.service.ts'), 'utf8');
    expect(src).not.toMatch(/assistantMessage\.(update|updateMany|delete|deleteMany|upsert)/);
  });

  it('the API key is read only by the env service and the gateway, and never logged', () => {
    const offenders = sources(dir)
      .filter((f) =>
        /anthropicApiKey|ANTHROPIC_API_KEY/.test(
          readFileSync(f, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, ''),
        ),
      )
      .map((f) => f.slice(dir.length));
    expect(offenders).toEqual(['/services/assistant-model-gateway.ts']);
    expect(readFileSync(join(dir, 'services/assistant-model-gateway.ts'), 'utf8')).not.toMatch(
      /(log|warn|error)\([^)]*anthropicApiKey/,
    );
  });
});
