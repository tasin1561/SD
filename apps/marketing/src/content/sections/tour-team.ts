import type { TourVignetteContent } from './tour-types';

/**
 * Tour vignette 6 · Your team (blue).
 *
 * Words are the seller app's own: "Member register" and "Owners and
 * admins can change roles or remove members" from `/team`; "A role is a
 * set of permissions" from `/team/roles`, whose tick-boxes read "See
 * orders", "Place an order" and "Cancel an order" verbatim from the
 * seller permission catalogue; "What reaches you — your own choices,
 * for your own inbox" and "The company's email — applies to everyone
 * here, not only you" from `/notifications/settings`, with its topic
 * labels ("Order dispatched", "Delivery attempt failed") and its
 * category labels ("Order updates", "Stock alerts"); and "Your limits ·
 * Set by Skydrop — shown so a limit is never a surprise", closing on
 * "Ask us if one of these looks wrong for your account", from the wallet
 * limits page.
 *
 * The four limit rows are the settings' own display names — "Delivery
 * Fee — currency", "Who picks the courier", "Call Attempts Before NDR"
 * and the wallet panel's "COD credited" — in the panel's sentence case.
 *
 * Nothing here is a business figure, so nothing here is a `dummy()`.
 * The sample names, the four limit VALUES and the toggle states live in
 * the mock beside it, inside the frame's `aria-hidden` box, and are
 * plainly illustrative — one company's settings, never a rate, an
 * average or a volume.
 */
export const tourTeam: TourVignetteContent = {
  id: 'team',
  hue: 'blue',
  tab: 'Your team',
  title: 'Run it with your team',
  promise:
    'Bring in the people who work on this, give each role exactly the permissions it needs, let everybody choose what reaches their own inbox — and read every term we have set for your account without having to ask.',
  checklist: [
    {
      id: 'register',
      text: 'Your team with roles — a role is a set of permissions',
      beat: 'register',
    },
    {
      id: 'inbox',
      text: 'An inbox plus email — each person silences topics for their own inbox, the company decides its email',
      beat: 'inbox',
    },
    {
      id: 'limits',
      text: 'Terms set for your account — fee currency, courier choice, call-attempt cap, credit timing — always visible to you',
      beat: 'limits',
    },
  ],
  beats: [
    {
      id: 'register',
      ms: 2200,
      caption:
        'Everybody who works on this, each on a role — and a role is simply the permissions it carries.',
    },
    {
      id: 'inbox',
      ms: 2000,
      caption:
        'One page, two decisions: what reaches your own inbox, and what this company is emailed about.',
    },
    {
      id: 'limits',
      ms: 2100,
      caption:
        'Every term we have set for your account, written down — so a limit is never a surprise.',
    },
  ],
};
