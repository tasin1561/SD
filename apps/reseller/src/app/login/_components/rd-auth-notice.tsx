import { CircleAlert, CircleCheck } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import './rd-auth.css';

/**
 * A notice inside a signed-out card: a refusal (`critical`, announced as
 * an alert) or a done state (`good`, announced as a status). The icon and
 * the words carry the tone; colour is never the only signal.
 */
export function AuthNotice({
  tone,
  role,
  children,
}: {
  readonly tone: 'critical' | 'good' | 'neutral';
  readonly role?: 'alert' | 'status' | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <p className="rd-auth-notice" data-tone={tone === 'neutral' ? undefined : tone} role={role}>
      {tone === 'critical' ? (
        <CircleAlert size={16} className="rd-auth-notice__icon" aria-hidden />
      ) : tone === 'good' ? (
        <CircleCheck size={16} className="rd-auth-notice__icon" aria-hidden />
      ) : null}
      {children}
    </p>
  );
}
