/**
 * The setup checklist must not appear before the data it describes.
 *
 * It reads three queries. While they are in flight every step is
 * `false`, so a seller who finished months ago was shown "0 of 4 done"
 * as a full-width call to action for a second on every dashboard load,
 * then watched it vanish. Nothing was wrong with the steps — the
 * absence of three responses had been rendered as a fact about them.
 */
import { describe, expect, it } from 'vitest';
import { onboardingVisible } from '../app/(authed)/dashboard/_components/dashboard-view';

const NONE_DONE = [{ done: false }, { done: false }, { done: false }, { done: false }];
const ALL_DONE = [{ done: true }, { done: true }, { done: true }, { done: true }];
const SOME_DONE = [{ done: true }, { done: false }, { done: true }, { done: true }];

describe('onboardingVisible', () => {
  it('stays hidden while the answers are still arriving', () => {
    // The flash. Every step reads false because nothing has replied
    // yet, which is indistinguishable from a brand-new seller.
    expect(onboardingVisible(false, NONE_DONE)).toBe(false);
  });

  it('stays hidden even once the answers arrive, if there is nothing left to do', () => {
    expect(onboardingVisible(true, ALL_DONE)).toBe(false);
  });

  it('appears for a seller with work outstanding', () => {
    expect(onboardingVisible(true, NONE_DONE)).toBe(true);
    expect(onboardingVisible(true, SOME_DONE)).toBe(true);
  });

  it('an unanswered query hides it regardless of what the steps say', () => {
    // `known` means ANSWERED, not "no longer loading". A failed
    // catalogue request is not evidence that somebody has no products,
    // and telling them to add their first one is the same mistake
    // wearing an error's clothes.
    expect(onboardingVisible(false, SOME_DONE)).toBe(false);
    expect(onboardingVisible(false, ALL_DONE)).toBe(false);
  });

  it('has nothing to show for an empty step list', () => {
    expect(onboardingVisible(true, [])).toBe(false);
  });
});
