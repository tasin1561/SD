import type { ReactElement } from 'react';
import { Building2, Clock, Headset, Mail, MessageCircle, Phone, Warehouse } from 'lucide-react';
import { business, platform } from '@/content/site';
import { contact } from '@/content/sections/contact';
import { ContactLoader } from '@/components/islands/loaders/contact-loader';
import { RowLink } from '@/components/micro/list-row';
import { SectionHeading } from './section-heading';
import './sections.css';
import './contact.css';

/**
 * SECTION — Contact. The u25 form on the left, the ways to reach a person
 * on the right: three u21 rows for the channels that have a real link
 * behind them, and the two addresses as a static block.
 *
 * The offices are deliberately NOT rows. A `RowLink` is a control that
 * goes somewhere, and an address goes nowhere — the only href that would
 * fit is a third-party map search, which names a company this page does
 * not name and would point at a placeholder address besides. So they are
 * drawn with the row's chrome (icon chip, title, lines) and none of its
 * affordances: no chevron, no lift, no pointer.
 *
 * Every FIGURE here — the number, the hours, both addresses — is read
 * from `business`, where each is a `dummy()` until the owner supplies it.
 */
export function Contact(): ReactElement {
  const { channels, offices } = contact;
  const hours = `${contact.hoursLabel} ${business.hoursDays} · ${business.hoursTime} (${business.hoursZone} time)`;

  return (
    <section id="contact" className="sec sec--band" aria-labelledby="contact-h2">
      <div className="sec__inner safe-x sm:px-6">
        <SectionHeading
          id="contact-h2"
          hue="green"
          eyebrow={contact.eyebrow}
          icon={<Headset size={14} />}
          title={contact.title}
          sub={contact.sub}
        />

        <div className="ct" data-hue="green">
          <div className="ct__form sec-card">
            <ContactLoader toEmail={platform.brand.email} whatsappHref={business.whatsappHref} />
          </div>

          <div className="ct__aside">
            <section className="ct__block" aria-labelledby="contact-channels">
              <h3 id="contact-channels" className="ct__h3">
                {channels.heading}
              </h3>
              <p className="ct__hours">
                <Clock size={14} aria-hidden />
                {hours}
              </p>
              <ul className="ct__list">
                <li>
                  <RowLink
                    href={business.hotlineHref}
                    hue="green"
                    icon={<Phone size={16} />}
                    title={channels.hotline.title}
                    helper={
                      <>
                        <span className="ct__val tabular">{business.hotline}</span>
                        {` · ${channels.hotline.helper}`}
                      </>
                    }
                  />
                </li>
                <li>
                  <RowLink
                    href={business.whatsappHref}
                    target="_blank"
                    rel="noreferrer"
                    hue="green"
                    icon={<MessageCircle size={16} />}
                    title={channels.whatsapp.title}
                    helper={channels.whatsapp.helper}
                  />
                </li>
                <li>
                  <RowLink
                    href={`mailto:${platform.brand.email}`}
                    hue="teal"
                    icon={<Mail size={16} />}
                    title={channels.email.title}
                    helper={
                      <>
                        <span className="ct__val">{platform.brand.email}</span>
                        {` · ${channels.email.helper}`}
                      </>
                    }
                  />
                </li>
              </ul>
            </section>

            <section className="ct__block" aria-labelledby="contact-offices">
              <h3 id="contact-offices" className="ct__h3">
                {offices.heading}
              </h3>
              <ul className="ct__addrs">
                <li className="ct__addr">
                  <span className="ct__addr-chip" aria-hidden>
                    <Building2 size={16} />
                  </span>
                  <span className="ct__addr-text">
                    <span className="ct__addr-title">{offices.dhaka.title}</span>
                    <span className="ct__addr-line">{business.offices.dhakaLine1}</span>
                    <span className="ct__addr-line">{business.offices.dhakaLine2}</span>
                  </span>
                  <span className="ct__addr-meta">{offices.dhaka.meta}</span>
                </li>
                <li className="ct__addr">
                  <span className="ct__addr-chip" data-hue="teal" aria-hidden>
                    <Warehouse size={16} />
                  </span>
                  <span className="ct__addr-text">
                    <span className="ct__addr-title">{offices.india.title}</span>
                    <span className="ct__addr-line">{business.offices.indiaCity}</span>
                    <span className="ct__addr-line">{business.offices.indiaState}</span>
                  </span>
                  <span className="ct__addr-meta">{offices.india.meta}</span>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}
