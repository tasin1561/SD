'use client';

import { useMemo, useState, type ReactElement } from 'react';
import Link from 'next/link';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Input,
  PageHeader,
  SkeletonRows,
  Toolbar,
} from '@skydrop/ui/components';
import { useCategoryAttributes, useCategoryTree, type CategoryNode } from '@/lib/account-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * The category tree, so you can find the one you need.
 *
 * You cannot edit these — categories are shared by every seller and
 * carry the GST rate and HS code that products inherit. This screen is
 * for two things: finding the right category before listing a product,
 * and copying its id, which is what the product form and the CSV
 * importer actually take.
 *
 * Search flattens the tree rather than filtering it in place, because a
 * match three levels down is invisible if its ancestors are collapsed,
 * and the path is what tells you whether it is the right one.
 */
export function CategoriesIndex(): ReactElement {
  const tree = useCategoryTree();
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  // What this category will demand of a variant — the question you are
  // really asking when you pick one.
  const [showAttrsFor, setShowAttrsFor] = useState<string | null>(null);

  /** Depth-first with the ancestor path carried down, for search results. */
  const flat = useMemo(() => {
    const out: Array<{ node: CategoryNode; path: string; depth: number }> = [];
    const walk = (nodes: readonly CategoryNode[], prefix: string, depth: number): void => {
      for (const n of nodes) {
        const path = prefix === '' ? n.name : `${prefix} › ${n.name}`;
        out.push({ node: n, path, depth });
        if (n.children !== undefined && n.children.length > 0) {
          walk(n.children, path, depth + 1);
        }
      }
    };
    walk(tree.data ?? [], '', 0);
    return out;
  }, [tree.data]);

  const term = search.trim().toLowerCase();
  const shown =
    term === ''
      ? flat
      : flat.filter(
          (r) => r.path.toLowerCase().includes(term) || r.node.slug.toLowerCase().includes(term),
        );

  async function copy(id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard can be blocked; the id is on screen either way.
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Categories"
        subtitle="Shared across every seller — they carry the GST rate and HS code your products inherit."
        action={
          <Link href="/catalog/proposals">
            <Button variant="ghost" size="md">
              Request a new one
            </Button>
          </Link>
        }
      />

      <Toolbar>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search categories"
          className="w-72"
          aria-label="Search categories"
        />
      </Toolbar>

      <Card>
        {tree.isLoading ? (
          <SkeletonRows rows={6} />
        ) : tree.isError ? (
          <ErrorNote message={serverVerdict(tree.error)} retry={() => void tree.refetch()} />
        ) : shown.length === 0 ? (
          <EmptyState
            title={term === '' ? 'No categories' : 'Nothing matches'}
            description={
              term === ''
                ? 'None have been created yet.'
                : 'If nothing here fits what you sell, request a new category and say why.'
            }
            action={
              <Link href="/catalog/proposals">
                <Button size="md">Request a category</Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {shown.map(({ node, path, depth }) => (
              <li
                key={node.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                // Indent only when browsing; a search result shows its
                // full path instead, so indentation would be misleading.
                style={term === '' ? { paddingLeft: `${12 + depth * 18}px` } : undefined}
              >
                <div className="min-w-0">
                  <div className="text-text-bright text-sm">{term === '' ? node.name : path}</div>
                  <div className="text-text-faint text-xs">
                    <code>{node.slug}</code>
                    {node.defaultGstRate !== null && <> · GST {node.defaultGstRate}%</>}
                    {node.defaultHsCode !== null && <> · HS {node.defaultHsCode}</>}
                  </div>
                </div>
                <span className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAttrsFor(showAttrsFor === node.id ? null : node.id)}
                  >
                    {showAttrsFor === node.id ? 'Hide fields' : 'Required fields'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void copy(node.id)}>
                    {copied === node.id ? 'Copied' : 'Copy id'}
                  </Button>
                </span>
                {showAttrsFor === node.id && (
                  <div className="w-full basis-full pt-2">
                    <CategoryAttributes categoryId={node.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-3 text-text-muted text-sm">
        The id is what the product form and the CSV importer take — the name is not unique enough to
        key on.
      </p>
    </div>
  );
}

/**
 * The attributes a variant under this category must carry.
 *
 * Worth surfacing before someone uploads 400 rows: a required attribute
 * they have never heard of is a validation failure per row, and the
 * error report alone does not say what the allowed values are.
 */
function CategoryAttributes({ categoryId }: { readonly categoryId: string }): ReactElement {
  const attrs = useCategoryAttributes(categoryId);

  if (attrs.isLoading) return <SkeletonRows rows={2} />;
  if (attrs.isError) {
    return <ErrorNote message={serverVerdict(attrs.error)} retry={() => void attrs.refetch()} />;
  }
  const items = attrs.data ?? [];
  if (items.length === 0) {
    return (
      <p className="text-text-faint text-xs">
        Nothing extra required — the standard product fields are enough here.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {items.map((a) => (
        <li key={a.attributeKey} className="text-xs">
          <code className="text-text-bright">{a.attributeKey}</code>{' '}
          <span className="text-text-muted">
            {a.displayLabel} · {a.valueType.toLowerCase()}
          </span>
          {a.isRequired ? (
            <span className="text-[var(--color-warn)]"> · required</span>
          ) : (
            <span className="text-text-faint"> · optional</span>
          )}
          {a.allowedValues.length > 0 && (
            <div className="text-text-faint">one of: {a.allowedValues.join(', ')}</div>
          )}
        </li>
      ))}
    </ul>
  );
}
