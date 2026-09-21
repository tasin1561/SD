import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { Nav } from '@/components/landing/nav';
import { SiteFooter } from '@/components/landing/site-footer';
import { FloatingContact } from '@/components/chrome/floating-contact';
import { MobileBottomBar } from '@/components/chrome/mobile-bottom-bar';

export const metadata: Metadata = {
  title: 'Privacy policy · Skydrop',
  alternates: { canonical: '/privacy' },
  description:
    'What information Skydrop handles to confirm, pack and deliver orders, who it is shared with, and how to reach us about it.',
};

const UPDATED = '15 September 2026';

/**
 * A real page, because the static host answers every unknown path with the
 * home page — a "privacy policy" link pointing anywhere else would have
 * shown the landing page. Written to say only what is true of the service
 * today; change it in the same commit as the practice it describes.
 */
export default function PrivacyPage(): ReactElement {
  return (
    <>
      <Nav />
      <main id="main" className="min-h-screen bg-surface pb-24 pt-10">
        <article className="mx-auto max-w-3xl px-5 sm:px-6">
          <div className="border-b border-line pb-7">
            <span className="mono-caps inline-flex items-center gap-2 rounded-sm border border-line bg-surface-band px-2.5 py-1.5 text-fg-muted">
              <span className="text-fg-strong">policy</span>
              <span aria-hidden className="text-fg-faint">
                {'//'}
              </span>
              <span>last updated {UPDATED}</span>
            </span>
            <h1
              className="mt-4 text-balance text-fg-strong"
              style={{ fontSize: 'clamp(1.9rem, 4vw, 2.6rem)', letterSpacing: '-0.03em' }}
            >
              Privacy policy
            </h1>
          </div>
          <p className="mt-6 text-[16px] leading-relaxed text-fg-body">
            Skydrop runs warehousing, order confirmation calls and courier dispatch for online
            sellers in Bangladesh who ship to customers in India. This page says what information we
            handle to do that, why, who we share it with, and how to reach us about it.
          </p>

          <Section title="What we collect">
            <ul>
              <li>
                <strong>Sellers and their teams:</strong> names, email addresses, phone numbers,
                company details, the bank details we pay you into, and what you do in the seller app
                — orders, products, stock and support tickets.
              </li>
              <li>
                <strong>Our sellers&rsquo; customers:</strong> name, phone number, delivery address,
                the items ordered and the amount to collect. Sellers give us these so we can confirm
                the order by phone and deliver it.
              </li>
              <li>
                <strong>People who request an invite:</strong> what you type into the form.
              </li>
              <li>
                <strong>Visitors to our websites:</strong> standard server logs — IP address,
                browser and time — kept for security.
              </li>
            </ul>
          </Section>

          <Section title="Why we use it">
            <ul>
              <li>
                To fulfil orders: call the customer to confirm, pick and pack the goods, hand them
                to a courier, track them, and handle returns.
              </li>
              <li>
                To run seller accounts, pay sellers what they are owed, and keep the records tax and
                accounting law requires.
              </li>
              <li>To keep the service secure and to answer your questions.</li>
            </ul>
            <p>
              We do not sell personal information, and we do not use our sellers&rsquo; customers
              for our own marketing.
            </p>
          </Section>

          <Section title="Who we share it with">
            <ul>
              <li>
                <strong>Couriers</strong> that carry a parcel — such as Delhivery, Shiprocket and
                the carriers they use — receive the delivery details they need to deliver it.
              </li>
              <li>
                <strong>The seller</strong> whose order it is.
              </li>
              <li>
                <strong>Providers that run our systems for us:</strong> DigitalOcean (servers,
                database and file storage, in Singapore and India), Cloudflare (network), Resend
                (email) and Google (encrypted backups, below).
              </li>
              <li>
                <strong>Authorities</strong>, when the law requires it.
              </li>
            </ul>
          </Section>

          <Section title="Google user data">
            <p>
              Skydrop uses its own Google app only to store Skydrop&rsquo;s encrypted backups in
              Skydrop&rsquo;s own Google Drive, with access limited to the files that app creates.
              It does not request, read or store anyone else&rsquo;s Google account data, and
              nothing it stores is shared with anyone.
            </p>
          </Section>

          <Section title="How long we keep it">
            <p>
              Order and account records are kept for as long as we need them to deliver, handle
              returns and disputes, and meet tax and accounting obligations, then deleted or
              anonymised. Backups expire on a fixed schedule and are kept no longer than 24 months.
            </p>
          </Section>

          <Section title="How we protect it">
            <p>
              Connections are encrypted, access inside Skydrop is limited by role, sensitive actions
              are logged, and backups are encrypted before they leave our servers.
            </p>
          </Section>

          <Section title="Your choices">
            <p>
              To see, correct or delete information we hold about you, write to{' '}
              <a
                href="mailto:hello@skydrop.online"
                className="text-fg-strong underline underline-offset-4"
              >
                hello@skydrop.online
              </a>
              . If you are a customer of one of our sellers, you can also ask the seller. We may
              have to keep some records the law requires.
            </p>
          </Section>

          <Section title="Changes">
            <p>
              We update this page when our practices change; the date at the top says when it last
              did.
            </p>
          </Section>
        </article>
      </main>
      <SiteFooter />
      <MobileBottomBar />
      <FloatingContact />
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="mt-10 border-t border-line pt-7">
      <h2 className="text-[20px] font-bold text-fg-strong sm:text-[22px]">{title}</h2>
      <div className="mt-3 space-y-4 text-[15px] leading-relaxed text-fg-body [&_a]:text-sky [&_li]:mt-2.5 [&_strong]:font-semibold [&_strong]:text-fg-strong [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
