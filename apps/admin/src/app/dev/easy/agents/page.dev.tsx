'use client';

import type { ReactElement } from 'react';
import { AgentsIndex } from '../../../(authed)/call-center/agents/_components/agents-index';
import { EasyHarness, json, type Respond } from '../harness';
import { AGENTS, METRICS } from '../call-fixtures';

/**
 * /dev/easy/agents — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  three agents   b  no agents   c  the list fails
 *            d  a settings change is refused by the server
 */
const FIXTURES = ['a', 'b', 'c', 'd'] as const;
type F = (typeof FIXTURES)[number];

const respond: Respond<F> = (fixture, req) => {
  if (req.path === '/api/admin/agents') {
    if (fixture === 'c')
      return json({ code: 'SERVICE_UNAVAILABLE', message: 'Not reachable' }, 503);
    return json(fixture === 'b' ? [] : AGENTS);
  }
  if (/\/metrics$/.test(req.path)) return json(METRICS);
  if (req.method !== 'GET' && /\/settings$/.test(req.path)) {
    if (fixture === 'd')
      return json({ code: 'AGENT_SETTINGS_INVALID', message: 'Working hours are not valid' }, 400);
    return json(AGENTS[0]?.settings);
  }
  return undefined;
};

export default function AgentsHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => ['callcenter.supervise', 'callcenter.queue.manage', 'staff.view']}
    >
      <AgentsIndex />
    </EasyHarness>
  );
}
