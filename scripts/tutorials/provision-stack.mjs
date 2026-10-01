/**
 * The bits of a filming stack that NO EXISTING SEED creates.
 *
 * `packages/db`'s seed writes system settings, couriers, the warehouse,
 * notification templates and FX; `seed-demo-data.mjs` writes the demo
 * seller, its catalogue, its stock and its orders. Between them they
 * build almost the whole world — and on a genuinely empty database they
 * still leave FOUR gaps, every one of which was filled BY HAND in the
 * original dev database through the admin UI and therefore exists
 * nowhere in the repository:
 *
 *   1. A COURIER ACCOUNT with an encrypted credential. `shipments`
 *      records which account carried a parcel (CACC-1) and the AWB
 *      dispatcher resolves its credential through it, so without one no
 *      waybill is ever booked and every lifecycle flow — sections D, E
 *      and K, which is most of what is left to film — fails. Two
 *      accounts, PRODUCTION and SANDBOX, because the original box has
 *      two and `seed-demo-data.mjs`'s COD settlement reads the one the
 *      PARCEL names rather than the default (a settlement against an
 *      account that did not carry the order is refused outright,
 *      `SETTLEMENT_ORDER_OTHER_COURIER`).
 *
 *   2. PLATFORM BANK ACCOUNTS. A courier settlement is refused without
 *      a receiving account (`SETTLEMENT_NO_RECEIVING_ACCOUNT`, TRE-3),
 *      so the wallet videos have no COD credit to film without one. One
 *      rupee account for payouts and one taka account for seller
 *      remittances, which is what the money flows need.
 *
 *   3. THE PICKUP LOCATION. `DelhiveryAwbService` refuses to manifest
 *      a parcel without one, and the refusal happens inside the AWB job
 *      rather than at confirmation — so the only thing the seed says is
 *      "gave up waiting for a waybill after 30s", with the real reason
 *      three BullMQ retries deep in the API's log. Found exactly that
 *      way by the first from-scratch stack.
 *
 *   4. THE SIMULATOR POINTER. `courier.delhivery_api_base_url` is
 *      seeded EMPTY (stub mode) and `courier.delhivery_live_writes_enabled`
 *      seeded FALSE, both correctly — a repository must not ship a
 *      configuration that books parcels. A stack points them at ITS OWN
 *      simulator port, which is also what keeps two stacks from firing
 *      webhooks at each other's API.
 *
 * IT IS NOT A DATA COPY. Every row here is constructed, not lifted from
 * the original database — the credential is a throwaway token the
 * simulator never checks, and the bank details are obvious fakes. The
 * only thing taken from the original box is the SHAPE: two accounts, one
 * credential field called `apiToken`, a rupee account and a taka one.
 *
 * IDEMPOTENT, and safe to re-run on a stack that is already filming:
 * everything is find-or-create keyed on a label or a setting key, and
 * nothing is deleted.
 *
 *   TUT_STACK=b node scripts/tutorials/provision-stack.mjs
 *   scripts/tutorials/stack.sh run b -- node scripts/tutorials/provision-stack.mjs
 */
import { prisma } from './lib/deps.mjs';
import { API, call } from './lib/api.mjs';
import { ensureOpsStaff } from './lib/ops-user.mjs';
import { assertStackEnvironment, resolveStack } from './lib/stacks.mjs';

/** The throwaway credential. The simulator authenticates nobody; the row has to exist. */
const SIM_API_TOKEN = 'simulator-token-not-a-secret';

/**
 * The name the warehouse is registered under with the courier. Matched
 * EXACTLY on every manifest, which is why it is a value and not a guess
 * — and why the real one is immutable once registered (courier-ops).
 */
const PICKUP_LOCATION = 'Skydrop';

const COURIER_ACCOUNTS = [
  { label: 'Simulator account', environment: 'PRODUCTION', isDefault: true },
  { label: 'Simulator account (SANDBOX)', environment: 'SANDBOX', isDefault: true },
];

const BANK_ACCOUNTS = [
  {
    label: 'HDFC Current',
    bankName: 'HDFC Bank',
    accountName: 'Skydrop Logistics Pvt Ltd',
    accountNumber: '50200012345678',
    currency: 'INR',
    openingBalance: '250000',
  },
  {
    label: 'BRAC Payout',
    bankName: 'BRAC Bank',
    accountName: 'Skydrop Bangladesh Ltd',
    accountNumber: '1501203456789',
    currency: 'BDT',
    openingBalance: '500000',
  },
];

/** Settings a stack owns, as opposed to the ones the db seed is right about. */
function stackSettings(stack) {
  return [
    { key: 'courier.delhivery_api_base_url', valueType: 'STRING', value: stack.sim.url },
    { key: 'courier.delhivery_live_writes_enabled', valueType: 'BOOLEAN', value: true },
    // OFF deliberately: the pool refill consumes a real account's waybill
    // allocation, and against the simulator it is simply noise.
    { key: 'courier.delhivery_waybill_pool_refill_enabled', valueType: 'BOOLEAN', value: false },
    // THE PICKUP LOCATION, which is the fourth thing nobody had written
    // down. It was found by a from-scratch stack failing the lifecycle:
    // `DelhiveryAwbService` refuses to manifest without one — "this
    // account has no pickup_location_name and
    // system_settings 'courier.delhivery_pickup_location' is unset" —
    // and because the refusal happens inside the AWB job rather than at
    // confirmation, the seed simply reported "Gave up waiting for a
    // waybill on RSH-LIFE-DELIVERED after 30s" with the real reason
    // three retries deep in the API's log. The original dev database
    // carries 'Skydrop' in the SETTING rather than on either account, so
    // that is what a stack gets; the simulator accepts any name, and
    // using the same one keeps the two stacks' courier payloads
    // identical.
    { key: 'courier.delhivery_pickup_location', valueType: 'STRING', value: PICKUP_LOCATION },
  ];
}

async function ensureSetting(staffToken, { key, valueType, value }) {
  const current = await prisma.systemSetting.findUnique({
    where: { key },
    select: { valueString: true, valueBoolean: true },
  });
  if (current === null) throw new Error(`No system setting "${key}" — run the db seed first.`);
  const already =
    valueType === 'BOOLEAN' ? current.valueBoolean === value : current.valueString === value;
  if (already) {
    console.log(`  · ${key} is already ${String(value)}`);
    return;
  }
  // Through the admin endpoint rather than a Prisma update: it is the
  // path that type-checks the write and audits it, and a setting written
  // round the back is one the audit trail cannot explain.
  await call(`/admin/system-settings/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    token: staffToken,
    // The value is passed AS TYPED, never stringified: `parseValue`
    // demands a real boolean for a BOOLEAN setting and refuses the
    // string "true" with INVALID_VALUE.
    body: { valueType, value },
  });
  console.log(`  · ${key} → ${String(value)}`);
}

async function ensureBankAccounts(staffToken) {
  const existing = await call('/admin/platform-bank-accounts', { token: staffToken });
  const byLabel = new Map(existing.map((a) => [a.label, a]));
  const out = [];
  for (const want of BANK_ACCOUNTS) {
    const found = byLabel.get(want.label);
    if (found !== undefined) {
      console.log(`  · bank account "${want.label}" is on file`);
      out.push(found);
      continue;
    }
    const made = await call('/admin/platform-bank-accounts', {
      method: 'POST',
      token: staffToken,
      body: want,
    });
    console.log(`  · bank account "${want.label}" created (${want.currency})`);
    out.push(made);
  }
  return out;
}

async function ensureCourierAccounts(staffToken, inrBankId) {
  const existing = await call('/admin/courier-accounts', { token: staffToken });
  const byLabel = new Map(existing.map((a) => [a.label, a]));
  for (const want of COURIER_ACCOUNTS) {
    let account = byLabel.get(want.label);
    if (account === undefined) {
      account = await call('/admin/courier-accounts', {
        method: 'POST',
        token: staffToken,
        body: {
          courierCode: 'delhivery',
          environment: want.environment,
          label: want.label,
          credentialFields: { apiToken: SIM_API_TOKEN },
          isDefault: want.isDefault,
        },
      });
      console.log(`  · courier account "${want.label}" created (${want.environment})`);
    } else {
      console.log(`  · courier account "${want.label}" is on file`);
    }
    // The paid-into account, which a settlement is refused without
    // (TRE-3). Read from the row rather than assumed, so a re-run after
    // somebody changed it by hand leaves their choice alone.
    const row = await prisma.courierAccount.findUnique({
      where: { id: account.id },
      select: { payoutBankAccountId: true },
    });
    if (row !== null && row.payoutBankAccountId === null) {
      await call(`/admin/courier-accounts/${account.id}`, {
        method: 'PATCH',
        token: staffToken,
        body: { payoutBankAccountId: inrBankId },
      });
      console.log(`  · paid-into account set for "${want.label}"`);
    }
  }
}

async function main() {
  const stack = resolveStack();
  // Redis is not touched here, so it is not demanded — but the database
  // and the bucket are, and getting either wrong would provision the
  // other stack.
  assertStackEnvironment(stack, { requireRedis: false });

  console.log(`Provisioning filming stack "${stack.name}" against ${API}`);
  console.log(`  database  ${stack.database}`);
  console.log(`  simulator ${stack.sim.url}`);

  const staffToken = await ensureOpsStaff();
  console.log('  · ops staff ready');

  for (const setting of stackSettings(stack)) await ensureSetting(staffToken, setting);

  const banks = await ensureBankAccounts(staffToken);
  const inr = banks.find((b) => String(b.currency).toUpperCase() === 'INR');
  if (inr === undefined) throw new Error('No rupee bank account after provisioning.');
  await ensureCourierAccounts(staffToken, inr.id);

  console.log(`\nStack "${stack.name}" is provisioned.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(`\n${e.message}`);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
