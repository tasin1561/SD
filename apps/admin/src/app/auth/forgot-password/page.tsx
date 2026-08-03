import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { AuthConsoleHeader } from '@/components/auth-console/console-shell';
import { TiltPanel } from '@/lib/tilt';
import { ForgotPasswordForm } from './_components/forgot-form';

export const metadata: Metadata = { title: 'Reset your password · Skydrop Admin' };

/**
 * Step 1 of the staff password reset.
 *
 * The API and step 2 both existed; there was nowhere to begin. The login
 * page told staff to "contact your admin", which for the SUPER_ADMIN
 * reading it means contact yourself.
 */
export default function ForgotPasswordPage(): ReactElement {
  return (
    <>
      <AuthConsoleHeader label="reset access" />
      <TiltPanel max={3} className="boot-rise boot-rise-2">
        <div className="ticks relative overflow-hidden rounded-xl border border-border bg-surface p-6 sm:p-7">
          <div className="mb-3 flex items-center justify-between">
            <span className="telemetry" style={{ color: 'var(--sky)' }}>
              recovery
            </span>
            <span className="telemetry text-text-muted">staff only</span>
          </div>
          <h1 className="text-text-bright mb-1 text-lg font-semibold">Forgot your password?</h1>
          <p className="text-text-muted mb-6 text-sm">
            We will email you a link to set a new one. It expires in 30 minutes.
          </p>
          <ForgotPasswordForm />
          <div aria-hidden className="glow-follow" />
        </div>
      </TiltPanel>
    </>
  );
}
