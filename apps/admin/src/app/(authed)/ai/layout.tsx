import type { ReactElement, ReactNode } from 'react';
import { AiShell } from './_components/ai-shell';

export default function AiLayout({ children }: { children: ReactNode }): ReactElement {
  return <AiShell>{children}</AiShell>;
}
