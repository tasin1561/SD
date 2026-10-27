import { defineMessages } from '../define';

/** Copy owned by the "authReset" feature. */
export const authReset = defineMessages({
  'authReset.passwordMustBeAt': [
    'Password must be at least 10 characters.',
    'পাসওয়ার্ড কমপক্ষে 10 অক্ষরের হতে হবে।',
  ],
  'authReset.passwordsDoNotMatch': ['Passwords do not match.', 'পাসওয়ার্ড মিলছে না।'],
  'authReset.couldNotSetThe': [
    'Could not set the new password.',
    'নতুন পাসওয়ার্ড ঠিক করা যায়নি।',
  ],
  'authReset.passwordUpdatedSignIn': [
    'Password updated. Sign in with your new password to continue.',
    'পাসওয়ার্ড হালনাগাদ হয়েছে। চালিয়ে যেতে নতুন পাসওয়ার্ড দিয়ে সাইন ইন করুন।',
  ],
  'authReset.signIn': ['Sign in', 'সাইন ইন করুন'],
  'authReset.matchesThePassword': ['Matches the password', 'পাসওয়ার্ডের সাথে মিলেছে'],
  'authReset.newPassword': ['New password', 'নতুন পাসওয়ার্ড'],
  'authReset.confirmPassword': ['Confirm password', 'পাসওয়ার্ড নিশ্চিত করুন'],
  'authReset.saving': ['Saving…', 'সংরক্ষণ হচ্ছে…'],
  'authReset.saveNewPassword': ['Save new password', 'নতুন পাসওয়ার্ড সংরক্ষণ করুন'],
  'authReset.backToSignIn': ['Back to sign in', 'সাইন ইনে ফিরে যান'],
  'authReset.invalidResetLink': ['Invalid reset link', 'রিসেটের লিংকটি অবৈধ'],
  'authReset.theLinkIsMissing': [
    'The link is missing the reset token. Open the reset email again and click the button there, or request a new link.',
    'লিংকে রিসেটের টোকেন নেই। রিসেট ইমেইলটি আবার খুলে সেখানকার বাটনে ক্লিক করুন, অথবা নতুন একটি লিংক চেয়ে নিন।',
  ],
  'authReset.requestANewLink': ['Request a new link', 'নতুন লিংক চান'],
  'authReset.chooseANewPassword': ['Choose a new password', 'একটি নতুন পাসওয়ার্ড বেছে নিন'],
  'authReset.minimum10CharactersAfter': [
    "Minimum 10 characters. After saving you'll need to sign in again.",
    'কমপক্ষে 10 অক্ষর। সংরক্ষণের পর আপনাকে আবার সাইন ইন করতে হবে।',
  ],
  'authReset.atLeast10Characters': ['At least 10 characters', 'কমপক্ষে 10 অক্ষর'],
  'authReset.showConfirmPassword': ['Show confirm password', 'নিশ্চিত করা পাসওয়ার্ড দেখান'],
});
