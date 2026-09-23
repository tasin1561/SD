import type { ReactNode } from 'react';

/**
 * One primitive in the `/dev/ui` gallery. Each group of primitives
 * contributes an array of these from its own `entries-<group>.tsx`, so the
 * groups can be built in parallel without touching a shared file.
 */
export interface GalleryEntry {
  /** kebab-case id, unique across the gallery — also the anchor. */
  readonly id: string;
  /** What a reviewer calls it: "Text field", "KPI card". */
  readonly name: string;
  /** The premium-ui-motion references it implements: ['u33'], ['rolling-label']. */
  readonly patterns: readonly string[];
  /** One line: where the apps use it. */
  readonly usedFor: string;
  /** Render its states in wide cells (tables, the shell, the sign-in screen). */
  readonly wide?: boolean;
  /**
   * Every state worth reviewing, each rendered side by side: idle, hover
   * (describe it — the reviewer hovers), focus, active, disabled, loading,
   * error, success, empty, populated. Each state is a live, interactive
   * render, not a picture.
   */
  readonly states: ReadonlyArray<{ readonly label: string; readonly render: () => ReactNode }>;
}
