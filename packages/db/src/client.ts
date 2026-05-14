import { PrismaClient } from '@prisma/client';

const isProd = process.env['NODE_ENV'] === 'production';

const logLevels: Array<'query' | 'error' | 'warn' | 'info'> = isProd
  ? ['error']
  : ['query', 'error', 'warn'];

// Reuse a single PrismaClient across hot-reloads in dev (Next.js, tsx watch,
// nest --watch). In production each process gets its own instance.
const globalForPrisma = globalThis as unknown as { __skydropPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__skydropPrisma ?? new PrismaClient({ log: logLevels });

if (!isProd) {
  globalForPrisma.__skydropPrisma = prisma;
}

const disconnect = (): void => {
  void prisma.$disconnect();
};

process.once('SIGTERM', disconnect);
process.once('SIGINT', disconnect);

export { PrismaClient };
