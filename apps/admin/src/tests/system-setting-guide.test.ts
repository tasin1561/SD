import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FEE_CURRENCY_OPTIONS, isFeeCurrencyKey } from '@/lib/fee-currency';
import {
  FREE_TEXT_SETTINGS,
  SETTING_GROUP_ORDER,
  SETTING_GUIDE,
  fallbackSettingName,
  settingValueLabel,
  type SettingOption,
} from '@/lib/system-setting-guide';

/**
 * Every system setting gets a plain-English name, and the guide names no
 * key that does not exist. Read from the seed and from the migrations that
 * INSERT settings rather than from the API: they are the declaration every
 * environment is built from, and a key added there without words would
 * otherwise reach /settings (or a seller's overrides) as a bare code.
 *
 * It also pins the pickers: every STRING setting either has choices (a
 * dropdown) or is named in FREE_TEXT_SETTINGS with a reason, every switch
 * says what On and Off each do, and every choice carries an explanation
 * and an example.
 */
const here = dirname(fileURLToPath(import.meta.url));
const dbDir = join(here, '../../../../packages/db/prisma');
const seed = readFileSync(join(dbDir, 'seed.ts'), 'utf8');

type ValueType = 'STRING' | 'INT' | 'DECIMAL' | 'BOOLEAN' | 'JSON' | 'DATE';

/** key → value type, for every setting the seed declares. */
function seedSettings(): Map<string, ValueType> {
  const start = seed.indexOf('const systemSettings: SystemSettingSeed[] = [');
  const end = seed.indexOf('async function seedSystemSettings');
  const body = seed.slice(start, end);
  const out = new Map<string, ValueType>();
  const re = /key:\s*'([^']+)'[\s\S]*?valueType:\s*SettingValueType\.(\w+)/g;
  for (const m of body.matchAll(re)) {
    if (m[1] !== undefined && m[2] !== undefined) out.set(m[1], m[2] as ValueType);
  }
  // The two settings seedSystemSettings() upserts by hand (warehouse ids).
  const fn = seed.slice(end, seed.indexOf('async function seedCouriers'));
  const manual = /key:\s*'([^']+)',\s*category:\s*'[^']*',\s*valueType:\s*SettingValueType\.(\w+)/g;
  for (const m of fn.matchAll(manual)) {
    if (m[1] !== undefined && m[2] !== undefined) out.set(m[1], m[2] as ValueType);
  }
  return out;
}

/** key → value type, for every setting a migration INSERTs. */
function migrationSettings(): Map<string, ValueType> {
  const dir = join(dbDir, 'migrations');
  const out = new Map<string, ValueType>();
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, 'migration.sql');
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, 'utf8');
    if (!/INSERT INTO "?system_settings"?/.test(sql)) continue;
    const re =
      /'([a-z_]+\.[a-z0-9_.]+)'\s*,\s*'[a-z_]+'\s*,\s*'(string|int|decimal|boolean|json|date)'/g;
    for (const m of sql.matchAll(re)) {
      if (m[1] !== undefined && m[2] !== undefined) {
        out.set(m[1], m[2].toUpperCase() as ValueType);
      }
    }
  }
  return out;
}

function overridableKeys(): string[] {
  const lines = seed.split('\n');
  const keys: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes('sellerOverridable: true')) return;
    for (let j = i; j >= Math.max(0, i - 60); j--) {
      const m = /key:\s*'([^']+)'/.exec(lines[j] ?? '');
      if (m?.[1] !== undefined) {
        keys.push(m[1]);
        return;
      }
    }
  });
  return keys;
}

function expectOption(where: string, o: SettingOption): void {
  expect(o.label.trim().length, `${where} label`).toBeGreaterThan(0);
  expect(o.does.trim().length, `${where} does`).toBeGreaterThan(10);
  expect(o.example.trim().length, `${where} example`).toBeGreaterThan(10);
}

describe('system setting guide', () => {
  const fromSeed = seedSettings();
  const fromMigrations = migrationSettings();
  const all = new Map<string, ValueType>([...fromMigrations, ...fromSeed]);
  const overridable = overridableKeys();

  it('finds the settings in the seed and the migrations', () => {
    expect(fromSeed.size).toBeGreaterThan(150);
    expect(fromSeed.has('ops.default_warehouse_id')).toBe(true);
    expect(fromSeed.has('ops.bd_intake_warehouse_id')).toBe(true);
    expect(fromMigrations.size).toBeGreaterThan(10);
    expect(overridable.length).toBeGreaterThan(30);
  });

  it('names every setting in the seed and the migrations', () => {
    expect([...all.keys()].filter((k) => SETTING_GUIDE[k] === undefined)).toEqual([]);
  });

  it('names every seller-overridable key', () => {
    expect(overridable.filter((k) => SETTING_GUIDE[k] === undefined)).toEqual([]);
  });

  it('names no key the seed or migrations do not declare', () => {
    expect(Object.keys(SETTING_GUIDE).filter((k) => !all.has(k))).toEqual([]);
  });

  it('gives every entry a known group, an explanation and an example', () => {
    for (const [key, g] of Object.entries(SETTING_GUIDE)) {
      expect(SETTING_GROUP_ORDER, key).toContain(g.group);
      expect(g.name.length, key).toBeGreaterThan(3);
      expect(g.what.length, key).toBeGreaterThan(20);
      expect(g.example.length, key).toBeGreaterThan(20);
    }
  });

  it('gives every choice and every checkbox an explanation and an example', () => {
    for (const [key, g] of Object.entries(SETTING_GUIDE)) {
      for (const [code, o] of Object.entries(g.values ?? {})) expectOption(`${key}=${code}`, o);
      for (const [code, o] of Object.entries(g.multi ?? {})) expectOption(`${key}[${code}]`, o);
    }
  });

  it('says what On and what Off does for every switch', () => {
    const switches = [...all].filter(([, t]) => t === 'BOOLEAN').map(([k]) => k);
    expect(switches.length).toBeGreaterThan(20);
    for (const key of switches) {
      const values = SETTING_GUIDE[key]?.values;
      expect(Object.keys(values ?? {}).sort(), key).toEqual(['false', 'true']);
    }
  });

  it('gives every STRING setting a dropdown, or names it as free text with a reason', () => {
    const strings = [...all].filter(([, t]) => t === 'STRING').map(([k]) => k);
    expect(strings.length).toBeGreaterThan(30);
    const neither = strings.filter((key) => {
      const g = SETTING_GUIDE[key];
      const choices = g?.values !== undefined || g?.source !== undefined;
      return !choices && FREE_TEXT_SETTINGS[key] === undefined;
    });
    expect(neither).toEqual([]);
    const both = strings.filter((key) => {
      const g = SETTING_GUIDE[key];
      return (g?.values !== undefined || g?.source !== undefined) && key in FREE_TEXT_SETTINGS;
    });
    expect(both).toEqual([]);
  });

  it('lists as free text only STRING settings that exist, each with a reason', () => {
    for (const [key, reason] of Object.entries(FREE_TEXT_SETTINGS)) {
      expect(all.get(key), key).toBe('STRING');
      expect(reason.length, key).toBeGreaterThan(8);
    }
  });

  it('offers exactly the fee currencies the API accepts', () => {
    const feeKeys = [...all.keys()].filter(isFeeCurrencyKey);
    expect(feeKeys.length).toBe(3);
    for (const key of feeKeys) {
      expect(Object.keys(SETTING_GUIDE[key]?.values ?? {}).sort(), key).toEqual(
        [...FEE_CURRENCY_OPTIONS].sort(),
      );
    }
  });

  it('edits the re-attempt status list as a pick-list', () => {
    expect(
      Object.keys(SETTING_GUIDE['orders.reattempt_requestable_statuses']?.multi ?? {}),
    ).toEqual(['REJECTED_BY_CUSTOMER', 'REJECTED_NDR']);
  });

  it('reads values as words', () => {
    expect(settingValueLabel('wallet.cod_credit_mode', 'INSTANT_PAY')).toBe(
      'Instant Pay, at delivery',
    );
    expect(settingValueLabel('ops.nsa_enabled', 'true')).toBe('On');
    expect(settingValueLabel('ops.nsa_enabled', false)).toBe('Off');
    expect(
      settingValueLabel('orders.reattempt_requestable_statuses', '["REJECTED_BY_CUSTOMER"]'),
    ).toBe('Customer said no');
    expect(settingValueLabel('courier.delhivery_support_email', '')).toBe('Not set');
    expect(settingValueLabel('ops.call_max_attempts_before_ndr', '3')).toBe('3');
  });

  it('falls back to a readable name for an unknown key', () => {
    expect(fallbackSettingName('wallet.some_new_limit_inr')).toBe('Some new limit inr');
  });

  // Both edit dialogs draw the value through ONE editor, so /settings and a
  // seller's overrides cannot come to offer different controls for a key.
  it('edits values through the one shared editor on both screens', () => {
    const app = join(here, '../app/(authed)');
    for (const file of [
      join(app, 'settings/_components/edit-setting-dialog.tsx'),
      join(app, 'sellers/_components/seller-settings-section.tsx'),
    ]) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).toContain('<SettingValueEditor');
      expect(src, file).not.toMatch(/<Select\b|<Checkbox\b|<TextArea\b/);
    }
  });
});
