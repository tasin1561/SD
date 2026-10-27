import { defineMessages } from '../define';

/** Copy owned by the "impersonation" feature. */
export const impersonation = defineMessages({
  'impersonation.thisLinkHasNo': [
    'This link has no handoff token in it. Links are single-use and good for one minute, so open the session again from the staff console rather than re-using this address.',
    'এই লিংকে কোনো হ্যান্ডঅফ টোকেন নেই। লিংকগুলো একবারই ব্যবহার করা যায় এবং এক মিনিট বৈধ থাকে, তাই এই ঠিকানা আবার ব্যবহার না করে স্টাফ কনসোল থেকে সেশনটি আবার খুলুন।',
  ],
  'impersonation.theSupportSessionCould': [
    'The support session could not be opened.',
    'সাপোর্ট সেশনটি খোলা যায়নি।',
  ],
  'impersonation.openingDoNotReload': [
    'Opening… do not reload this page.',
    'খোলা হচ্ছে… এই পেজ রিলোড করবেন না।',
  ],
  'impersonation.nothingHasBeenOpened': [
    'Nothing has been opened in anybody’s account. Go back to the staff console and start the session again — the reason you typed is already recorded, so a reviewer will see the attempt either way.',
    'কারও অ্যাকাউন্টে কিছুই খোলা হয়নি। স্টাফ কনসোলে ফিরে গিয়ে সেশনটি আবার শুরু করুন — আপনি যে কারণ লিখেছিলেন তা ইতিমধ্যে নথিভুক্ত, তাই যেভাবেই হোক একজন পর্যালোচক চেষ্টাটি দেখতে পাবেন।',
  ],
  'impersonation.clientSignIn': ['Client sign-in', 'ক্লায়েন্ট সাইন ইন'],
  'impersonation.openingTheSupportSession': [
    'Opening the support session',
    'সাপোর্ট সেশন খোলা হচ্ছে',
  ],
  'impersonation.spendingTheOneTime': [
    'Spending the one-time link for a session inside the account. This takes a moment.',
    'অ্যাকাউন্টের ভেতরে সেশন খুলতে একবার-ব্যবহারযোগ্য লিংকটি ব্যবহার করা হচ্ছে। কিছুক্ষণ লাগবে।',
  ],
});
