'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AuthProvider } from '@skydrop/auth/client';
import type { StaffMe } from '@skydrop/api-client';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { QueryProvider } from '@/components/query-provider';
import { AiShell } from '@/app/(authed)/ai/_components/ai-shell';
import { AiBilling } from '@/app/(authed)/ai/_components/ai-billing';
import { AiControls } from '@/app/(authed)/ai/_components/ai-controls';
import { AiConversationDetail } from '@/app/(authed)/ai/_components/ai-conversation-detail';
import { AiConversations } from '@/app/(authed)/ai/_components/ai-conversations';
import { AiDashboard } from '@/app/(authed)/ai/_components/ai-dashboard';
import '@skydrop/ui/brand/scales.css';
import '@skydrop/ui/brand/theme.css';
import '@skydrop/ui/brand/app.css';

/**
 * /dev/ai — the AI control panel against MOCKED data, so billing, the
 * dashboard, the explorer (masked, then revealed), the controls and the empty
 * and error states can be looked at without a database.
 *
 * DEV ONLY: `page.dev.tsx` compiles only under APPS_DEV_ROUTES=1.
 * `?view=billing|dashboard|conversations|detail|controls`.
 * `window.fetch` is replaced for `/api/admin/assistant-panel/*` only.
 */
const ME: StaffMe = {
  id: '0191a000-0000-7000-8000-000000000001',
  email: 'owner@skydrop.test',
  emailDisplay: 'owner@skydrop.test',
  roleKey: 'SUPER_ADMIN',
  roleName: 'Super Admin',
  roleKeys: ['SUPER_ADMIN'],
  roleNames: ['Super Admin'],
  permissions: ['assistant.admin', 'assistant.conversations.read'],
  emailVerifiedAt: null,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00Z',
};

const bucket = (req: number, cost: number) => ({
  requests: req,
  inputTokens: req * 1800,
  outputTokens: req * 420,
  cacheReadTokens: req * 5200,
  cacheWriteTokens: req * 90,
  costUsd: cost.toFixed(8),
});
function row(period: string, seed: number) {
  const base = ((seed * 37) % 11) + 2;
  const p = {
    staff: bucket(base * 9, base * 0.91),
    seller: bucket(base * 21, base * 2.2),
    store: bucket(base * 6, base * 0.64),
    associate: bucket(base * 2, base * 0.2),
  };
  const sum = Object.values(p).reduce((a, b) => a + Number(b.costUsd), 0);
  const req = Object.values(p).reduce((a, b) => a + b.requests, 0);
  const assistant = bucket(req, sum);
  return {
    period,
    total: assistant,
    assistant: { total: assistant, portals: p },
    monitor: bucket(0, 0),
  };
}
const budget = {
  assistantBudgetUsd: '200.00',
  monitorBudgetUsd: '50.00',
  assistantUsedPct: 61.4,
  monitorUsedPct: 0,
  projectedCostUsd: '161.20',
  projectedPct: 80.6,
};
const monthKeys = [
  '2026-11',
  '2026-10',
  '2026-09',
  '2026-08',
  '2026-07',
  '2026-06',
  '2026-05',
  '2026-04',
  '2026-03',
  '2026-02',
  '2026-01',
  '2025-12',
];

const MASKED = 'Customer called from +91 98•••••606 about order SD-100234.';
const REAL = 'Customer called from +91 9876543606 about order SD-100234.';
const convo = (revealed: boolean) => ({
  conversation: {
    id: 'c1',
    portal: 'seller',
    title: null,
    user: 'Asha Rahman',
    account: 'Menev Store',
    createdAt: '2026-11-12T09:00:00Z',
    updatedAt: '2026-11-12T09:03:00Z',
    anonymised: false,
  },
  messages: [
    {
      id: 'm1',
      role: 'user',
      isQuestion: true,
      at: '2026-11-12T09:00:00Z',
      blocks: [{ type: 'text', text: 'Where is order SD-100234?' }],
      maskedPhones: 0,
      attachmentIds: [],
      feedback: [],
    },
    {
      id: 'm2',
      role: 'assistant',
      isQuestion: false,
      at: '2026-11-12T09:00:03Z',
      blocks: [{ type: 'tool_use', name: 'get_order', input: { orderNumber: 'SD-100234' } }],
      maskedPhones: 0,
      attachmentIds: [],
      feedback: [],
    },
    {
      id: 'm3',
      role: 'user',
      isQuestion: false,
      at: '2026-11-12T09:00:04Z',
      blocks: [
        {
          type: 'tool_result',
          ok: true,
          content: { status: 'IN_TRANSIT', phone: revealed ? '+919876543606' : '+91 98•••••606' },
        },
      ],
      maskedPhones: revealed ? 0 : 1,
      attachmentIds: [],
      feedback: [],
    },
    {
      id: 'm4',
      role: 'assistant',
      isQuestion: false,
      at: '2026-11-12T09:00:06Z',
      blocks: [{ type: 'text', text: revealed ? REAL : MASKED }],
      maskedPhones: revealed ? 0 : 1,
      attachmentIds: [],
      feedback: [{ rating: 'down', comment: 'It did not say when it arrives.' }],
    },
  ],
  attachments: [
    {
      id: 'a1',
      kind: 'IMAGE',
      mediaType: 'image/jpeg',
      name: 'parcel.jpg',
      bytes: 183000,
      pages: null,
      available: true,
    },
  ],
  notices: [{ code: 'TRUNCATED', at: '2026-11-12T09:02:00Z' }],
  tools: [],
});

function install(): () => void {
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url, window.location.origin).pathname;
    if (!path.startsWith('/api/admin/assistant-panel')) return real(input, init);
    const json = (v: unknown): Response =>
      new Response(JSON.stringify(v), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const u = new URL(url, window.location.origin);
    if (path.endsWith('/billing/monthly'))
      return json({
        timezone: 'Asia/Dhaka',
        months: monthKeys.map((m, i) => row(m, i + 3)),
        currentBudget: budget,
      });
    if (path.endsWith('/billing/daily')) {
      const month = u.searchParams.get('month') ?? '2026-11';
      const days = Array.from({ length: 30 }, (_, i) =>
        row(`${month}-${String(i + 1).padStart(2, '0')}`, i * 5 + 1),
      );
      return json({ timezone: 'Asia/Dhaka', month, days, total: row(month, 9), budget });
    }
    if (path.endsWith('/dashboard'))
      return json({
        range: { from: '2026-10-15', to: '2026-11-13', timezone: 'Asia/Dhaka' },
        questions: 1284,
        questionsPerDay: Array.from({ length: 30 }, (_, i) => ({
          day: `2026-10-${String(15 + (i % 17)).padStart(2, '0')}`,
          count: 20 + ((i * 13) % 47),
        })),
        activeUsers: 96,
        spend: { rangeCostUsd: '88.10000000', requests: 3300, month: row('2026-11', 9), budget },
        cacheHitRate: 0.71,
        notices: { RESTING_DAILY: 4, TRUNCATED: 9, FAILED: 3, REFUSED: 2 },
        errorRate: 0.0124,
        refusalRate: 0.0016,
        tools: [
          { name: 'get_order', calls: 640, failed: 12 },
          { name: 'wallet_balance', calls: 211, failed: 0 },
        ],
        languages: { counts: { en: 700, bn: 260, hi: 90, bnLatn: 180, hiLatn: 54 }, sampled: 1284 },
        portals: { staff: 310, seller: 760, store: 160, associate: 54 },
        attachments: 73,
        proposals: { raised: 31, confirmed: 22 },
        feedback: { up: 118, down: 17 },
      });
    if (path.endsWith('/controls'))
      return json({
        settings: {
          'assistant.enabled': true,
          'assistant.monthly_budget_usd': '200.00',
          'assistant.daily_messages_per_user': 60,
          'assistant.portal_staff_enabled': true,
          'assistant.portal_seller_enabled': true,
          'assistant.portal_store_enabled': true,
          'assistant.portal_associate_enabled': false,
          'assistant.attachments_enabled': true,
          'assistant.monitor_enabled': false,
          'assistant.monitor_monthly_budget_usd': '50.00',
        },
      });
    if (path.endsWith('/reveal')) return json({ id: 'm4', blocks: [{ type: 'text', text: REAL }] });
    if (/conversations\/[^/]+$/.test(path)) return json(convo(false));
    if (path.endsWith('/conversations'))
      return json({
        total: 2,
        limit: 25,
        offset: 0,
        items: [
          {
            id: 'c1',
            portal: 'seller',
            title: null,
            preview: 'Where is order SD-100234? Call me on +91 98•••••606',
            language: 'en',
            user: 'Asha Rahman',
            account: 'Menev Store',
            questions: 3,
            attachments: 1,
            notices: 1,
            up: 0,
            down: 1,
            anonymised: false,
            createdAt: '2026-11-12T09:00:00Z',
            updatedAt: '2026-11-12T09:03:00Z',
          },
          {
            id: 'c2',
            portal: 'staff',
            title: null,
            preview: 'আমার ব্যালেন্স কত?',
            language: 'bn',
            user: 'ops@skydrop.test',
            account: null,
            questions: 1,
            attachments: 0,
            notices: 0,
            up: 1,
            down: 0,
            anonymised: false,
            createdAt: '2026-11-11T09:00:00Z',
            updatedAt: '2026-11-11T09:01:00Z',
          },
        ],
      });
    return json({});
  };
  return () => {
    window.fetch = real;
  };
}

export default function AiDevPage(): ReactElement | null {
  const [view, setView] = useState<string | null>(null);
  useEffect(() => {
    const undo = install();
    setView(new URLSearchParams(window.location.search).get('view') ?? 'dashboard');
    return undo;
  }, []);
  if (view === null) return null;
  return (
    <AuthProvider<StaffMe> identityKind="staff" initialIdentity={ME}>
      <QueryProvider>
        <ToastProvider>
          <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
            <AiShell>
              {view === 'billing' ? (
                <AiBilling />
              ) : view === 'controls' ? (
                <AiControls />
              ) : view === 'conversations' ? (
                <AiConversations />
              ) : view === 'detail' ? (
                <AiConversationDetail id="c1" />
              ) : (
                <AiDashboard />
              )}
            </AiShell>
          </div>
        </ToastProvider>
      </QueryProvider>
    </AuthProvider>
  );
}
