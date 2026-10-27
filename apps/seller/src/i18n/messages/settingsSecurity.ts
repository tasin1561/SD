import { defineMessages } from '../define';

/** Copy owned by the "settingsSecurity" feature. */
export const settingsSecurity = defineMessages({
  'settingsSecurity.sentCheckYourInbox': [
    'Sent. Check your inbox — the link confirms this address.',
    'পাঠানো হয়েছে। আপনার ইনবক্স দেখুন — লিংকটি এই ঠিকানা নিশ্চিত করে।',
  ],
  'settingsSecurity.couldNotSendA': [
    'Could not send a verification link.',
    'যাচাইয়ের লিংক পাঠানো যায়নি।',
  ],
  'settingsSecurity.couldNotEndYour': [
    'Could not end your sessions.',
    'আপনার সেশন শেষ করা যায়নি।',
  ],
  'settingsSecurity.signInSessions': ['Sign-in & sessions', 'সাইন-ইন ও সেশন'],
  'settingsSecurity.whoThisBrowserIs': [
    'Who this browser is signed in as, and how to end every session for this account at once.',
    'এই ব্রাউজারে কে সাইন-ইন করা আছেন, এবং এই অ্যাকাউন্টের সব সেশন একবারে কীভাবে শেষ করবেন।',
  ],
  'settingsSecurity.emailNotVerified': ['Email not verified', 'ইমেইল যাচাই হয়নি'],
  'settingsSecurity.emailVerified': ['Email verified', 'ইমেইল যাচাই হয়েছে'],
  'settingsSecurity.tryAgain': ['Try again', 'আবার চেষ্টা করুন'],
  'settingsSecurity.thisSession': ['This session', 'এই সেশন'],
  'settingsSecurity.whatTheServerSays': [
    'What the server says about the person signed in here.',
    'এখানে সাইন-ইন করা ব্যক্তি সম্পর্কে সার্ভার যা বলছে।',
  ],
  'settingsSecurity.signedInAs': ['Signed in as', 'সাইন-ইন করা আছে'],
  'settingsSecurity.email': ['Email', 'ইমেইল'],
  'settingsSecurity.notVerified': [' — not verified', ' — যাচাই হয়নি'],
  'settingsSecurity.role': ['Role', 'ভূমিকা'],
  'settingsSecurity.roles': ['Roles', 'ভূমিকা'],
  'settingsSecurity.company': ['Company', 'কোম্পানি'],
  'settingsSecurity.sendMeANew': ['Send me a new link', 'আমাকে নতুন লিংক পাঠান'],
  'settingsSecurity.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'settingsSecurity.sent': ['Sent', 'পাঠানো হয়েছে'],
  'settingsSecurity.weHaveNotConfirmed': [
    'We have not confirmed this address yet. The link may have been filtered, or sent before you finished setting up — either way you can have another.',
    'আমরা এখনো এই ঠিকানা নিশ্চিত করিনি। লিংকটি ফিল্টার হয়ে গিয়ে থাকতে পারে, বা আপনার সেটআপ শেষ হওয়ার আগে পাঠানো হয়েছিল — যেভাবেই হোক আপনি আরেকটি পেতে পারেন।',
  ],
  'settingsSecurity.signOutEverywhere': ['Sign out everywhere', 'সব জায়গা থেকে সাইন-আউট'],
  'settingsSecurity.everyDeviceIncludingThis': [
    'Every device, including this one.',
    'এটিসহ প্রতিটি ডিভাইস।',
  ],
  'settingsSecurity.thisAccount': ['this account', 'এই অ্যাকাউন্ট'],
  'settingsSecurity.isSignedOut': ['is signed out.', 'সাইন-আউট হয়ে যাবে।'],
  'settingsSecurity.thatIncludesThisOne': [
    'That includes this one — you will sign in again straight after. It does not change your password, and it does not touch API keys: a key is a separate credential and is revoked on the {link} page.',
    'এটিও এর মধ্যে পড়ে — সঙ্গে সঙ্গে আপনাকে আবার সাইন-ইন করতে হবে। এতে আপনার পাসওয়ার্ড বদলায় না, আর API কী-তেও হাত পড়ে না: কী আলাদা একটি পরিচয়পত্র এবং তা {link} পেজে বাতিল করা হয়।',
  ],
  'settingsSecurity.apiKeys': ['API keys', 'API কী'],
  'settingsSecurity.endingSessions': ['Ending sessions…', 'সেশন শেষ হচ্ছে…'],
  'settingsSecurity.sessionsEnded': ['Sessions ended', 'সেশন শেষ হয়েছে'],
  'settingsSecurity.theServerReportedNo': [
    'The server reported no active sessions to revoke.',
    'সার্ভার জানিয়েছে বাতিল করার মতো কোনো সক্রিয় সেশন নেই।',
  ],
  'settingsSecurity.thisBrowserSSession': [
    "This browser's session was ended too. Sign in again to carry on.",
    'এই ব্রাউজারের সেশনও শেষ হয়েছে। চালিয়ে যেতে আবার সাইন-ইন করুন।',
  ],
  'settingsSecurity.signInAgain': ['Sign in again', 'আবার সাইন-ইন করুন'],
  'settingsSecurity.signOutEverywhere2': ['Sign out everywhere?', 'সব জায়গা থেকে সাইন-আউট করবেন?'],
  'settingsSecurity.thisAccount2': ['This account', 'এই অ্যাকাউন্ট'],
  'settingsSecurity.everyDeviceSignedIn': [
    'Every device signed in as this account is signed out, including this one. Anyone using the account will need to sign in again.',
    'এই অ্যাকাউন্ট হিসেবে সাইন-ইন করা প্রতিটি ডিভাইস সাইন-আউট হবে, এটিসহ। অ্যাকাউন্টটি যিনিই ব্যবহার করছেন, তাঁকে আবার সাইন-ইন করতে হবে।',
  ],
  'settingsSecurity.useThisWhenA': [
    'Use this when a device is out of your hands, or when the same login has been used on machines you can no longer account for. Every browser and app signed in as {span} {t}',
    'কোনো ডিভাইস আপনার হাতের বাইরে গেলে, বা একই লগইন এমন মেশিনে ব্যবহার হলে যার হিসাব আপনি আর দিতে পারছেন না — তখন এটি ব্যবহার করুন। {span} হিসেবে সাইন-ইন করা প্রতিটি ব্রাউজার ও অ্যাপ {t}',
  ],
  'settingsSecurity.notSent': ['Not sent', 'পাঠানো হয়নি'],
  'settingsSecurity.clientConsole': ['Client console', 'ক্লায়েন্ট কনসোল'],
  'settingsSecurity.account': ['Account', 'অ্যাকাউন্ট'],
  'settingsSecurity.settings': ['Settings', 'সেটিংস'],
  'settingsSecurity.sessionRevokedOne': [
    '{revokedCount} session was revoked.',
    '{revokedCount}টি সেশন বাতিল করা হয়েছে।',
  ],
  'settingsSecurity.sessionsRevokedMany': [
    '{revokedCount} sessions were revoked.',
    '{revokedCount}টি সেশন বাতিল করা হয়েছে।',
  ],
});
