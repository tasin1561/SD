/**
 * Ops helper: store (or rotate) a courier API credential — AES-256-GCM
 * encrypted into `courier_credentials`, key ONLY in env (CUR-1 / MUST NOT #1).
 *
 *   COURIER_API_TOKEN=<plaintext-token> \
 *     pnpm tsx scripts/provision-courier-credential.ts <courierCode> <environment> [keyVersion]
 *
 *   <courierCode>   e.g. delhivery
 *   <environment>   PRODUCTION | SANDBOX
 *   [keyVersion]    encryption key version (default 1 → COURIER_CREDENTIALS_KEY_V1)
 *
 * The token is read from the COURIER_API_TOKEN env var (NEVER argv) so it
 * stays out of the shell history and the process arg list. The stored
 * payload is JSON `{ "apiToken": "<token>" }` — the field name the
 * DelhiveryHttpService reads (TOKEN_FIELD = 'apiToken').
 *
 * Idempotent + rotation-safe: the single ACTIVE row per (courier,
 * environment) is updated in place if it exists, else created. Honors the
 * `@@unique([courierId, environment, isActive])` constraint (never leaves
 * two active rows). To rotate a token, re-run with the new value.
 *
 * Nothing goes "live" from this script alone — real mode is gated on the
 * `courier.delhivery_api_base_url` system_setting being non-empty. This
 * only provisions the credential real mode will use.
 */
import { prisma, CredentialEnvironment } from '@skydrop/db';
import { encryptCredential } from '../src/modules/courier-shared/util/courier-credential-cipher';

const TOKEN_FIELD = 'apiToken';

async function main(): Promise<void> {
  const [, , courierCodeArg, environmentArg, keyVersionArg] = process.argv;
  const token = process.env.COURIER_API_TOKEN ?? '';

  if (!courierCodeArg || !environmentArg) {
    console.error(
      'Usage: COURIER_API_TOKEN=<token> pnpm tsx scripts/provision-courier-credential.ts <courierCode> <environment> [keyVersion]',
    );
    process.exit(1);
  }
  if (token.trim() === '') {
    console.error('COURIER_API_TOKEN env var is required (the plaintext API token).');
    process.exit(1);
  }
  if (!(environmentArg in CredentialEnvironment)) {
    console.error(
      `Invalid environment: ${environmentArg}. Allowed: ${Object.keys(CredentialEnvironment).join(', ')}`,
    );
    process.exit(1);
  }
  const environment =
    CredentialEnvironment[environmentArg as keyof typeof CredentialEnvironment];
  const courierCode = courierCodeArg.trim().toLowerCase();
  const keyVersion = keyVersionArg ? Number.parseInt(keyVersionArg, 10) : 1;
  if (!Number.isInteger(keyVersion) || keyVersion < 1) {
    console.error(`Invalid keyVersion: ${keyVersionArg}`);
    process.exit(1);
  }

  const keyHex = process.env[`COURIER_CREDENTIALS_KEY_V${keyVersion}`] ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    console.error(
      `COURIER_CREDENTIALS_KEY_V${keyVersion} is not set to 64 hex chars — cannot encrypt.`,
    );
    process.exit(1);
  }

  const courier = await prisma.courier.findUnique({
    where: { code: courierCode },
    select: { id: true, name: true },
  });
  if (!courier) {
    console.error(`Courier '${courierCode}' not found.`);
    process.exit(1);
  }

  const encryptedPayload = encryptCredential(
    JSON.stringify({ [TOKEN_FIELD]: token.trim() }),
    keyHex,
  );

  const existing = await prisma.courierCredential.findFirst({
    where: { courierId: courier.id, environment, isActive: true, deletedAt: null },
    select: { id: true },
  });

  if (existing) {
    await prisma.courierCredential.update({
      where: { id: existing.id },
      data: {
        encryptedPayload,
        encryptionKeyVersion: keyVersion,
        fieldNames: [TOKEN_FIELD],
      },
    });
    console.info(
      `rotated ${courierCode} ${environment} credential (row ${existing.id}, keyV${keyVersion}).`,
    );
  } else {
    const created = await prisma.courierCredential.create({
      data: {
        courierId: courier.id,
        environment,
        encryptedPayload,
        encryptionKeyVersion: keyVersion,
        fieldNames: [TOKEN_FIELD],
        isActive: true,
      },
      select: { id: true },
    });
    console.info(
      `provisioned ${courierCode} ${environment} credential (row ${created.id}, keyV${keyVersion}).`,
    );
  }

  await prisma.$disconnect();
}

void main();
