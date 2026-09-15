import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { Nav } from '@/components/landing/nav';
import { SiteFooter } from '@/components/landing/site-footer';

export const metadata: Metadata = {
  title: 'Privacy policy · Skydrop',
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
      <main id="main" className="bg-surface min-h-screen pt-12 pb-24">
        <article className="mx-auto max-w-3xl px-5 sm:px-8">
          <p className="telemetry text-fg-muted">Last updated {UPDATED}</p>
          <h1 className="font-display mt-3 text-4xl font-semibold text-balance text-fg-strong sm:text-5xl">
            Privacy policy
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-fg-muted">
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
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="mt-12 border-t border-line pt-8">
      <h2 className="font-display text-2xl font-semibold text-fg-strong">{title}</h2>
      <div className="mt-4 space-y-4 leading-relaxed text-fg-muted [&_li]:mt-3 [&_strong]:text-fg-strong [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
