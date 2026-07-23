/**
 * Shared motion tokens for framer-motion. Enforces the skill's rules:
 *   - Reveal duration 0.5s
 *   - Ease [0.21, 0.47, 0.32, 0.98]
 *   - Stagger 0.08s
 *   - Trigger once (viewport once + top margin)
 *   - Transform + opacity only — never layout properties
 */
import type { Variants } from 'framer-motion';

// Skill-mandated ease curve. Typed as tuple; framer-motion accepts
// number[] for cubic-bezier easing regardless of exposed Transition
// type surface (version 11 hides `ease` in the public type).
export const revealEase = [0.21, 0.47, 0.32, 0.98] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: revealEase },
  },
};

export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08 },
  },
};

export const viewportOnce = { once: true, margin: '-80px' } as const;
