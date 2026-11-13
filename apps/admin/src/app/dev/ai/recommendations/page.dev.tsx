'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { AuthProvider } from '@skydrop/auth/client';
import type { StaffMe } from '@skydrop/api-client';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { LocaleProvider } from '@skydrop/ui/app/i18n-client';
import type { Locale } from '@skydrop/ui/app/i18n';
import { QueryProvider } from '@/components/query-provider';
import { AiShell } from '@/app/(authed)/ai/_components/ai-shell';
import { AiRecommendations } from '@/app/(authed)/ai/_components/ai-recommendations';
import '@skydrop/ui/brand/scales.css';
import '@skydrop/ui/brand/theme.css';
import '@skydrop/ui/brand/app.css';

/**
 * /dev/ai/recommendations — the recommendations tab against MOCKED data.
 * DEV ONLY (`page.dev.tsx` compiles only under APPS_DEV_ROUTES=1).
 * `?theme=light|dark  ?locale=en|bn|hi  ?open=1` (opens the first two cards).
 * `window.fetch` is replaced for `/api/admin/assistant-recommendations*` only.
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

const cid = (n: number): string =>
  `0191a000-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;
const side = (status: 'pass' | 'fail' | 'error', detail = '') => ({
  status,
  detail,
  answer: '',
  tools: [],
  retried: false,
});
const row = (
  id: string,
  language: string,
  question: string,
  live: 'pass' | 'fail',
  draft: 'pass' | 'fail',
  detail = '',
) => ({
  id,
  audience: 'seller',
  language,
  kind: 'where',
  question,
  live: side(live),
  draft: side(draft, detail),
  outcome:
    live === 'pass'
      ? draft === 'pass'
        ? ('same_pass' as const)
        : ('regressed' as const)
      : draft === 'pass'
        ? ('improved' as const)
        : ('same_fail' as const),
});
const GREEN = [
  row('seller-wallet-balance-en', 'en', 'Where can I see my wallet balance?', 'pass', 'pass'),
  row(
    'seller-wallet-balance-bn',
    'bn',
    'আমার ওয়ালেটের ব্যালেন্স আমি কোথায় দেখব?',
    'pass',
    'pass',
  ),
  row('seller-cod-remittance-hinglish', 'hinglish', 'COD ka paisa kab milega?', 'fail', 'pass'),
  row('seller-create-order-en', 'en', 'How do I create a new order?', 'pass', 'pass'),
  row('staff-error-code-en', 'en', 'What does ORDER_NOT_FOUND mean?', 'pass', 'pass'),
];
const RED = [
  ...GREEN.slice(0, 2),
  row(
    'seller-create-order-hi',
    'hi',
    'मैं नया ऑर्डर कैसे बनाऊँ?',
    'pass',
    'fail',
    'missing link: /orders/new',
  ),
  ...GREEN.slice(3),
];

const checkBase = {
  startedAt: '2026-11-13T09:00:00Z',
  finishedAt: '2026-11-13T09:07:00Z',
  note: null,
};
const items = [
  {
    id: 'r1',
    kind: 'KNOWLEDGE',
    status: 'NEW',
    title: 'Explain when COD money reaches the wallet',
    problem: 'Clients keep asking when COD money is paid out and the assistant could not say.',
    theme: { kind: 'knowledge_gap', label: 'cod remittance timing' },
    evidence: [cid(1), cid(2), cid(3)],
    knowledge: {
      target: 'guide',
      audiences: ['seller'],
      guideId: null,
      title: 'COD payout timing',
      summary: 's',
      sections: [],
    },
    diff: {
      before:
        'Wallet\nWhere you see your balance.\n## Balance\n- Open Wallet.\n- Read the balance card.',
      after:
        'Wallet\nWhere you see your balance and COD payouts.\n## Balance\n- Open Wallet.\n- Read the balance card.\n## COD payouts\n- Open Wallet and read the COD lines.\n- A line appears once the courier remits the amount.',
      isEdit: true,
    },
    system: null,
    task: null,
    githubIssueUrl: null,
    liveVersionId: null,
    createdAt: '2026-11-13T02:40:00Z',
    check: {
      id: 'k1',
      status: 'DONE',
      passed: true,
      total: 5,
      regressions: 0,
      stale: false,
      ...checkBase,
      results: GREEN,
    },
  },
  {
    id: 'r2',
    kind: 'KNOWLEDGE',
    status: 'NEW',
    title: 'Tell staff where the pack bench is',
    problem: 'Staff ask where to pack a parcel; the assistant sends them to the wrong page.',
    theme: { kind: 'ui_confusion', label: '/warehouse/pack' },
    evidence: [cid(4)],
    knowledge: { target: 'prompt_addendum', audiences: ['staff'], text: 't' },
    diff: {
      before: null,
      after: 'When asked where to pack a parcel, point to the Pack bench under Warehouse.',
      isEdit: false,
    },
    system: null,
    task: null,
    githubIssueUrl: null,
    liveVersionId: null,
    createdAt: '2026-11-13T02:41:00Z',
    check: {
      id: 'k2',
      status: 'DONE',
      passed: false,
      total: 5,
      regressions: 1,
      stale: false,
      ...checkBase,
      results: RED,
    },
  },
  {
    id: 'r3',
    kind: 'SYSTEM',
    status: 'NEW',
    title: 'Show the failed-delivery reason on the order list',
    problem: 'People open every order to find out why a delivery failed, then ask the assistant.',
    theme: { kind: 'ui_confusion', label: '/orders' },
    evidence: [cid(5), cid(6)],
    knowledge: null,
    diff: null,
    system: {
      suggestedChange: 'Add a short reason chip to rows whose status is delivery failed.',
      acceptanceCheck: 'A failed-delivery order shows its reason on /orders without opening it.',
    },
    task:
      'Task: Show the failed-delivery reason on the order list\n\nProblem\nPeople open every order to find out why a delivery failed.\n\nEvidence (assistant conversation ids; open them in the AI panel conversation explorer)\n- ' +
      cid(5) +
      '\n- ' +
      cid(6) +
      '\n\nSuggested change\nAdd a short reason chip to rows whose status is delivery failed.\n\nAcceptance check\nA failed-delivery order shows its reason on /orders without opening it.',
    githubIssueUrl: null,
    liveVersionId: null,
    createdAt: '2026-11-13T02:42:00Z',
    check: null,
  },
  {
    id: 'r4',
    kind: 'KNOWLEDGE',
    status: 'LIVE',
    title: 'Define “pickup request” for sellers',
    problem: 'The term was unexplained.',
    theme: { kind: 'knowledge_gap', label: 'pickup request' },
    evidence: [cid(7)],
    knowledge: {
      target: 'glossary',
      audiences: ['seller'],
      term: 'Pickup request',
      meaning: 'm',
      example: 'e',
    },
    diff: {
      before: null,
      after:
        'Pickup request: A request for the courier to collect parcels. Example: Ask for a pickup at 4 pm.',
      isEdit: false,
    },
    system: null,
    task: null,
    githubIssueUrl: null,
    liveVersionId: 'v2',
    createdAt: '2026-11-12T02:40:00Z',
    check: {
      id: 'k4',
      status: 'DONE',
      passed: true,
      total: 5,
      regressions: 0,
      stale: false,
      ...checkBase,
      results: GREEN,
    },
  },
];

function install(): () => void {
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const u = new URL(url, window.location.origin);
    if (!u.pathname.startsWith('/api/admin/assistant-recommendations')) return real(input, init);
    const json = (v: unknown): Response =>
      new Response(JSON.stringify(v), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    if (u.pathname.endsWith('/versions'))
      return json({
        liveVersionId: 'v2',
        versions: [
          {
            id: 'v2',
            number: 2,
            parentVersionId: 'v1',
            recommendationId: 'r4',
            createdAt: '2026-11-12T09:00:00Z',
            live: true,
            counts: { guides: 0, glossary: 1, addenda: 1 },
            wentLiveAt: '2026-11-12T09:10:00Z',
          },
          {
            id: 'v1',
            number: 1,
            parentVersionId: null,
            recommendationId: 'r0',
            createdAt: '2026-11-10T09:00:00Z',
            live: false,
            counts: { guides: 0, glossary: 0, addenda: 1 },
            wentLiveAt: '2026-11-10T09:10:00Z',
          },
        ],
        changes: [
          {
            id: 'c2',
            action: 'GO_LIVE',
            fromVersionId: 'v1',
            toVersionId: 'v2',
            createdAt: '2026-11-12T09:10:00Z',
          },
          {
            id: 'c1',
            action: 'GO_LIVE',
            fromVersionId: null,
            toVersionId: 'v1',
            createdAt: '2026-11-10T09:10:00Z',
          },
        ],
      });
    const m = /assistant-recommendations\/([^/]+)$/.exec(u.pathname);
    if (m !== null && m[1] !== 'versions')
      return json(items.find((i) => i.id === m[1]) ?? items[0]);
    const status = u.searchParams.get('status');
    const shown = status === null ? items : items.filter((i) => i.status.toLowerCase() === status);
    return json({
      liveVersionId: 'v2',
      githubAvailable: false,
      counts: { NEW: 3, LIVE: 1, APPROVED: 0, REJECTED: 2, ROLLED_BACK: 0 },
      items: shown.map(({ check, ...rest }) => ({
        ...rest,
        check: check === null ? null : { ...check, results: undefined },
      })),
    });
  };
  return () => {
    window.fetch = real;
  };
}

export default function AiRecommendationsDevPage(): ReactElement | null {
  const [ready, setReady] = useState(false);
  const [locale, setLocale] = useState<Locale>('en');
  useEffect(() => {
    const undo = install();
    const p = new URLSearchParams(window.location.search);
    const l = p.get('locale');
    if (l === 'bn' || l === 'hi' || l === 'en') setLocale(l);
    document.documentElement.dataset['theme'] = p.get('theme') === 'dark' ? 'dark' : 'light';
    setReady(true);
    if (p.get('open') === '1') {
      window.setTimeout(() => {
        document.querySelectorAll<HTMLButtonElement>('.ai-rec__head').forEach((b, i) => {
          if (i < 2) b.click();
        });
      }, 900);
    }
    return undo;
  }, []);
  if (!ready) return null;
  return (
    <LocaleProvider locale={locale}>
      <AuthProvider<StaffMe> identityKind="staff" initialIdentity={ME}>
        <QueryProvider>
          <ToastProvider>
            <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
              <AiShell>
                <AiRecommendations />
              </AiShell>
            </div>
          </ToastProvider>
        </QueryProvider>
      </AuthProvider>
    </LocaleProvider>
  );
}
