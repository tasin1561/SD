import type { Guide } from '../knowledge.types';

const SE = (file: string): string => `apps/seller/src/i18n/messages/${file}.ts`;

/**
 * Client-console guides added by "Step 4 — knowledge gaps". Every line is a
 * close paraphrase of the client console's own copy (the SE() files); where
 * that copy is silent, the guide is silent. Nothing internal appears here
 * (assistant-guides.spec.ts scans for it).
 */
export const SELLER_GAP_GUIDES: readonly Guide[] = [
  {
    id: 'seller-inbound-freight',
    audience: ['seller'],
    title: 'Inbound freight: what you are billed to bring stock to India',
    summary:
      'The Freight page lists the shipping cost of getting your stock from Bangladesh into the Indian warehouse, and how much of it is still to be taken from your wallet.',
    keywords: [
      'freight',
      'inbound freight',
      'freight bill',
      'shipping cost bangladesh',
      'still owed',
      'pay as it sells',
      'withdrawn bill',
      'charged per unit',
    ],
    errorDomains: ['inbound-freight'],
    sections: [
      {
        heading: 'What the page shows',
        steps: [
          'Freight (under Money) shows the shipping cost of getting your stock from Bangladesh into our Indian warehouse. When it is charged depends on the terms agreed for each consignment; see Terms on each row.',
          'A bill appears once we receive a consignment from you and record what the freight cost.',
          '"Still owed" is what is still to be taken from your wallet. "Charged so far" is what has been taken. You can filter the bills by status.',
        ],
      },
      {
        heading: 'How a bill is charged',
        steps: [
          'On pay-as-it-sells terms, each unit carries its share of the consignment’s freight, and that share is deducted from your wallet when the unit is delivered.',
          'Stock still sitting in the warehouse has not been charged for yet. That is why a bill can stay partly owed for a long time without anything being wrong.',
          'A row can show a service charge that is included in its total.',
        ],
      },
      {
        heading: 'A withdrawn bill',
        steps: [
          'If a bill is marked Withdrawn, the bill was wrong and anything it charged has gone back to your wallet.',
        ],
      },
    ],
    sources: [SE('freight')],
  },
  {
    id: 'seller-notifications',
    audience: ['seller'],
    title: 'Notifications: your inbox and what you are emailed about',
    summary:
      'The inbox lists everything sent to you; Notification settings let you choose what reaches you and what the company is emailed about.',
    keywords: [
      'notification',
      'notifications',
      'inbox',
      'email alerts',
      'quiet hours',
      'mute',
      'turn off emails',
      'alerts',
      'stock alerts',
      'order updates',
    ],
    errorDomains: ['seller-notification-preference'],
    sections: [
      {
        heading: 'Your inbox',
        steps: [
          'Notifications shows everything sent to you: what a courier did, what the warehouse checked in, and what moved in your wallet.',
          'Anything needing you will appear there, such as a delivery that failed, a parcel coming back, or money that moved.',
          'You can filter by read state or kind, mark one read or unread, mark all read, dismiss one, or clear all.',
          'Dismissing leaves your inbox only. Anybody else who was sent the same message keeps their copy.',
        ],
      },
      {
        heading: 'Notification settings: two separate choices',
        steps: [
          'Yours: what reaches your own inbox. Nobody else at your company sees your choices, and changing one does not change what anybody else receives.',
          'The company’s: what this company is emailed about, by category (email and in-app). It applies to everyone, not only you. Switching a category off stops that email reaching your colleagues too. Changes save instantly.',
          'Both only ever remove a message. Neither can turn one on that the other switched off.',
          'The categories are order updates, shipment updates, stock alerts, call centre outcomes, billing, system announcements and marketing.',
        ],
      },
      {
        heading: 'Quiet hours and messages you cannot switch off',
        steps: [
          'Quiet hours hold the email only, in the company timezone. An email that arrives inside the window waits until it ends rather than being dropped. An inbox line is never held.',
          'Messages about your account and sign-in (password resets, email verification, team invitations, new-device warnings) always go to your email and cannot be silenced.',
          'A change to the account we pay you into is always confirmed by email, and cannot be switched off.',
        ],
      },
    ],
    sources: [SE('notificationSettings'), SE('notifications')],
  },
  {
    id: 'seller-team-and-roles',
    audience: ['seller'],
    title: 'Team and roles: inviting people and choosing what they can do',
    summary:
      'Invite team members, give them one or more roles, and edit what each role covers under Team and Roles.',
    keywords: [
      'team',
      'invite',
      'staff',
      'colleague',
      'role',
      'roles',
      'permission',
      'access',
      'deactivate',
      'remove member',
      'invitation link',
    ],
    errorDomains: ['seller-team', 'seller-rbac'],
    sections: [
      {
        heading: 'Inviting people',
        steps: [
          'Team is where you invite and manage your team. Owners and admins can change roles or remove members.',
          'Invite member: enter the full name and email and choose one or more roles. The invitee gets a one-time link to set their password. Which roles they hold can be changed later.',
          'The invitation link is shown only once, so copy and share it. It expires.',
          'In the Invitations list you can resend an invitation or revoke it. Revoking stops the link working.',
        ],
      },
      {
        heading: 'Changing roles and removing people',
        steps: [
          'Use Change roles on a member. They can do everything their roles cover between them.',
          'You cannot change your own roles.',
          'Somebody with no role cannot sign in at all, so every member must hold at least one.',
          'Deactivate removes a member’s access: they lose access to this company’s console.',
        ],
      },
      {
        heading: 'Roles',
        steps: [
          'A role is a set of permissions. Create as many as your team needs; the permissions themselves are fixed by the system.',
          'One person can hold several roles, and what they can do is everything those roles cover between them.',
          'To make a role, give it a name and a note on what it is for, then search the permissions (try “return”, “wallet”) and tick what it should cover. Permissions that can move money or stock are marked.',
          'Removing a permission from a role means the people who hold the role stop getting it as soon as you save. Anyone who also holds another role covering it keeps it.',
          'Some roles cannot be edited, such as one that covers everything, including permissions added later.',
          'Deleting a role removes it for good and cannot be undone.',
        ],
      },
    ],
    sources: [SE('team'), SE('teamRoles'), SE('roleWords')],
  },
];
