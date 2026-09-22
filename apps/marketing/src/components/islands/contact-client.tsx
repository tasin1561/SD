'use client';

import { useRef, useState, type FormEvent, type MouseEvent, type ReactElement } from 'react';
import { Mail, User } from 'lucide-react';
import { TextArea, TextField, type FieldStatus } from '@/components/micro/text-field';
import { PhoneField } from '@/components/micro/phone-field';
import { ReactiveMascot } from '@/components/micro/reactive-mascot';
import { SweepLink } from '@/components/micro/sweep';
import { contact } from '@/content/sections/contact';

/**
 * u25 · The contact form.
 *
 * It does not submit, and it never pretends to. The site is a static
 * export whose only public endpoint takes invite leads from COMPANIES, so
 * a message from one person has nowhere to be posted. Both buttons are
 * LINKS: one composes a `mailto:` and one a `wa.me` deep link, each
 * carrying what has been typed. There is no busy state and no success
 * card — the storytelling is hover-only (the label drops into the parcel,
 * the green button sweeps) because a link navigates at once and a
 * pretend-send is the one thing this section must not do.
 *
 * Validation is STAGED: a field goes green the moment it is valid, and
 * only turns red once it has been left AND holds something malformed.
 * Nothing is refused — neither address is required for an email client to
 * open — so the pair carries a plain line saying one of the two is enough
 * rather than a blocking error.
 *
 * The phone is read from the DOM at press time rather than held in state:
 * `PhoneField` owns its own country + number and publishes the full value
 * on a hidden input, so the form element is the only place the composed
 * "+880 1712 345678" exists. The `href` on each button is built from the
 * other three fields, which keeps a right-click-copy and a no-JS render
 * honest; the press adds the phone.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface Composed {
  subject: string;
  body: string;
}

/** The message as the recipient will read it — never blank. */
export function composeMessage(fields: {
  name: string;
  email: string;
  phone: string;
  message: string;
}): Composed {
  const c = contact.form;
  const name = fields.name.trim();
  const lines: string[] = [fields.message.trim() || c.bodyFallback, ''];
  if (name) lines.push(`${c.bodyLabels.name}: ${name}`);
  if (fields.email.trim()) lines.push(`${c.bodyLabels.email}: ${fields.email.trim()}`);
  if (fields.phone.trim()) lines.push(`${c.bodyLabels.phone}: ${fields.phone.trim()}`);
  return { subject: name ? `${c.subject} — ${name}` : c.subject, body: lines.join('\n') };
}

/** `https://wa.me/8801000000000` → `8801000000000`. */
export function whatsappNumber(href: string): string {
  const base = href.split('?')[0] ?? href;
  const tail = base.split('/').filter(Boolean).pop() ?? '';
  return tail.replace(/\D/g, '');
}

export function ContactClient({
  toEmail,
  whatsappHref,
}: {
  toEmail: string;
  whatsappHref: string;
}): ReactElement {
  const c = contact.form;
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [left, setLeft] = useState<Record<string, boolean>>({});

  const leave = (key: string): void => setLeft((l) => (l[key] ? l : { ...l, [key]: true }));

  /** Green as soon as it is right; red only once left behind and wrong. */
  const stage = (key: string, value: string, ok: boolean): FieldStatus => {
    if (ok) return 'success';
    return left[key] && value.trim() ? 'error' : 'idle';
  };

  const nameStatus = stage('name', name, name.trim().length >= 2);
  const emailStatus = stage('email', email, EMAIL.test(email.trim()));
  const messageStatus = stage('message', message, message.trim().length >= 12);

  /** The hidden input `PhoneField` publishes — the only composed phone value. */
  const readPhone = (): string => {
    const el = formRef.current?.elements.namedItem('phone');
    return el instanceof HTMLInputElement ? el.value.trim() : '';
  };

  const mailto = (phone: string): string => {
    const { subject, body } = composeMessage({ name, email, phone, message });
    return `mailto:${toEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const whatsapp = (phone: string): string => {
    const { subject, body } = composeMessage({ name, email, phone, message });
    const number = whatsappNumber(whatsappHref);
    const text = encodeURIComponent(`${subject}\n\n${body}`);
    return number ? `https://wa.me/${number}?text=${text}` : whatsappHref;
  };

  const openEmail = (e: FormEvent | MouseEvent): void => {
    e.preventDefault();
    window.location.href = mailto(readPhone());
  };

  const openWhatsapp = (e: MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    window.open(whatsapp(readPhone()), '_blank', 'noopener,noreferrer');
  };

  return (
    <form ref={formRef} className="ct__form-body" onSubmit={openEmail} noValidate>
      <div className="ct__form-top">
        <h3 className="ct__form-h">{c.heading}</h3>
        {/* Pattern 13: eyes follow the caret; beams once the message is ready to send. */}
        <ReactiveMascot
          watch={formRef}
          mood={messageStatus === 'success' && emailStatus === 'success' ? 'happy' : 'neutral'}
        />
      </div>

      <div className="ct__grid">
        <TextField
          label={c.name.label}
          name="name"
          icon={<User size={15} />}
          autoComplete="name"
          value={name}
          status={nameStatus}
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={() => leave('name')}
          {...(nameStatus === 'error' ? { error: c.name.error } : { helper: c.name.helper })}
        />
        <TextField
          label={c.email.label}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          icon={<Mail size={15} />}
          value={email}
          status={emailStatus}
          onChange={(e) => setEmail(e.currentTarget.value)}
          onBlur={() => leave('email')}
          {...(emailStatus === 'error' ? { error: c.email.error } : { helper: c.email.helper })}
        />
      </div>

      <PhoneField name="phone" label={c.phone.label} helper={c.phone.helper} />

      <p className="ct__either">{c.either}</p>

      <TextArea
        label={c.message.label}
        name="message"
        rows={4}
        maxLength={c.messageMax}
        counter
        value={message}
        status={messageStatus}
        onChange={(e) => setMessage(e.currentTarget.value)}
        onBlur={() => leave('message')}
        {...(messageStatus === 'error' ? { error: c.message.error } : { helper: c.message.helper })}
      />

      <p className="ct__reassure">{c.reassurance}</p>

      <div className="ct__actions">
        <SweepLink className="ct__email" href={mailto('')} onClick={openEmail}>
          {c.emailCta}
        </SweepLink>
        <SweepLink
          tone="green"
          href={whatsapp('')}
          onClick={openWhatsapp}
          target="_blank"
          rel="noreferrer"
        >
          {c.whatsappCta}
        </SweepLink>
      </div>

      <p className="ct__note">{c.note}</p>
    </form>
  );
}
