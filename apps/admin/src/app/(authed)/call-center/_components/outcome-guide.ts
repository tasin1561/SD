import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';
import type { GuideChoice } from '@/components/easy/choice-guide';

/**
 * What each call outcome DOES, in plain words, for the choice guide on the
 * agent's bench and the supervisor's overrule dialog.
 *
 * The dropdown's own one-line helpers are written for someone who already
 * knows the system ("no order transition"). These say when to pick the
 * outcome and what happens next, the way a new agent needs to hear it.
 *
 * They MIRROR `CallOutcomeMappingService` (CC-2) and decide nothing: the
 * server is the only place an outcome is turned into an order change.
 */
const GUIDE: Readonly<Record<string, MessageKey>> = {
  CONFIRMED: 'ezCall.guideConfirmed',
  CUSTOMER_DECLINED: 'ezCall.guideDeclined',
  WRONG_NUMBER: 'ezCall.guideWrongNumber',
  NO_ANSWER: 'ezCall.guideNoAnswer',
  BUSY: 'ezCall.guideBusy',
  VOICEMAIL_LEFT: 'ezCall.guideVoicemail',
  CALLBACK_REQUESTED: 'ezCall.guideCallback',
  TECHNICAL_FAILURE: 'ezCall.guideTechnical',
  LANGUAGE_BARRIER: 'ezCall.guideLanguage',
  SPOKE_TO_CUSTOMER: 'ezCall.guideSpoke',
};

/**
 * The guide's rows for a set of dropdown options — same options, same
 * order, same names. An outcome this file does not know keeps the
 * dropdown's own helper, so a new enum value is never left unexplained.
 */
export function outcomeGuide<V extends string>(
  t: Translate<MessageKey>,
  options: ReadonlyArray<{ readonly value: V; readonly label: string; readonly helper: string }>,
): ReadonlyArray<GuideChoice<V>> {
  return options.map((o) => {
    const key = GUIDE[o.value];
    return { value: o.value, label: o.label, helper: key === undefined ? o.helper : t(key) };
  });
}
