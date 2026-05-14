import { dropTestDatabase } from './test-database';

export default async function globalTeardown(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[e2e] tearing down test DB');
  dropTestDatabase();
}
