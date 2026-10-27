import { defineMessages } from '../define';

/** Signed-out screens: sign in, sign-up info, password reset, invitation, email confirmation. */
export const auth = defineMessages({
  'auth.portal': ['associate portal', 'অ্যাসোসিয়েট পোর্টাল'],

  'auth.signIn.title': ['Sign in', 'সাইন ইন'],
  'auth.signIn.subtitle': [
    'Use the login from the invitation your store sent you.',
    'আপনার স্টোর যে আমন্ত্রণ পাঠিয়েছে, তার লগইনটি ব্যবহার করুন।',
  ],
  'auth.signIn.forgot': ['Forgot your password?', 'পাসওয়ার্ড ভুলে গেছেন?'],
  'auth.signIn.resetIt': ['Reset it', 'রিসেট করুন'],
  'auth.signIn.noLogin': ['No login yet?', 'এখনও লগইন নেই?'],
  'auth.signIn.howToGet': ['How to get one', 'কীভাবে পাবেন'],
  'auth.signIn.busy': ['Signing in…', 'সাইন ইন হচ্ছে…'],
  'auth.signIn.invalid': ['Invalid email or password.', 'ইমেইল বা পাসওয়ার্ড ভুল।'],
  'auth.signIn.tooMany': [
    'Too many attempts. Try again in a few minutes.',
    'অনেকবার চেষ্টা করা হয়েছে। কয়েক মিনিট পরে আবার চেষ্টা করুন।',
  ],
  'auth.signIn.unreachable': [
    'We could not reach Skydrop just now. Your login is fine — try again shortly.',
    'এই মুহূর্তে Skydrop-এ পৌঁছানো যায়নি। আপনার লগইনে কোনো সমস্যা নেই — একটু পরে আবার চেষ্টা করুন।',
  ],
  'auth.signIn.failed': ['Sign-in failed. Please try again.', 'সাইন ইন হয়নি। আবার চেষ্টা করুন।'],

  'auth.signUp.title': ['Get a sales login', 'সেলস লগইন পাওয়ার উপায়'],
  'auth.signUp.subtitle': [
    'Sales logins are created by the store you sell for.',
    'যে স্টোরের হয়ে আপনি বিক্রি করেন, সেই স্টোরই সেলস লগইন তৈরি করে।',
  ],
  'auth.signUp.description': [
    'How to get a Skydrop sales login from the store you sell for.',
    'যে স্টোরের হয়ে আপনি বিক্রি করেন, তাদের কাছ থেকে কীভাবে Skydrop সেলস লগইন পাবেন।',
  ],
  'auth.signUp.invited': [
    'Already invited? The invitation email carries your link.',
    'আগেই আমন্ত্রণ পেয়েছেন? আমন্ত্রণের ইমেইলেই আপনার লিংক আছে।',
  ],
  'auth.signUp.signIn': ['Sign in', 'সাইন ইন'],
  'auth.signUp.otherPortal': ['Looking for a different portal?', 'অন্য পোর্টাল খুঁজছেন?'],
  'auth.signUp.lead1': [
    "Ask whoever runs the store to invite you from their team screen. The invitation sets your password and opens the orders you place and the customers you sell to — your own, not the whole store's.",
    'যিনি স্টোর চালান, তাঁকে বলুন তাঁর টিম স্ক্রিন থেকে আপনাকে আমন্ত্রণ পাঠাতে। আমন্ত্রণের মাধ্যমে আপনি পাসওয়ার্ড দেবেন এবং আপনার নিজের দেওয়া অর্ডার ও আপনার গ্রাহকদের দেখতে পাবেন — পুরো স্টোরের নয়।',
  ],
  'auth.signUp.lead2': [
    'They also set the price you sell each product at, so there is nothing for you to configure before your first order.',
    'প্রতিটি পণ্য কত দামে বিক্রি করবেন সেটাও তাঁরাই ঠিক করেন, তাই প্রথম অর্ডারের আগে আপনাকে কিছু সেট করতে হবে না।',
  ],

  'auth.reset.request.title': ['Reset your password', 'পাসওয়ার্ড রিসেট করুন'],
  'auth.reset.request.subtitle': [
    'We will email you a link that works for 30 minutes.',
    'আমরা আপনাকে একটি লিংক ইমেইল করব, যা 30 মিনিট কাজ করবে।',
  ],
  'auth.reset.request.back': ['Back to sign in', 'সাইন ইনে ফিরে যান'],
  'auth.reset.request.elsewhere': ['Reset it somewhere else?', 'অন্য কোথাও রিসেট করবেন?'],
  'auth.reset.request.sent': [
    'If that email has a login here, a reset link is on its way. Check your inbox.',
    'ওই ইমেইলে এখানে লগইন থাকলে একটি রিসেট লিংক পাঠানো হচ্ছে। আপনার ইনবক্স দেখুন।',
  ],
  'auth.reset.request.send': ['Send the link', 'লিংক পাঠান'],
  'auth.reset.request.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'auth.reset.request.notSent': ['Not sent', 'পাঠানো হয়নি'],

  'auth.reset.title': ['Set a new password', 'নতুন পাসওয়ার্ড দিন'],
  'auth.reset.subtitle': ['At least 10 characters.', 'কমপক্ষে 10টি অক্ষর।'],
  'auth.reset.newPassword': ['New password', 'নতুন পাসওয়ার্ড'],
  'auth.reset.missingToken': [
    'This link is missing its token. Ask for a new one from the sign-in page.',
    'এই লিংকে টোকেন নেই। সাইন-ইন পেজ থেকে নতুন একটি লিংক চেয়ে নিন।',
  ],
  'auth.reset.done': [
    'Your password is set, and every signed-in session was ended. {signIn}.',
    'আপনার পাসওয়ার্ড দেওয়া হয়েছে এবং সব সাইন-ইন সেশন শেষ করা হয়েছে। {signIn}।',
  ],
  'auth.reset.signInLink': ['Sign in', 'সাইন ইন করুন'],
  'auth.reset.set': ['Set password', 'পাসওয়ার্ড দিন'],

  'auth.password.min10': ['At least 10 characters', 'কমপক্ষে 10টি অক্ষর'],

  'auth.accept.title': ['Join your store on Skydrop', 'Skydrop-এ আপনার স্টোরে যোগ দিন'],
  'auth.accept.loading': ['Loading the invitation', 'আমন্ত্রণ লোড হচ্ছে'],
  'auth.accept.store': ['Store', 'স্টোর'],
  'auth.accept.roles': ['Your roles', 'আপনার ভূমিকা'],
  'auth.accept.name': ['Your name', 'আপনার নাম'],
  'auth.accept.choosePassword': ['Choose a password', 'একটি পাসওয়ার্ড বেছে নিন'],
  'auth.accept.hint': ['At least 10 characters.', 'কমপক্ষে 10টি অক্ষর।'],
  'auth.accept.join': ['Join the store', 'স্টোরে যোগ দিন'],
  'auth.accept.busy': ['Setting up…', 'তৈরি হচ্ছে…'],

  'auth.verify.title': ['Confirm your email', 'আপনার ইমেইল নিশ্চিত করুন'],
  'auth.verify.done': ['Your email is confirmed. {link}.', 'আপনার ইমেইল নিশ্চিত হয়েছে। {link}।'],
  'auth.verify.goOrders': ['Go to your orders', 'আপনার অর্ডারে যান'],
  'auth.verify.prompt': [
    'Confirm that this email address is yours.',
    'নিশ্চিত করুন যে এই ইমেইল ঠিকানাটি আপনার।',
  ],
  'auth.verify.confirm': ['Confirm my email', 'আমার ইমেইল নিশ্চিত করুন'],
  'auth.verify.busy': ['Confirming…', 'নিশ্চিত করা হচ্ছে…'],
  'auth.verify.notConfirmed': ['Not confirmed', 'নিশ্চিত হয়নি'],
});
