/**
 * Clustering a night's knowledge gaps / confusing pages into themes with
 * counts, WITHOUT a model call. The rubric already asks the model for a
 * short, consistently worded topic (2-5 words) or an exact page path, so
 * normalising and grouping those strings is reliable and free; a second
 * Haiku pass would add cost and a place for the model to drift for no gain.
 */
export interface ThemeInput {
  readonly conversationId: string;
  readonly label: string;
}
export interface Theme {
  readonly label: string;
  readonly count: number;
  readonly conversationIds: string[];
}

const STOP = new Set([
  'a',
  'an',
  'the',
  'of',
  'for',
  'to',
  'in',
  'on',
  'and',
  'or',
  'how',
  'what',
  'is',
  'are',
  'about',
  'with',
  'info',
  'information',
]);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const MAX_EXAMPLES = 5;
const JACCARD_MERGE = 0.6;

/** `/Orders/0191…/edit?x=1` and `/orders/:id/edit/` are the same page. */
export function pathKey(label: string): string {
  const base = (label.split(/[?#]/)[0] ?? '')
    .toLowerCase()
    .replace(UUID, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
  return base.length > 1 ? base.replace(/\/+$/, '') : base;
}

function tokens(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t !== '' && !STOP.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let both = 0;
  for (const t of a) if (b.has(t)) both++;
  const union = a.size + b.size - both;
  return union === 0 ? 0 : both / union;
}

export function groupThemes(items: readonly ThemeInput[], kind: 'path' | 'topic'): Theme[] {
  interface G {
    key: Set<string>;
    labels: Map<string, number>;
    ids: Set<string>;
  }
  const groups: G[] = [];
  for (const it of items) {
    const key = new Set(kind === 'path' ? [pathKey(it.label)] : tokens(it.label));
    if (key.size === 0) continue;
    const g =
      groups.find((x) =>
        kind === 'path' ? [...x.key][0] === [...key][0] : jaccard(x.key, key) >= JACCARD_MERGE,
      ) ?? null;
    const target = g ?? { key, labels: new Map<string, number>(), ids: new Set<string>() };
    if (g === null) groups.push(target);
    target.labels.set(it.label, (target.labels.get(it.label) ?? 0) + 1);
    target.ids.add(it.conversationId);
  }
  return groups
    .map((g) => {
      const label = [...g.labels.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]),
      )[0]?.[0];
      return {
        label: label ?? '',
        count: g.ids.size,
        conversationIds: [...g.ids].slice(0, MAX_EXAMPLES),
      };
    })
    .filter((t) => t.label !== '')
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
