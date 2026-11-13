'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactElement, ReactNode } from 'react';
import {
  BarChart3,
  Eye,
  Lightbulb,
  MessagesSquare,
  ReceiptText,
  SlidersHorizontal,
} from 'lucide-react';
import { Tabs } from '@skydrop/ui/app/tabs';
import { useT } from '@/i18n/client';
import { usePermission } from '@/lib/use-permission';
import { AcHeader, AcPage } from '../../settings/_components/ac-parts';
import '../ai.css';

/** The AI control panel frame: title, route tabs, and the one-line privacy note. */
export function AiShell({ children }: { readonly children: ReactNode }): ReactElement {
  const t = useT();
  const path = usePathname() ?? '';
  const mayRead = usePermission('assistant.conversations.read');
  const active = path.startsWith('/ai/billing')
    ? 'billing'
    : path.startsWith('/ai/conversations')
      ? 'conversations'
      : path.startsWith('/ai/monitor')
        ? 'monitor'
        : path.startsWith('/ai/recommendations')
          ? 'recommendations'
          : path.startsWith('/ai/controls')
            ? 'controls'
            : 'dashboard';
  return (
    <AcPage>
      <AcHeader title={t('ai.title')} subtitle={t('ai.subtitle')} />
      <Tabs
        label={t('ai.tabs')}
        size="sm"
        Link={Link}
        value={active}
        items={[
          {
            id: 'dashboard',
            label: t('ai.tab.dashboard'),
            href: '/ai',
            icon: <BarChart3 size={14} />,
          },
          {
            id: 'billing',
            label: t('ai.tab.billing'),
            href: '/ai/billing',
            icon: <ReceiptText size={14} />,
          },
          ...(mayRead
            ? [
                {
                  id: 'conversations',
                  label: t('ai.tab.conversations'),
                  href: '/ai/conversations',
                  icon: <MessagesSquare size={14} />,
                },
              ]
            : []),
          {
            id: 'monitor',
            label: t('ai.tab.monitor'),
            href: '/ai/monitor',
            icon: <Eye size={14} />,
          },
          {
            id: 'recommendations',
            label: t('ai.tab.recommendations'),
            href: '/ai/recommendations',
            icon: <Lightbulb size={14} />,
          },
          {
            id: 'controls',
            label: t('ai.tab.controls'),
            href: '/ai/controls',
            icon: <SlidersHorizontal size={14} />,
          },
        ]}
      />
      {children}
    </AcPage>
  );
}
