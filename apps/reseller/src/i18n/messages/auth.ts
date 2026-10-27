import { defineMessages } from '../define';

/** Signed-out screens: sign in, how to get a login, password reset, invitation, email confirmation. */
export const auth = defineMessages({
  'auth.portal': ['member store portal', 'মেম্বার স্টোর পোর্টাল'],

  'auth.signIn.title': ['Sign in', 'সাইন ইন'],
  'auth.signIn.subtitle': [
    'Use the login from your store invitation.',
    'আপনার স্টোরের আমন্ত্রণে পাওয়া লগইনটি ব্যবহার করুন।',
  ],
  'auth.signIn.forgot': ['Forgot your password?', 'পাসওয়ার্ড ভুলে গেছেন?'],
  'auth.signIn.resetIt': ['Reset it', 'রিসেট করুন'],
  'auth.signIn.noLogin': ['No login yet?', 'এখনও লগইন নেই?'],
  'auth.signIn.howToGet': ['How to get one', 'কীভাবে পাবেন'],
  'auth.signIn.email': ['Email', 'ইমেইল'],
  'auth.signIn.password': ['Password', 'পাসওয়ার্ড'],
  'auth.signIn.button': ['Sign in', 'সাইন ইন'],
  'auth.signIn.busy': ['Signing in…', 'সাইন ইন হচ্ছে…'],
  'auth.signIn.tryAgain': ['Try again', 'আবার চেষ্টা করুন'],
  'auth.signIn.invalid': ['Invalid email or password.', 'ইমেইল বা পাসওয়ার্ড ভুল।'],
  'auth.signIn.tooMany': [
    'Too many attempts. Try again in a few minutes.',
    'অনেকবার চেষ্টা করা হয়েছে। কয়েক মিনিট পরে আবার চেষ্টা করুন।',
  ],
  'auth.signIn.failed': ['Sign-in failed. Please try again.', 'সাইন ইন হয়নি। আবার চেষ্টা করুন।'],

  'auth.signUp.title': ['Get a store login', 'স্টোর লগইন পাওয়ার উপায়'],
  'auth.signUp.description': [
    'How to get a login for a Skydrop member store.',
    'Skydrop মেম্বার স্টোরের লগইন কীভাবে পাবেন।',
  ],
  'auth.signUp.subtitle': [
    'Store logins are created by the business whose stock you sell.',
    'যে ব্যবসার মজুত আপনি বিক্রি করেন, স্টোরের লগইন তারাই তৈরি করে।',
  ],
  'auth.signUp.invited': [
    'Already invited? The invitation email carries your link.',
    'আগেই আমন্ত্রণ পেয়েছেন? আমন্ত্রণের ইমেইলেই আপনার লিংক আছে।',
  ],
  'auth.signUp.signIn': ['Sign in', 'সাইন ইন'],
  'auth.signUp.otherPortal': ['Looking for a different portal?', 'অন্য পোর্টাল খুঁজছেন?'],
  'auth.signUp.lead1': [
    "Ask them to invite you from their Skydrop account. The invitation sets your password and opens your store's own portal — your catalogue, your orders and your wallet, under your own name.",
    'তাদের বলুন তাদের Skydrop অ্যাকাউন্ট থেকে আপনাকে আমন্ত্রণ জানাতে। আমন্ত্রণের মাধ্যমে আপনার পাসওয়ার্ড ঠিক হয় এবং আপনার স্টোরের নিজস্ব পোর্টাল খোলে — আপনার ক্যাটালগ, আপনার অর্ডার ও আপনার ওয়ালেট, আপনার নিজের নামে।',
  ],
  'auth.signUp.lead2': [
    'Wanting to send your own stock to India instead? That is a client account, and it starts here.',
    'বরং নিজের মজুত ভারতে পাঠাতে চান? সেটি একটি ক্লায়েন্ট অ্যাকাউন্ট, এবং তা শুরু হয় এখান থেকে।',
  ],
  'auth.signUp.requestClient': ['Request a client invite', 'ক্লায়েন্ট আমন্ত্রণের অনুরোধ করুন'],

  'auth.reset.request.title': ['Reset your password', 'পাসওয়ার্ড রিসেট করুন'],
  'auth.reset.request.subtitle': [
    'We will email you a link that works for 30 minutes.',
    'আমরা আপনাকে একটি লিংক ইমেইল করব, যা 30 মিনিট কাজ করে।',
  ],
  'auth.reset.request.back': ['Back to sign in', 'সাইন ইনে ফিরে যান'],
  'auth.reset.request.elsewhere': ['Reset it somewhere else?', 'অন্য কোথাও রিসেট করবেন?'],
  'auth.reset.request.sent': [
    'If that email has a store login, a reset link is on its way. Check your inbox.',
    'ওই ইমেইলের কোনো স্টোর লগইন থাকলে একটি রিসেট লিংক পাঠানো হচ্ছে। আপনার ইনবক্স দেখুন।',
  ],
  'auth.reset.request.email': ['Email', 'ইমেইল'],
  'auth.reset.request.send': ['Send the link', 'লিংক পাঠান'],
  'auth.reset.request.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'auth.reset.request.notSent': ['Not sent', 'পাঠানো হয়নি'],

  'auth.reset.title': ['Set a new password', 'নতুন পাসওয়ার্ড দিন'],
  'auth.reset.subtitle': ['At least 10 characters.', 'কমপক্ষে 10টি অক্ষর।'],
  'auth.reset.missingToken': [
    'This link is missing its token. Ask for a new one from the sign-in page.',
    'এই লিংকে টোকেন নেই। সাইন ইন পাতা থেকে নতুন একটি চেয়ে নিন।',
  ],
  'auth.reset.done': [
    'Your password is set, and every signed-in session was ended. {link}.',
    'আপনার পাসওয়ার্ড ঠিক হয়েছে, এবং সাইন ইন থাকা সব সেশন শেষ করা হয়েছে। {link}।',
  ],
  'auth.reset.signInLink': ['Sign in', 'সাইন ইন'],
  'auth.reset.password': ['New password', 'নতুন পাসওয়ার্ড'],
  'auth.reset.criteria': ['At least 10 characters', 'কমপক্ষে 10টি অক্ষর'],
  'auth.reset.submit': ['Set password', 'পাসওয়ার্ড দিন'],
  'auth.reset.saving': ['Saving…', 'সংরক্ষণ হচ্ছে…'],
  'auth.reset.notSaved': ['Not saved', 'সংরক্ষণ হয়নি'],

  'auth.accept.title': ['Join your store on Skydrop', 'Skydrop-এ আপনার স্টোরে যোগ দিন'],
  'auth.accept.loading': ['Loading the invitation', 'আমন্ত্রণ লোড হচ্ছে'],
  'auth.accept.missingToken': ['This link is missing its token.', 'এই লিংকে টোকেন নেই।'],
  'auth.accept.store': ['Store', 'স্টোর'],
  'auth.accept.roles': ['Your roles', 'আপনার রোল'],
  'auth.accept.email': ['Email', 'ইমেইল'],
  'auth.accept.name': ['Your name', 'আপনার নাম'],
  'auth.accept.password': ['Choose a password', 'একটি পাসওয়ার্ড বেছে নিন'],
  'auth.accept.passwordHint': ['At least 10 characters.', 'কমপক্ষে 10টি অক্ষর।'],
  'auth.accept.criteria': ['At least 10 characters', 'কমপক্ষে 10টি অক্ষর'],
  'auth.accept.join': ['Join the store', 'স্টোরে যোগ দিন'],
  'auth.accept.busy': ['Setting up…', 'সেট আপ হচ্ছে…'],
  'auth.accept.tryAgain': ['Try again', 'আবার চেষ্টা করুন'],

  'auth.verify.title': ['Confirm your email', 'আপনার ইমেইল নিশ্চিত করুন'],
  'auth.verify.missingToken': ['This link is missing its token.', 'এই লিংকে টোকেন নেই।'],
  'auth.verify.done': ['Your email is confirmed. {link}.', 'আপনার ইমেইল নিশ্চিত হয়েছে। {link}।'],
  'auth.verify.goToStore': ['Go to your store', 'আপনার স্টোরে যান'],
  'auth.verify.prompt': [
    'Confirm that this email address is yours.',
    'নিশ্চিত করুন যে এই ইমেইল ঠিকানাটি আপনার।',
  ],
  'auth.verify.confirm': ['Confirm my email', 'আমার ইমেইল নিশ্চিত করুন'],
  'auth.verify.confirming': ['Confirming…', 'নিশ্চিত হচ্ছে…'],
  'auth.verify.notConfirmed': ['Not confirmed', 'নিশ্চিত হয়নি'],
});
