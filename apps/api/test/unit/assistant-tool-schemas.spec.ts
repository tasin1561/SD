import { fakeRegistry } from '../helpers/assistant-fixtures';
import { buildAssistantTools } from '../../src/modules/assistant/tools/assistant-tools';
import { fakeDeps } from '../helpers/assistant-fixtures';

/**
 * The model must be STRUCTURALLY unable to choose whose data it reads, so
 * no tool may take an owner or tenant id as input. If somebody adds
 * `sellerId` to a schema "to make a lookup easier", this goes red.
 */
const OWNER_ID =
  /(seller|store|staff|storeuser|store_user|associate|owner|tenant|user|account|company|merchant|client)[_-]?id$/i;
const OWNERISH = /^(id|ids|uuid)$/i;

describe('no tool input schema carries an owner or tenant id', () => {
  const tools = fakeRegistry().all();

  it('finds the tools (a walker over nothing would pass everything)', () => {
    expect(tools.length).toBeGreaterThanOrEqual(9);
  });

  it.each(tools.map((t) => [t.name, t] as const))('%s', (_name, tool) => {
    for (const prop of Object.keys(tool.inputSchema.properties)) {
      expect(prop).not.toMatch(OWNER_ID);
      expect(prop).not.toMatch(OWNERISH);
    }
    for (const req of tool.inputSchema.required) {
      expect(Object.keys(tool.inputSchema.properties)).toContain(req);
    }
  });

  it('every schema is closed (additionalProperties: false), type object', () => {
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('every tool is sent to the API as strict:true with a closed schema', () => {
    const params = fakeRegistry().toolParams({
      audience: 'SELLER',
      userId: 'u',
      sellerId: 's',
      storeId: null,
      orderScope: null,
      permissions: ['orders.view', 'wallet.view'],
      impersonatingStaffId: null,
    });
    expect(params.length).toBeGreaterThan(0);
    for (const p of params) {
      expect(p.strict).toBe(true);
      expect((p.input_schema as { additionalProperties?: unknown }).additionalProperties).toBe(
        false,
      );
    }
  });

  it('the detector itself fires on a schema that has a tenant id (guard against a vacuous test)', () => {
    const bad = buildAssistantTools(fakeDeps())[0]!;
    const smuggled = {
      ...bad.inputSchema.properties,
      sellerId: { type: 'string' as const, description: 'x' },
    };
    expect(Object.keys(smuggled).some((k) => OWNER_ID.test(k))).toBe(true);
    for (const k of ['storeId', 'staffId', 'storeUserId', 'associateId', 'seller_id']) {
      expect(k).toMatch(OWNER_ID);
    }
  });
});
