import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { destroyTestQueryClients } from './helpers';

afterEach(async () => {
  // Unmount React first so nothing is still subscribed, THEN shut down
  // the query clients. Reversed, a component can re-subscribe to a
  // client that is already being torn down.
  cleanup();
  await destroyTestQueryClients();
  vi.unstubAllGlobals();
});
