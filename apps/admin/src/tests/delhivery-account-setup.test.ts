import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The two things that must be true before a real parcel moves, neither
 * of which had a screen.
 *
 * Production has never made a real write to Delhivery. Both of these are
 * prerequisites for that first parcel, and the second one is the more
 * dangerous: every shipment create sends `pickup_location: { name }` and
 * Delhivery matches it case- and space-sensitively. A warehouse that is
 * not registered — or registered under a name differing by one space —
 * fails EVERY AWB, and the name cannot be changed afterwards.
 *
 * So the assertions here are mostly about the name being treated as the
 * irreversible input it is.
 */

const R = (p: string): string => readFileSync(join(__dirname, p), 'utf8');
const flat = (s: string): string => s.replace(/\s+/g, ' ');

const PANEL = R('../app/(authed)/delhivery/_components/account-setup-panel.tsx');
const INDEX = R('../app/(authed)/delhivery/_components/delhivery-ops-index.tsx');
const HOOKS = R('../lib/ops-hooks.ts');
const DTO = R('../../../api/src/modules/courier-ops/dto/courier-ops.dto.ts');
const CONTROLLER = R(
  '../../../api/src/modules/courier-ops/controllers/admin-courier-network.controller.ts',
);

describe('it is reachable', () => {
  it('the panel is mounted on the Delhivery page', () => {
    expect(INDEX).toContain('<AccountSetupPanel />');
  });
});

describe('the body matches RegisterCourierWarehouseDto', () => {
  const dtoFields = (() => {
    const from = DTO.indexOf('class RegisterCourierWarehouseDto');
    const next = DTO.indexOf('class ', from + 6);
    const block = DTO.slice(from, next === -1 ? undefined : next);
    return new Set(
      Array.from(block.matchAll(/readonly ([a-zA-Z][a-zA-Z0-9]*)[?!]:/g), (m) => m[1] as string),
    );
  })();

  it('every field the client type names is declared by the DTO', () => {
    const from = HOOKS.indexOf('export interface RegisterCourierWarehouseBody');
    const block = HOOKS.slice(from, HOOKS.indexOf('}', from));
    const sent = Array.from(
      block.matchAll(/readonly ([a-zA-Z][a-zA-Z0-9]*)\??:/g),
      (m) => m[1] as string,
    );
    expect(sent.length).toBeGreaterThan(5);
    // forbidNonWhitelisted: an undeclared key is a 400 on every call.
    for (const f of sent) expect(dtoFields).toContain(f);
  });

  it('optional fields are OMITTED when blank, never sent as empty strings', () => {
    for (const f of ['address', 'city', 'email', 'returnCity', 'returnPin', 'returnState']) {
      expect(PANEL).toContain(`form.${f}?.trim() ? { ${f}:`);
    }
  });
});

describe('the name is treated as the irreversible field it is', () => {
  it('the name is NOT trimmed before sending', () => {
    // Silently trimming would hide that the string is load-bearing, and
    // the server refuses a name differing from its own trimmed form —
    // so the operator must see it, not have it fixed behind their back.
    expect(PANEL).toContain('name: form.name,');
    expect(PANEL).not.toContain('name: form.name.trim()');
  });

  it('surrounding whitespace is surfaced as an error at the field', () => {
    expect(PANEL).toContain('form.name !== form.name.trim()');
    expect(flat(PANEL)).toContain('leading or trailing space');
  });

  it('registering requires the name typed twice; updating does not', () => {
    // On update the name is a lookup key for something already created,
    // so a second typing would be ceremony. On register it is permanent.
    expect(PANEL).toContain("mode === 'UPDATE' || confirmName === form.name");
  });

  it('the copy says it cannot be changed afterwards', () => {
    expect(flat(PANEL)).toContain('cannot be changed afterwards');
  });
});

describe('the two verbs are separate hooks', () => {
  it('POST and PUT are literal, not computed', () => {
    // A `method:` a static reader cannot resolve defaults to GET — the
    // route check reported a call to a route that does not exist, which
    // is exactly what a dynamic verb does to every static reader.
    expect(HOOKS).toContain('export function useRegisterCourierWarehouse(');
    expect(HOOKS).toContain('export function useUpdateCourierWarehouse(');
    expect(HOOKS).not.toContain("method: mode === 'REGISTER' ? 'POST' : 'PUT'");
  });

  it('both hit the endpoint the controller declares', () => {
    expect(CONTROLLER).toContain("@Post('warehouses')");
    expect(CONTROLLER).toContain("@Put('warehouses')");
    expect(HOOKS).toContain("'/api/admin/courier-ops/warehouses'");
  });

  it('gates on the permission the controller requires', () => {
    expect(CONTROLLER).toContain("@RequirePermissions('courier.accounts.manage')");
    expect(PANEL).toContain("usePermission('courier.accounts.manage')");
  });
});

describe('the connectivity check does not overclaim', () => {
  it('stub mode is reported as proving nothing', () => {
    // A cached serviceability answer looks identical to a successful
    // call. Reporting stub mode as reachability would be the worst
    // possible outcome here, because it looks exactly like proof.
    expect(PANEL).toContain('result.stubMode');
    expect(flat(PANEL)).toContain('never left the box');
  });

  it('reads reachedLiveApi, not merely a serviceable answer', () => {
    expect(PANEL).toContain('result.reachedLiveApi');
  });

  it('is a mutation, so it never fires on render', () => {
    // It spends a real call against the account's rate budget.
    expect(HOOKS).toContain('export function useDelhiveryConnectivity(');
    const block = HOOKS.slice(HOOKS.indexOf('export function useDelhiveryConnectivity('));
    expect(block.slice(0, 700)).toContain('useMutation');
  });
});
