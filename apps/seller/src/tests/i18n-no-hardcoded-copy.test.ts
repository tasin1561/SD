import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

/*
  A structural spec: it reads SOURCES, not behaviour. The catalogue can be
  perfect and a screen still ships English, because nothing fails when somebody
  types a new sentence straight into JSX. This walks every component under
  src/app and src/components and fails on a literal that a person would read:

    - JSX text            <p>Nothing yet</p>
    - copy-bearing props  label= placeholder= hint= title= description= …
    - toast calls         toast.success('…')

  Identifiers are not copy and pass: SKU / AWB / order numbers are rendered
  from data, enum values and codes are not literals in JSX, and a prop value
  with no whitespace and no capital letter (`as-card`, `narrow`, `/orders`) is
  a token. Anything that genuinely must stay English goes in ALLOWED below,
  with the reason.
*/

const ROOT = join(__dirname, '..');
const COPY_PROPS = new Set([
  'label',
  'placeholder',
  'hint',
  'notice',
  'title',
  'description',
  'emptyTitle',
  'emptyBody',
  'aria-label',
  'alt',
  'caption',
  'confirmLabel',
  'cancelLabel',
  'buttonText',
  'busyLabel',
  'errorLabel',
  'doneLabel',
  'failedLabel',
  'subtitle',
  'heading',
  'note',
  'portal',
]);

/** literal → why it stays. Keep this list short; it is the escape hatch, not the norm. */
const ALLOWED = new Map<string, string>([['Skydrop', 'brand name']]);

/**
 * Files that still carry English the scanner can see, with the reason. This is
 * the honest list of what the seller pass did not reach: each entry shrinks the
 * gate's coverage, so it only ever gets shorter. (`app/dev/` is the component
 * gallery, which is not a screen anybody signs in to.)
 */
const PENDING = new Map<string, string>([]);

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
}

function isCopy(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!/[A-Za-z]{2}/.test(t)) return false;
  if (ALLOWED.has(t)) return false;
  return /\s/.test(t) || /[A-Z]/.test(t);
}

function offenders(file: string): string[] {
  return offendersIn(readFileSync(file, 'utf8'), file);
}

function offendersIn(src: string, file: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const at = (n: ts.Node): string =>
    `${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const strings = (n: ts.Expression | undefined): string[] => {
    if (n === undefined) return [];
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [n.text];
    if (ts.isParenthesizedExpression(n)) return strings(n.expression);
    if (ts.isConditionalExpression(n)) return [...strings(n.whenTrue), ...strings(n.whenFalse)];
    return [];
  };
  const visit = (n: ts.Node): void => {
    if (ts.isJsxText(n) && isCopy(n.text))
      found.push(`${at(n)}  JSX text: ${n.text.trim().slice(0, 60)}`);
    else if (
      ts.isJsxExpression(n) &&
      n.parent &&
      (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))
    ) {
      for (const s of strings(n.expression))
        if (isCopy(s)) found.push(`${at(n)}  JSX string: ${s.slice(0, 60)}`);
    } else if (ts.isJsxAttribute(n) && COPY_PROPS.has(n.name.getText())) {
      const i = n.initializer;
      const lits =
        i && ts.isStringLiteral(i)
          ? [i.text]
          : i && ts.isJsxExpression(i)
            ? strings(i.expression)
            : [];
      for (const s of lits)
        if (isCopy(s)) found.push(`${at(n)}  ${n.name.getText()}=: ${s.slice(0, 60)}`);
    } else if (ts.isCallExpression(n) && /(^|\.)toast(\.\w+)?$/.test(n.expression.getText())) {
      for (const s of strings(n.arguments[0]))
        if (isCopy(s)) found.push(`${at(n)}  toast: ${s.slice(0, 60)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe('seller console copy', () => {
  it('the scanner itself catches each shape it claims to (a clean result must be able to fail)', () => {
    const sample = `
      export function X() {
        toast.success('Saved it');
        return (
          <div title="Some title" data-x="as-card">
            <p>Nothing yet</p>
            {open ? 'Open now' : 'Closed now'}
            <Foo label="OK" />
            <Foo label={t('a.b')} />
          </div>
        );
      }`;
    const hits = offendersIn(sample, 'sample.tsx').map((h) => h.split('  ')[1] ?? '');
    expect(hits.join('|')).toContain('toast: Saved it');
    expect(hits.join('|')).toContain('title=: Some title');
    expect(hits.join('|')).toContain('JSX text: Nothing yet');
    expect(hits.join('|')).toContain('JSX string: Open now');
    expect(hits.join('|')).toContain('JSX string: Closed now');
    expect(hits.join('|')).toContain('label=: OK');
    expect(hits.some((h) => h.includes('as-card') || h.includes('a.b'))).toBe(false);
  });

  it('has no hard-coded English in any component (every visible string goes through t())', () => {
    const files: string[] = [];
    walk(join(ROOT, 'app'), files);
    walk(join(ROOT, 'components'), files);
    const all = files
      .filter((f) => !relative(ROOT, f).split('\\').join('/').startsWith('app/dev/'))
      .filter((f) => !PENDING.has(relative(ROOT, f).split('\\').join('/')))
      .flatMap(offenders);
    expect(all, `untranslated strings:\n${all.join('\n')}`).toEqual([]);
  });
});
