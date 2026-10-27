import { defineMessages } from '../define';

/** Copy owned by the "passwordReset" feature. */
export const passwordReset = defineMessages({
  'passwordReset.tooManyRequestsTry': [
    'Too many requests. Try again in an hour.',
    'Too many requests. Try again in an hour.',
  ],
  'passwordReset.couldNotRequestA': ['Could not request a reset.', 'Could not request a reset.'],
  'passwordReset.ifMatchesASeller': [
    'If {span} matches a seller account, a reset link is on its way. The link expires in 30 minutes.',
    'If {span} matches a seller account, a reset link is on its way. The link expires in 30 minutes.',
  ],
  'passwordReset.email': ['Email', 'Email'],
  'passwordReset.sending': ['Sending…', 'Sending…'],
  'passwordReset.sendResetLink': ['Send reset link', 'Send reset link'],
  'passwordReset.resetYourPassword': ['Reset your password', 'Reset your password'],
  'passwordReset.enterYourClientAccount': [
    "Enter your client account email. If we recognize it, you'll get a reset link by email within a few minutes.",
    "Enter your client account email. If we recognize it, you'll get a reset link by email within a few minutes.",
  ],
  'passwordReset.rememberedIt': ['Remembered it? {a}', 'Remembered it? {a}'],
  'passwordReset.signIn': ['Sign in', 'Sign in'],
  'passwordReset.resetItSomewhereElse': ['Reset it somewhere else?', 'Reset it somewhere else?'],
});
