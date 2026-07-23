/**
 * Motion tokens per skill.
 *
 * SSR SAFETY: variants render `opacity: 1` even in the "hidden" state.
 * The section fade-up is a scroll-triggered translate ONLY (never
 * opacity). That way:
 *   - SSR HTML has visible content (SEO + no-JS users see everything)
 *   - Playwright fullPage screenshots capture the whole page
 *   - Reduced-motion users see stable content immediately
 *   - Users with JS get the subtle upward translate on scroll-into-view
 *
 * Skill rules honored:
 *   - Duration 0.5s, ease [0.21, 0.47, 0.32, 0.98], stagger 0.08s
 *   - Trigger once (viewport once + top margin)
 *   - Transform-only (never layout)
 */
import type { Variants } from 'framer-motion';

export const revealEase = [0.21, 0.47, 0.32, 0.98] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 1, y: 12 },
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
