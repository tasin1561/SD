import { defineMessages } from '../define';

/** Copy owned by the "passwordReset" feature. */
export const passwordReset = defineMessages({
  'passwordReset.tooManyRequestsTry': [
    'Too many requests. Try again in an hour.',
    'অনেকবার অনুরোধ করা হয়েছে। এক ঘণ্টা পর আবার চেষ্টা করুন।',
  ],
  'passwordReset.couldNotRequestA': ['Could not request a reset.', 'রিসেটের অনুরোধ করা যায়নি।'],
  'passwordReset.ifMatchesASeller': [
    'If {span} matches a seller account, a reset link is on its way. The link expires in 30 minutes.',
    '{span} যদি কোনো বিক্রেতা অ্যাকাউন্টের সাথে মিলে যায়, তাহলে একটি রিসেট লিংক পাঠানো হচ্ছে। লিংকের মেয়াদ 30 মিনিট।',
  ],
  'passwordReset.email': ['Email', 'ইমেইল'],
  'passwordReset.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'passwordReset.sendResetLink': ['Send reset link', 'রিসেট লিংক পাঠান'],
  'passwordReset.resetYourPassword': ['Reset your password', 'আপনার পাসওয়ার্ড রিসেট করুন'],
  'passwordReset.enterYourClientAccount': [
    "Enter your client account email. If we recognize it, you'll get a reset link by email within a few minutes.",
    'আপনার ক্লায়েন্ট অ্যাকাউন্টের ইমেইল লিখুন। আমরা চিনতে পারলে কয়েক মিনিটের মধ্যে ইমেইলে একটি রিসেট লিংক পাবেন।',
  ],
  'passwordReset.rememberedIt': ['Remembered it? {a}', 'মনে পড়েছে? {a}'],
  'passwordReset.signIn': ['Sign in', 'সাইন ইন করুন'],
  'passwordReset.resetItSomewhereElse': ['Reset it somewhere else?', 'অন্য কোথাও রিসেট করবেন?'],
});
