import type { Guide } from '../knowledge.types';

const A = (file: string): string => `apps/associate/src/i18n/messages/${file}.ts`;

/** Guides for an ASSOCIATE: a person who sells for a member store. */
export const ASSOCIATE_GUIDES: readonly Guide[] = [
  {
    id: 'associate-selling',
    audience: ['associate'],
    title: 'Selling as an associate',
    summary: 'Find what you can sell, and place an order for a customer.',
    keywords: [
      'associate',
      'sell',
      'catalogue',
      'catalog',
      'price',
      'new order',
      'order',
      'csv',
      'upload',
    ],
    errorDomains: ['reseller-order', 'reseller-associates'],
    sections: [
      {
        heading: 'What you can sell',
        steps: [
          'What I sell lists the products your store has given you, what you sell each for, and how many are left.',
          'Your store sets these prices. You cannot change a price when you place an order.',
          'A product with no price set for you cannot go on an order. Ask whoever runs your store to set one.',
          'If the list is empty, your store has not given you any products yet.',
        ],
      },
      {
        heading: 'Place an order',
        steps: [
          'Choose New order. Pick what your customer is buying and say where it is going.',
          "The order goes to Skydrop's call centre. They ring the customer to confirm it before it is packed.",
          'To place many orders at once, use Upload a CSV.',
          'If your store is switched off for new orders, you can still read, track and follow up everything you already placed.',
        ],
      },
    ],
    sources: [
      A('orderNew'),
      A('orders'),
      A('shell'),
      'apps/associate/src/app/(authed)/_components/authed-shell.tsx',
      'docs/associates.md',
    ],
  },
  {
    id: 'associate-orders-limits',
    audience: ['associate'],
    title: 'Your orders, issues, and what you cannot see',
    summary: 'You see only your own orders. Some actions need your store to approve.',
    keywords: [
      'my orders',
      'cancel',
      're-attempt',
      'reattempt',
      'approve',
      'ticket',
      'issue',
      'permission',
      'margin',
      'cost',
      'cannot see',
    ],
    errorDomains: ['reseller-order', 'store-order-request', 'ticket'],
    sections: [
      {
        heading: 'Your orders',
        steps: [
          "My orders shows the orders you placed and where each one has got to. You do not see the rest of the store's orders.",
          "No waybill shows until Skydrop's call centre has confirmed the order with your customer.",
          'Another delivery attempt can be asked for only while the parcel is out for delivery or has just failed to deliver.',
          'Your store may have to approve a cancel or a re-attempt first. Nothing happens to the parcel until they answer, so do not tell your customer a van is coming yet.',
        ],
      },
      {
        heading: 'Raising an issue',
        steps: [
          'Open one of your orders and raise an issue from there (Issues page), for example damaged, lost or late.',
          'Skydrop and your store read it and reply on the same thread.',
          'If an issue is closed and something else goes wrong, raise a new one.',
        ],
      },
      {
        heading: 'What you cannot see',
        steps: [
          'You see only the prices your store set for you.',
          "You do not see what your store pays its client, or what your store earns. You also do not see your store's terms, reports or wallet.",
        ],
      },
      {
        heading: 'A page will not open',
        steps: [
          'The page needs a permission your role does not have. Whoever runs your store can change that.',
        ],
      },
    ],
    sources: [A('orders'), A('tickets'), A('shell'), 'docs/associates.md'],
  },
];
