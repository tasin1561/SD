import type { Guide } from '../knowledge.types';

const R = (file: string): string => `apps/reseller/src/i18n/messages/${file}.ts`;

/** Guides for a MEMBER STORE team member ("reseller" in code). */
export const STORE_GUIDES: readonly Guide[] = [
  {
    id: 'store-getting-started',
    audience: ['store'],
    title: 'Selling as a member store: catalogue and terms',
    summary: 'What you can sell, what you pay, and why you may not be able to place orders yet.',
    keywords: [
      'member store',
      'reseller',
      'catalogue',
      'catalog',
      'terms',
      'accept',
      'paused',
      'transfer price',
      'start',
    ],
    errorDomains: ['reseller-catalogue', 'reseller-store-terms', 'reseller-store'],
    sections: [
      {
        heading: 'What you sell',
        steps: [
          "You sell a client's stock under your own name. The client decides which of their products you may sell, what you pay for each, and the price range you may sell at.",
          'Your Catalogue lists the products the client lets you sell, what you pay for each, and how many are available.',
          "What you pay the client for each unit is the transfer price. The difference between it and the retail price you charge is yours, before your share of Skydrop's fees.",
          'If the catalogue is empty, the client has not turned any products on for your store. Ask them to.',
        ],
      },
      {
        heading: 'Terms must be accepted first',
        steps: [
          "The client publishes terms for your store: what Skydrop's fees are and when each of you is paid.",
          'Until the terms are published and accepted, your store cannot place orders.',
          'Accepting needs somebody at your store with the right to accept terms, such as an owner or admin.',
          'From the moment you accept, every order your store places is priced and paid under those terms.',
        ],
      },
      {
        heading: 'If your store is paused',
        steps: [
          'The client can pause your store. It takes no new orders until they resume it. Anything already placed carries on.',
        ],
      },
    ],
    sources: [R('catalogue'), R('terms'), R('dashboard')],
  },
  {
    id: 'store-create-orders',
    audience: ['store'],
    title: 'Placing and following a store order',
    summary: 'Pick products, set the price, choose COD or prepaid, and what happens next.',
    keywords: [
      'order',
      'new order',
      'cod',
      'prepaid',
      'wallet',
      'customer',
      'place order',
      'cancel',
      'waybill',
    ],
    errorDomains: ['reseller-order', 'store-order-request'],
    sections: [
      {
        heading: 'Place an order',
        steps: [
          "Go to Orders and choose New order. Placing an order starts from your store's catalogue.",
          'Pick products from your catalogue, set what you sell them for, and say who they are going to.',
          'Choose COD or prepaid.',
          'COD: the courier collects from your customer on the doorstep and the money comes back to you.',
          "Prepaid: your customer has already paid you. When the order is confirmed, your store wallet pays for the goods at the client's transfer price, plus your share of the delivery fee. If the wallet cannot cover it, the order is refused and nothing is placed.",
          "The order goes to Skydrop's call centre. They confirm it with the customer before it is packed.",
        ],
      },
      {
        heading: 'If you cannot place one',
        steps: [
          'Your role may not be able to open the catalogue. Ask an owner or admin of your store to change your role, or to place the order.',
          'Your store may not have accepted the terms, or the client may have paused your store.',
        ],
      },
      {
        heading: 'Following it',
        steps: [
          'No waybill shows until the call centre has confirmed the order with the customer.',
          'An order can be cancelled until it is packed. We do not tell the customer, so let them know yourself.',
          'Depending on your client, a cancel may go to Client staff to approve first. The order is not cancelled until they say yes.',
          'If a delivery fails, you can ask for another attempt, a call to the customer, or a return, only while the parcel is out for delivery or has just failed. What you can ask for is set by your client. Some requests go to the client first, and nothing happens to the parcel until they answer.',
        ],
      },
      {
        heading: 'Customer did not answer the calls',
        steps: [
          'When we run out of call attempts without reaching the customer, the order is either closed as unreachable or, if the account is set to be consulted, it waits under Unreachable customers (Call reviews) for a decision: keep trying, or give the stock back.',
          "Until you answer, the stock stays held and nothing is sent. Some stores' answers go to Client staff first.",
        ],
      },
    ],
    sources: [
      R('orderNew'),
      R('orderActions'),
      R('orderDetail'),
      R('callReviews'),
      'apps/associate/src/i18n/messages/orders.ts',
      R('terms'),
      R('dashboard'),
    ],
  },
  {
    id: 'store-associates',
    audience: ['store'],
    title: 'Associates: people who sell for your store',
    summary: 'Invite an associate, set their prices, and switch them off.',
    keywords: ['associate', 'invite', 'price', 'team', 'sales person', 'switch off', 'approve'],
    errorDomains: ['reseller-associates'],
    sections: [
      {
        heading: 'Add one',
        steps: [
          'An associate places orders for your store and sells at a price you set for them, product by product.',
          'Invite one. They get an email with a link to set up their login. It works for 7 days.',
          'They see only the orders they place and only the prices you set for them.',
          "Until you give them a price for a product, they cannot sell it. Set their prices from the associate's price list once they have signed in.",
        ],
      },
      {
        heading: 'Prices',
        steps: [
          'A price outside the range your client allows is refused on orders. Set one inside the range shown.',
          'Copying prices from one associate to another replaces every price the other person already has. The old figures are not kept, but the reply names each one.',
        ],
      },
      {
        heading: 'Switching someone off, and approvals',
        steps: [
          'Switching an associate off stops new orders only. Everything already placed carries on, and they can still follow, cancel and chase it.',
          'Some actions by an associate, such as a cancel, need your approval first. The order carries on until you answer.',
        ],
      },
    ],
    sources: [R('associates'), 'apps/associate/src/i18n/messages/orders.ts', 'docs/associates.md'],
  },
  {
    id: 'store-wallet',
    audience: ['store'],
    title: 'Store wallet',
    summary: 'How to top up your store wallet and what a prepaid order uses.',
    keywords: ['wallet', 'top up', 'topup', 'withdraw', 'balance', 'prepaid', 'money'],
    errorDomains: ['reseller-store-wallet'],
    sections: [
      {
        heading: 'Top up',
        steps: [
          "Skydrop manages this wallet. Send money to one of Skydrop's bank accounts, then tell us on the wallet page.",
          'Nothing is credited until Skydrop sees the money on its bank statement.',
          'Check the account number before you send. Money sent to the wrong one is very hard to get back.',
        ],
      },
      {
        heading: 'Where it is used',
        steps: [
          'A prepaid order is paid from this wallet when the order is confirmed. If the wallet cannot cover it, the order is refused and nothing is placed.',
          'To get money out, withdraw through Skydrop.',
        ],
      },
    ],
    sources: [R('wallet'), R('orderNew')],
  },
  {
    id: 'store-stuck',
    audience: ['store'],
    title: 'Stuck? Common situations for a member store',
    summary: 'Quick answers when you cannot place an order or open a page.',
    keywords: ['stuck', 'help', 'cannot', "can't", 'problem', 'permission', 'ticket'],
    sections: [
      {
        heading: 'I cannot place an order',
        steps: [
          'Check that the client has published terms for your store and that they are accepted.',
          'Check that your store is not paused.',
          'Check that the catalogue has products. The client turns products on.',
          'Check that your role can open the catalogue.',
        ],
      },
      {
        heading: 'I cannot open a page',
        steps: [
          'The page needs a permission your role does not have. Whoever runs your store can change that.',
        ],
      },
      {
        heading: 'Something is wrong with a parcel',
        steps: [
          'Open the order and raise an issue. Skydrop and your client read it and reply on the same thread.',
        ],
      },
    ],
    sources: [
      R('terms'),
      R('dashboard'),
      R('orderNew'),
      'apps/associate/src/i18n/messages/shell.ts',
      'apps/associate/src/i18n/messages/tickets.ts',
    ],
  },
];
