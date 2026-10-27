import { defineMessages } from '../define';

/** The store's team (`/team`) and the role picker. Role names and descriptions come from the server. */
export const team = defineMessages({
  'team.title': ['Team', 'টিম'],
  'team.subtitle': ['Everybody with a login for this store.', 'এই স্টোরে যাঁদের লগইন আছে সবাই।'],
  'team.loading': ['Loading the team', 'টিম লোড হচ্ছে'],
  'team.invite': ['Invite a colleague', 'একজন সহকর্মীকে আমন্ত্রণ জানান'],
  'team.members': ['Members', 'সদস্য'],
  'team.membersNote': [
    'Somebody can hold more than one role; what they may do is everything their roles allow put together.',
    'একজন একাধিক রোল ধারণ করতে পারেন; তিনি যা করতে পারবেন তা তাঁর সব রোলের অনুমতি একসঙ্গে ধরে।',
  ],
  'team.noMembers': ['No members yet', 'এখনও কোনো সদস্য নেই'],
  'team.noMembersBody': [
    'Invite a colleague to get started.',
    'শুরু করতে একজন সহকর্মীকে আমন্ত্রণ জানান।',
  ],
  'team.col.name': ['Name', 'নাম'],
  'team.col.email': ['Email', 'ইমেইল'],
  'team.col.roles': ['Roles', 'রোল'],
  'team.col.lastSignedIn': ['Last signed in', 'সর্বশেষ সাইন ইন'],
  'team.col.actions': ['Actions', 'কাজ'],
  'team.col.expires': ['Expires', 'মেয়াদ শেষ'],
  'team.never': ['never', 'কখনও না'],
  'team.you': [' (you)', ' (আপনি)'],
  'team.changeRoles': ['Change roles', 'রোল বদলান'],
  'team.remove': ['Remove', 'সরান'],
  'team.removeTitle': ['Remove {name}?', '{name}-কে সরাবেন?'],
  'team.removeConsequence': [
    'Their access ends now, including any session they have open.',
    'তাঁর অ্যাক্সেস এখনই শেষ হবে, খোলা থাকা যেকোনো সেশনসহ।',
  ],
  'team.removeConfirm': ['Remove access', 'অ্যাক্সেস সরান'],
  'team.removed': ['{name} no longer has access.', '{name}-এর আর অ্যাক্সেস নেই।'],

  'team.pending': ['Pending invitations', 'অপেক্ষমাণ আমন্ত্রণ'],
  'team.noPending': ['No pending invitations', 'কোনো অপেক্ষমাণ আমন্ত্রণ নেই'],
  'team.noPendingBody': [
    'Invitations you send appear here until they are accepted.',
    'আপনার পাঠানো আমন্ত্রণ গৃহীত না হওয়া পর্যন্ত এখানে দেখা যায়।',
  ],
  'team.expired': [
    'Expired {when} — never accepted',
    '{when} তারিখে মেয়াদ শেষ — কখনও গৃহীত হয়নি',
  ],
  'team.resent': [
    'Sent again to {email}. The earlier link no longer works.',
    '{email}-এ আবার পাঠানো হয়েছে। আগের লিংকটি আর কাজ করবে না।',
  ],
  'team.sendAgain': ['Send again', 'আবার পাঠান'],
  'team.resend': ['Resend', 'পুনরায় পাঠান'],
  'team.withdraw': ['Withdraw', 'প্রত্যাহার করুন'],
  'team.withdrawTitle': [
    'Withdraw the invitation to {name}?',
    '{name}-কে দেওয়া আমন্ত্রণ প্রত্যাহার করবেন?',
  ],
  'team.withdrawConsequence': [
    'The link sent to {email} stops working. You can invite them again later.',
    '{email}-এ পাঠানো লিংকটি কাজ করা বন্ধ করবে। পরে আপনি তাঁকে আবার আমন্ত্রণ জানাতে পারবেন।',
  ],
  'team.withdrawConfirm': ['Withdraw invitation', 'আমন্ত্রণ প্রত্যাহার করুন'],
  'team.withdrawn': ['Invitation withdrawn.', 'আমন্ত্রণ প্রত্যাহার করা হয়েছে।'],

  'team.roles.dlgTitle': ['What {name} may do', '{name} কী করতে পারবেন'],
  'team.roles.dlgDesc': [
    'Tick every role they hold. What they may do is all of them put together, and it changes as soon as you save.',
    'তিনি যত রোল ধারণ করেন সবগুলোতে টিক দিন। তিনি যা করতে পারবেন তা সবগুলো একসঙ্গে ধরে, এবং সংরক্ষণ করার সঙ্গে সঙ্গেই তা বদলে যায়।',
  ],
  'team.roles.legend': ['Roles', 'রোল'],
  'team.roles.lockedChange': [
    'Only an owner of this store can make somebody an owner.',
    'শুধু এই স্টোরের মালিকই কাউকে মালিক বানাতে পারেন।',
  ],
  'team.roles.cancel': ['Cancel', 'বাতিল'],
  'team.roles.save': ['Save roles', 'রোল সংরক্ষণ করুন'],
  'team.roles.saving': ['Saving…', 'সংরক্ষণ হচ্ছে…'],
  'team.roles.notSaved': ['Not saved', 'সংরক্ষণ হয়নি'],
  'team.roles.holdsNone': ['{name} holds no role.', '{name}-এর কোনো রোল নেই।'],
  'team.roles.nowIs': ['{name} is now {roles}.', '{name} এখন {roles}।'],
  'team.roles.join': [' and ', ' ও '],
  'team.roles.none': [
    'No live role — they cannot sign in',
    'কোনো সক্রিয় রোল নেই — তিনি সাইন ইন করতে পারবেন না',
  ],

  'team.inv.title': ['Invite a colleague', 'একজন সহকর্মীকে আমন্ত্রণ জানান'],
  'team.inv.desc': [
    'They get an email with a link to set up their login. It works for 7 days.',
    'তিনি লগইন তৈরির লিংকসহ একটি ইমেইল পাবেন। লিংকটি 7 দিন কাজ করে।',
  ],
  'team.inv.name': ['Name', 'নাম'],
  'team.inv.email': ['Email', 'ইমেইল'],
  'team.inv.lockedOwner': [
    'Only an owner of this store can invite another owner.',
    'শুধু এই স্টোরের মালিকই আরেকজন মালিককে আমন্ত্রণ জানাতে পারেন।',
  ],
  'team.inv.cancel': ['Cancel', 'বাতিল'],
  'team.inv.send': ['Send invitation', 'আমন্ত্রণ পাঠান'],
  'team.inv.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'team.inv.notSent': ['Not sent', 'পাঠানো হয়নি'],
  'team.inv.sent': ['Invitation sent to {email}.', '{email}-এ আমন্ত্রণ পাঠানো হয়েছে।'],
});
