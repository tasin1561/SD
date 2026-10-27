'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { AccessTokenStore, ApiClient } from '@skydrop/api-client';
import { Mail, Send } from 'lucide-react';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { OtherPortals } from '@skydrop/ui/app/sign-in';
import { TextField } from '@skydrop/ui/app/text-field';
import { AuthFrame } from '@/components/auth-frame';
import { useLocale, useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import { AuthNotice } from '../login/_components/rd-auth-notice';

/**
 * Ask for a reset link. The API answers the same whether or not the email
 * has a login, so this page says the same thing either way.
 */
export default function PasswordResetRequestPage(): ReactElement {
  const t = useT();
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setState('sending');
    setError(null);
    try {
      const client = new ApiClient({ identityKind: 'store', tokenStore: new AccessTokenStore() });
      await client.request('/api/auth/store/password-reset/request', {
        method: 'POST',
        body: { email: email.trim() },
        suppressRefresh: true,
      });
      setState('sent');
    } catch (err) {
      setError(verdict(err, t));
      setState('idle');
    }
  }

  return (
    <AuthFrame
      section="recovery"
      note="step 1 of 2"
      title={t('auth.reset.request.title')}
      subtitle={t('auth.reset.request.subtitle')}
      footer={
        <>
          <a href="/login">{t('auth.reset.request.back')}</a>
          {/*
           * The chooser matters more here than on /login. The API answers
           * a reset request identically whether or not the email has a
           * login here (anti-enumeration), so somebody in the wrong
           * console is told a link is on its way and then gets nothing —
           * a dead end that reads as success and teaches them to wait.
           */}
          <OtherPortals self="store" title={t('auth.reset.request.elsewhere')} locale={locale} />
        </>
      }
    >
      {state === 'sent' ? (
        <AuthNotice tone="good" role="status">
          {t('auth.reset.request.sent')}
        </AuthNotice>
      ) : (
        <form
          // A refusal belongs to the value that earned it: any edit retires
          // it, so a stale error cannot sit under a field that already fixed it.
          onInput={() => setError(null)}
          onSubmit={submit}
          className="rd-auth-form"
        >
          <TextField
            id="email"
            type="email"
            label={t('auth.reset.request.email')}
            icon={<Mail size={15} />}
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {error !== null ? (
            <AuthNotice tone="critical" role="alert">
              {error}
            </AuthNotice>
          ) : null}
          <AsyncButton
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            icon={<Send size={15} />}
            labels={{
              idle: t('auth.reset.request.send'),
              busy: t('auth.reset.request.sending'),
              error: t('auth.reset.request.notSent'),
            }}
            state={state === 'sending' ? 'busy' : error !== null ? 'error' : 'idle'}
            disabled={state === 'sending'}
          />
        </form>
      )}
    </AuthFrame>
  );
}
