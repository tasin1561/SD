// Critical CSS, postbuild. Next (with cssChunking:false) emits ONE
// stylesheet per page as a render-blocking <link>. For every exported
// page this script:
//   1. takes the ABOVE-THE-FOLD markup — everything up to the end of the
//      hero section (or the first section/form on a page without one),
//      plus everything after </main> (the fixed bottom bar and contact
//      button are visible at once);
//   2. keeps a rule when every class and id it names appears in that
//      markup (element-only, :root, @font-face, @property and keyframes
//      are always kept — Tailwind's @layer wrappers are walked);
//   3. inlines those rules as <style data-critical> and turns the
//      stylesheet <link> into a preload that upgrades to a stylesheet on
//      load (<noscript> keeps the plain link), so the full sheet never
//      blocks the first paint.
// Gates: inlined CSS ≤ 15 000 B gz per page; check-bundle holds
// index.html ≤ 75 000 B gz.
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import postcss from 'postcss';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'out');
const LIMIT = 15_000;
/** Stylesheets of components whose real markup appears only after hydration (see usedTokens). */
const HYDRATION_ONLY_STYLESHEETS = ['src/components/micro/theme-switch/theme-switch.css'];
const unescapeCss = (s) => s.replace(/\\(.)/g, '$1');

// CSS escapes: Tailwind writes `.lg\:flex`, `.text-\[12px\]`, `.w-1\/2`. The
// pseudo-class and attribute strippers below must not see the escaped
// characters, so every `\X` becomes a private-use placeholder first and is
// mapped back when the token is compared with the markup. Before this
// (2026-09-21) `:flex` was stripped as a pseudo-class and `[12px]` as an
// attribute, so EVERY responsive/variant utility above the fold was dropped
// from the critical sheet: the header rendered mobile-shaped for ~400 ms
// at 1440 and the deferred sheet then moved <main> by 30 px (CLS 0.064).
const HOLD = '\uE000';
const holdEscapes = (s) =>
  s.replace(/\\(.)/g, (_, c) => `${HOLD}${c.charCodeAt(0).toString(16).padStart(4, '0')}${HOLD}`);
const releaseEscapes = (s) =>
  s.replace(/\uE000([0-9a-f]{4})\uE000/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

/** Class and id tokens a selector depends on. Pseudo-classes and attribute selectors are ignored. */
function selectorTokens(selector) {
  const classes = new Set();
  const ids = new Set();
  const held = holdEscapes(selector);
  // Strip attribute selectors and :not(...)/:is(...) contents' brackets to avoid mis-reads.
  const cleaned = held
    .replace(/\[[^\]]*\]/g, '')
    .replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, (m) =>
      /^::?(is|where|not|has)\(/.test(m) ? m.slice(m.indexOf('(') + 1, -1) : '',
    );
  for (const m of cleaned.matchAll(/\.([^\s.#:>+~,()\[\]]+)/g)) classes.add(releaseEscapes(m[1]));
  for (const m of cleaned.matchAll(/#([^\s.#:>+~,()\[\]]+)/g)) ids.add(releaseEscapes(m[1]));
  return { classes, ids };
}

function foldMarkup(html) {
  const heroEnd = (() => {
    const i = html.indexOf('id="top"');
    if (i < 0) return -1;
    const j = html.indexOf('</section>', i);
    return j < 0 ? -1 : j + '</section>'.length;
  })();
  let cut = heroEnd;
  if (cut < 0) {
    const mainStart = html.indexOf('<main');
    const firstSection = html.indexOf('</section>', mainStart);
    const firstForm = html.indexOf('</form>', mainStart);
    const c = [firstSection, firstForm].filter((n) => n > 0);
    cut = c.length ? Math.min(...c) + 10 : Math.min(html.length, mainStart + 60_000);
  }
  const mainEnd = html.indexOf('</main>');
  const tail = mainEnd > 0 ? html.slice(mainEnd) : '';
  return html.slice(0, cut) + tail;
}

function usedTokens(markup) {
  const classes = new Set();
  const ids = new Set();
  for (const m of markup.matchAll(/class="([^"]*)"/g))
    for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
  for (const m of markup.matchAll(/\sid="([^"]*)"/g)) ids.add(m[1]);
  // State classes toggled by JS at load or first interaction.
  for (const c of ['is-moving', 'is-select', 'data-none']) classes.add(c);
  // Components that render a placeholder on the server and their real markup
  // only after hydration (the theme switch cannot know the theme before the
  // client runs). Their classes are not in the fold markup, so read them off
  // their own stylesheet — otherwise the switch pops in unstyled for the
  // ~400 ms until the deferred sheet lands (seen 2026-09-21: 14×56 px).
  for (const file of HYDRATION_ONLY_STYLESHEETS)
    for (const m of readFileSync(join(ROOT, file), 'utf8').matchAll(/\.((?:\\.|[a-zA-Z0-9_-])+)/g))
      classes.add(unescapeCss(m[1]));
  return { classes, ids };
}

function critical(css, used) {
  const root = postcss.parse(css);
  const keepRule = (rule) => {
    const selectors = rule.selectors ?? [rule.selector];
    const kept = selectors.filter((sel) => {
      const { classes, ids } = selectorTokens(sel);
      for (const c of classes) if (!used.classes.has(c)) return false;
      for (const i of ids) if (!used.ids.has(i)) return false;
      return true;
    });
    if (kept.length === 0) return false;
    rule.selectors = kept;
    return true;
  };
  const walk = (container) => {
    container.each((node) => {
      if (node.type === 'rule') {
        if (!keepRule(node)) node.remove();
      } else if (node.type === 'atrule') {
        if (['font-face', 'property', 'keyframes', 'charset', 'import'].includes(node.name)) return;
        if (node.nodes) {
          walk(node);
          if (node.nodes.length === 0) node.remove();
        }
      } else if (node.type === 'comment') node.remove();
    });
  };
  walk(root);
  return root
    .toString()
    .replace(/\s*\n\s*/g, '')
    .replace(/;\}/g, '}');
}

const pages = readdirSync(OUT).filter((n) => n.endsWith('.html'));
const rows = [];
let failed = false;
for (const name of pages) {
  const path = join(OUT, name);
  const html = readFileSync(path, 'utf8');
  if (html.includes('data-critical')) continue; // already processed (re-run)
  const links = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/g)];
  if (links.length === 0) continue;
  const css = links.map((m) => readFileSync(join(OUT, m[1]), 'utf8')).join('\n');
  const inline = critical(css, usedTokens(foldMarkup(html)));
  const gz = gzipSync(inline).length;
  const swap = links
    .map(
      (m) =>
        `<link rel="preload" as="style" href="${m[1]}" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="${m[1]}"></noscript>`,
    )
    .join('');
  let out = html;
  for (const m of links) out = out.replace(m[0], '');
  out = out.replace('</head>', `<style data-critical>${inline}</style>${swap}</head>`);
  writeFileSync(path, out);
  const total = gzipSync(out).length;
  rows.push(
    `${failed || gz > LIMIT ? 'FAIL' : 'OK  '} ${name.padEnd(22)} critical ${(gz / 1024).toFixed(1)} KB gz / 14.6 KB  page ${(total / 1024).toFixed(1)} KB gz  (full sheet ${(gzipSync(css).length / 1024).toFixed(1)} KB gz, ${links.length} link${links.length === 1 ? '' : 's'})`,
  );
  if (gz > LIMIT) failed = true;
}
console.log('critical-css\n' + rows.join('\n'));
if (failed) {
  console.error('critical-css FAILED: inlined CSS over 15 000 B gz');
  process.exit(1);
}
