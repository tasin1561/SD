import type { ReactElement } from 'react';
import Link from 'next/link';
import {
  Phone,
  Warehouse,
  Plane,
  ShieldCheck,
  RefreshCw,
  BarChart3,
  ArrowRight,
} from 'lucide-react';

/**
 * Public marketing site for Skydrop.
 *
 * Audience: Bangladeshi e-commerce sellers exploring whether to sell into
 * the Indian market. The page positions Skydrop as the operational
 * backbone (warehouse + call confirmation + courier dispatch + tracking)
 * so sellers don't need their own Indian operation.
 *
 * The site is intentionally invite-only — no public sign-up form. The
 * CTA "Request an invite" points to a mailto so we don't need a form
 * backend in Phase 1A; we can wire to a real seller-invite endpoint
 * later. (See Module 2 — onboarding is invite-driven.)
 */
export default function HomePage(): ReactElement {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <WhyUs />
        <FooterCta />
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader(): ReactElement {
  return (
    <header className="border-b border-border bg-bg/95 backdrop-blur sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
        <Link href="/" className="text-text-bright font-medium tracking-tight">
          Skydrop
        </Link>
        <nav className="flex items-center gap-5 text-text-muted text-xs">
          <a href="#how" className="hover:text-text-body transition-colors">
            How it works
          </a>
          <a href="#why" className="hover:text-text-body transition-colors">
            Why Skydrop
          </a>
          <a
            href="https://track.skydrop.online"
            className="hover:text-text-body transition-colors"
            target="_blank"
            rel="noopener"
          >
            Track a parcel
          </a>
          <a
            href="https://app.skydrop.online"
            className="text-accent hover:text-accent-hover transition-colors"
          >
            Seller sign-in
          </a>
        </nav>
      </div>
    </header>
  );
}

function Hero(): ReactElement {
  return (
    <section className="border-b border-border">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <div className="max-w-3xl">
          <div className="text-accent text-xs uppercase tracking-wider mb-4">
            Cross-border, hands-off
          </div>
          <h1 className="text-text-bright text-4xl md:text-5xl font-medium tracking-tight leading-[1.1]">
            Sell to India from Bangladesh,{' '}
            <span className="text-accent">without an Indian operation.</span>
          </h1>
          <p className="text-text-muted text-base md:text-lg mt-5 leading-relaxed">
            Skydrop holds your stock in India, confirms every order by phone
            (because COD culture demands it), and dispatches through Delhivery
            and backup couriers — so you just sell.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-8">
            <a
              href="mailto:hello@skydrop.online?subject=Seller invite request"
              className="bg-accent text-accent-fg hover:bg-accent-hover px-5 py-2.5 rounded-[6px] text-sm font-medium transition-colors inline-flex items-center gap-2"
            >
              Request an invite <ArrowRight size={14} />
            </a>
            <a
              href="https://track.skydrop.online"
              className="border border-border-strong text-text-bright hover:border-accent hover:text-accent px-5 py-2.5 rounded-[6px] text-sm transition-colors"
            >
              Track a parcel
            </a>
          </div>
          <div className="text-text-faint text-xs mt-6">
            Invite-only beta · BD → IN routes
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorks(): ReactElement {
  const steps = [
    {
      n: '01',
      icon: <Plane size={22} />,
      title: 'You ship stock to our India warehouse',
      body: 'Send inventory once. We receive it, batch it, and put it away in our WMS — bin-level, FIFO/FEFO ready.',
    },
    {
      n: '02',
      icon: <Phone size={22} />,
      title: 'We confirm every order by phone',
      body: 'When a customer orders, our call centre rings them — COD culture in India demands it. Re-attempted on no-answer; NDR-routed when uncontactable.',
    },
    {
      n: '03',
      icon: <Warehouse size={22} />,
      title: 'Pick, pack, dispatch — all here',
      body: 'Confirmed orders enter the pick queue. We dispatch via Delhivery (API-integrated), or manually place with a backup courier when Delhivery is non-serviceable.',
    },
    {
      n: '04',
      icon: <RefreshCw size={22} />,
      title: 'Tracking, NDR, RTO — handled',
      body: 'Webhook-driven live tracking, public AWB lookup for your customers, and RTO inspection at our warehouse. Stock writes back transparently.',
    },
  ];

  return (
    <section id="how" className="border-b border-border bg-surface/40">
      <div className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-accent text-xs uppercase tracking-wider mb-2">
          How it works
        </div>
        <h2 className="text-text-bright text-2xl md:text-3xl font-medium tracking-tight">
          Four steps, end-to-end.
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-10">
          {steps.map((s) => (
            <div
              key={s.n}
              className="border border-border rounded-[8px] p-6 bg-surface hover:border-border-strong transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="text-accent mt-0.5">{s.icon}</div>
                <div className="flex-1">
                  <div className="flex items-baseline gap-3 mb-1">
                    <span className="text-text-faint font-mono text-xs">
                      {s.n}
                    </span>
                    <span className="text-text-bright font-medium">
                      {s.title}
                    </span>
                  </div>
                  <p className="text-text-muted text-sm leading-relaxed">
                    {s.body}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhyUs(): ReactElement {
  const items = [
    {
      icon: <ShieldCheck size={20} />,
      title: 'Call-confirmed COD orders',
      body: 'Indian shoppers expect a confirmation call. Our agents log every attempt; orders that can\'t be reached are NDR-routed before dispatch — your RTO rate drops.',
    },
    {
      icon: <Warehouse size={20} />,
      title: 'A real WMS, not a spreadsheet',
      body: 'Bin-level inventory, batches with expiry, append-only stock ledger, low-stock alerts. Your stock\'s in good hands.',
    },
    {
      icon: <Plane size={20} />,
      title: 'Delhivery + backup couriers',
      body: 'Primary route via Delhivery\'s API. When PIN serviceability fails, we manually place with a backup courier and you never see it.',
    },
    {
      icon: <RefreshCw size={20} />,
      title: 'Transparent RTO handling',
      body: 'Returns inspected at our warehouse; you decide restock or write-off per item. Stock movements reconcile end-to-end.',
    },
    {
      icon: <BarChart3 size={20} />,
      title: 'Operational reports',
      body: 'Confirm-rate, NDR-rate, RTO-rate, dispatch times — the metrics you need to run an Indian D2C business from across the border.',
    },
    {
      icon: <Phone size={20} />,
      title: 'You stay in BD',
      body: 'No Indian office, no Indian staff, no Indian GST registration to start. We are the operational layer; you keep your brand and customer relationships.',
    },
  ];

  return (
    <section id="why" className="border-b border-border">
      <div className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-accent text-xs uppercase tracking-wider mb-2">
          Why Skydrop
        </div>
        <h2 className="text-text-bright text-2xl md:text-3xl font-medium tracking-tight">
          Built specifically for the BD → IN lane.
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-10">
          {items.map((it) => (
            <div
              key={it.title}
              className="border border-border rounded-[8px] p-5 bg-surface"
            >
              <div className="text-accent mb-3">{it.icon}</div>
              <div className="text-text-bright font-medium text-sm mb-1.5">
                {it.title}
              </div>
              <p className="text-text-muted text-xs leading-relaxed">
                {it.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FooterCta(): ReactElement {
  return (
    <section className="border-b border-border bg-surface/40">
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <h2 className="text-text-bright text-2xl md:text-3xl font-medium tracking-tight">
          Ready to ship into India?
        </h2>
        <p className="text-text-muted text-sm mt-3">
          Skydrop is currently invite-only. Tell us about your store and we'll
          get back to you within a working day.
        </p>
        <a
          href="mailto:hello@skydrop.online?subject=Seller invite request"
          className="bg-accent text-accent-fg hover:bg-accent-hover px-5 py-2.5 rounded-[6px] text-sm font-medium transition-colors inline-flex items-center gap-2 mt-6"
        >
          Request an invite <ArrowRight size={14} />
        </a>
      </div>
    </section>
  );
}

function SiteFooter(): ReactElement {
  return (
    <footer className="py-8">
      <div className="max-w-6xl mx-auto px-6 flex flex-wrap items-center justify-between gap-4 text-xs text-text-faint">
        <div>
          © {new Date().getFullYear()} Skydrop · BD → IN cross-border logistics
        </div>
        <nav className="flex items-center gap-5">
          <a
            href="https://track.skydrop.online"
            className="hover:text-text-body transition-colors"
          >
            Track a parcel
          </a>
          <a
            href="https://app.skydrop.online"
            className="hover:text-text-body transition-colors"
          >
            Seller sign-in
          </a>
          <a
            href="mailto:hello@skydrop.online"
            className="hover:text-text-body transition-colors"
          >
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
