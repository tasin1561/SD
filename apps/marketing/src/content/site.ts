import { dummy } from './dummy';

/**
 * Site content, in one place.
 *
 * `platform` is what the PRODUCT does — read from the code base, true by
 * construction, and NEVER wrapped in `dummy()` (the scanner refuses it).
 * `business` is what the COMPANY says about itself — volumes, prices,
 * partners, people, places — and every value there is a `dummy()` until
 * the owner supplies the real one.
 *
 * Copy lives here rather than inline in components so a section can be
 * rewritten without touching its markup, and so the Bengali locale can
 * be added by adding a second object of the same shape.
 */

export const platform = {
  brand: {
    name: 'Skydrop',
    domain: 'skydrop.online',
    tagline: 'Sell in India. We carry the rest.',
    corridor: 'Bangladesh ⇄ India',
    email: 'hello@skydrop.online',
    apps: {
      seller: 'https://app.skydrop.online',
      store: 'https://reseller.skydrop.online',
      track: 'https://track.skydrop.online',
    },
  },
  nav: {
    primary: [
      { href: '/#services', label: 'Services' },
      { href: '/#platform', label: 'Platform' },
      { href: '/#resellers', label: 'Reseller stores' },
      { href: '/#pricing', label: 'Pricing' },
      { href: '/#faq', label: 'FAQ' },
    ],
    signIn: [
      { href: 'https://app.skydrop.online/login', label: 'Seller sign-in' },
      { href: 'https://reseller.skydrop.online/login', label: 'Store sign-in' },
    ],
    cta: { href: '/request-invite', label: 'Request an invite' },
    track: { href: 'https://track.skydrop.online', label: 'Track a parcel' },
  },
  /** What ships, in the seller's own words — never more than the app does. */
  capabilities: [
    'Stock held in our Indian warehouse, counted on arrival',
    'Every COD order confirmed by phone before it ships',
    'Picked, packed and handed to the courier the same day',
    'Live tracking from our scan to the customer’s door',
    'Returns received, inspected unit by unit, restocked or written off',
    'Your money itemised: COD collected, charges, freight, payouts',
    'Reseller stores that sell your stock under their own name',
  ],
  footer: {
    columns: [
      {
        title: 'Service',
        links: [
          { href: '/#services', label: 'Send to India' },
          { href: '/#services', label: 'Send to Bangladesh' },
          { href: '/#platform', label: 'The seller platform' },
          { href: '/#resellers', label: 'Reseller stores' },
          { href: '/#pricing', label: 'Pricing' },
        ],
      },
      {
        title: 'Access',
        links: [
          { href: '/request-invite', label: 'Request an invite' },
          { href: 'https://app.skydrop.online/login', label: 'Seller sign-in', external: true },
          { href: 'https://reseller.skydrop.online/login', label: 'Store sign-in', external: true },
          { href: 'https://track.skydrop.online', label: 'Track a parcel', external: true },
        ],
      },
      {
        title: 'Company',
        links: [
          { href: 'mailto:hello@skydrop.online', label: 'hello@skydrop.online' },
          { href: '/#contact', label: 'Contact' },
          { href: '/privacy', label: 'Privacy' },
        ],
      },
    ],
    legal: '© 2026 Skydrop · cross-border fulfilment, Bangladesh ⇄ India',
  },
} as const;

export const business = {
  /** Utility bar. Hours are shown in the visitor's words; the zone is stated. */
  hotline: dummy('+880 1XXX-XXXXXX'),
  hotlineHref: dummy('tel:+8801000000000'),
  whatsappHref: dummy('https://wa.me/8801000000000'),
  hours: dummy('Sat–Thu · 10:00–19:00 (Dhaka)'),
  /** Hero trust row + KPI card. Real figures replace these. */
  stats: [
    { value: dummy('18,240'), label: 'parcels delivered' },
    { value: dummy('96%'), label: 'confirmed before dispatch' },
    { value: dummy('4–7 days'), label: 'Dhaka to an Indian doorstep' },
  ],
  trustLine: dummy('Trusted by 120+ Bangladeshi sellers'),
  /** Estimator slabs — ILLUSTRATIVE until the owner supplies the rate card. */
  estimator: {
    currency: dummy('BDT'),
    slabs: dummy([
      { upToKg: 0.5, priceBdt: 450 },
      { upToKg: 1, priceBdt: 650 },
      { upToKg: 2, priceBdt: 950 },
      { upToKg: 5, priceBdt: 1800 },
    ]),
    codFeePercent: dummy(1),
    note: 'Estimated. Your quote is agreed before anything ships.',
  },
  /** Serviceability — a list shaped for a real endpoint later. */
  serviceability: {
    indiaPinPrefixes: dummy(['1', '2', '3', '4', '5', '6', '7', '8']),
    bdPostcodePrefixes: dummy(['1', '2', '3', '4', '5', '6', '7', '8', '9']),
    transitDaysIndia: dummy('4–7 days'),
    transitDaysBangladesh: dummy('3–5 days'),
  },
  partners: dummy(['Delhivery', 'Shiprocket', 'Blue Dart', 'DTDC', 'Ekart', 'Xpressbees']),
  testimonials: dummy([
    {
      quote: 'Our returns dropped once every order was confirmed by phone first.',
      name: 'Rahim Uddin',
      company: 'Dhaka Threads',
    },
    {
      quote: 'I see the parcel, the call and the money in one place.',
      name: 'Nusrat Jahan',
      company: 'Nusrat Beauty',
    },
  ]),
  offices: {
    dhaka: dummy('Mirpur DOHS, Dhaka 1216'),
    india: dummy('Bengaluru, Karnataka'),
  },
} as const;

/** Feature switches for things with no endpoint yet. A switch that is off renders NOTHING. */
export const features = {
  newsletter: false,
} as const;

export const site = { platform, business, features } as const;
