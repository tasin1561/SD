// Records one off-site backup run in audit_logs, where the API's backup
// watchdog reads it. Called by skydrop-backup.sh on the droplet:
//   cd ~/app/packages/db && node ~/app/scripts/backup/record-backup-run.cjs <completed|failed> '<json>'
// The Prisma client is resolved from the working directory, exactly as
// ~/verify/verify-run.cjs does, so the deployed client is used.
const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [process.cwd()] }));

const [outcome, raw] = process.argv.slice(2);
if (outcome !== 'completed' && outcome !== 'failed') {
  console.error('usage: record-backup-run.cjs <completed|failed> <json>');
  process.exit(2);
}

let metadata;
try {
  metadata = raw ? JSON.parse(raw) : {};
} catch {
  metadata = { unparsed: String(raw).slice(0, 500) };
}

const prisma = new PrismaClient();
prisma.auditLog
  .create({
    data: {
      actorType: 'SYSTEM',
      action: `system.backup.${outcome}`,
      entityType: 'backup',
      // Not a row: the run is described in metadata (audit_logs.entity_id is a uuid).
      entityId: null,
      severity: outcome === 'completed' ? 'LOW' : 'HIGH',
      metadata,
    },
  })
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err.message);
    await prisma.$disconnect();
    process.exit(1);
  });
