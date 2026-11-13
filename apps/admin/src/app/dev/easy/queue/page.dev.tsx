'use client';

import type { ReactElement } from 'react';
import { QueueIndex } from '../../../(authed)/call-center/queue/_components/queue-index';
import { EasyHarness, json, type Respond } from '../harness';
import { AGENTS, QUEUE, SELLERS } from '../call-fixtures';

/**
 * /dev/easy/queue — DEV ONLY (page.dev.tsx, APPS_DEV_ROUTES=1).
 *
 *   ?fixture=a  six calls in every status   b  an empty queue
 *            c  the list fails to load      d  a supervisor action is refused
 */
const FIXTURES = ['a', 'b', 'c', 'd'] as const;
type F = (typeof FIXTURES)[number];

const respond: Respond<F> = (fixture, req) => {
  if (req.path === '/api/admin/call-queue/stats') {
    return json({
      byStatus: { PENDING: 2, ASSIGNED: 2, COMPLETED: 1, EXPIRED: 1 },
      openTotal: fixture === 'b' ? 0 : 4,
      assignedByAgent: [{ agentId: 'a2', count: 2 }],
    });
  }
  if (req.path === '/api/admin/call-queue') {
    if (fixture === 'c')
      return json({ code: 'SERVICE_UNAVAILABLE', message: 'Not reachable' }, 503);
    const status = req.query.get('status');
    const rows =
      fixture === 'b'
        ? []
        : QUEUE.filter(
            (r) =>
              status === null ||
              (status === 'OPEN'
                ? ['PENDING', 'ASSIGNED'].includes(r.status)
                : r.status === status),
          );
    return json({ items: rows, total: rows.length, page: 1, pageSize: 20 });
  }
  if (req.path === '/api/admin/agents') return json(AGENTS);
  if (req.path === '/api/admin/sellers') return json(SELLERS);
  if (req.method !== 'GET') {
    if (fixture === 'd')
      return json(
        { code: 'CALL_QUEUE_ENTRY_CLOSED', message: 'This call is already finished' },
        409,
      );
    return json({ id: 'q1', status: 'PENDING', availableAt: new Date().toISOString() });
  }
  return undefined;
};

export default function QueueHarness(): ReactElement {
  return (
    <EasyHarness
      fixtures={FIXTURES}
      respond={respond}
      permissions={() => [
        'callcenter.queue.manage',
        'callcenter.supervise',
        'callcenter.work',
        'orders.view',
        'sellers.view',
      ]}
    >
      <QueueIndex />
    </EasyHarness>
  );
}
