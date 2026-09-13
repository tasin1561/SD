import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageHeader, Section } from '@skydrop/ui/components';

/**
 * No block element may sit inside a <p> in the page chrome.
 *
 * PageHeader and Section used to wrap their help panel in a <p>. The
 * panel is a <div> (the grid-rows disclosure), and the browser's HTML
 * parser will not nest a block inside a <p>: it closes the <p> early,
 * so the DOM React hydrates against differs from the tree it rendered.
 * That was a hydration failure (React #418) on every signed-in page
 * with a subtitle — which is nearly all of them — and React 19's
 * recovery, regenerating the tree on the client, reset <html>'s
 * attributes and dropped a pinned light theme back to dark.
 *
 * The SERVER markup is what the parser sees, so that is what is
 * checked: rendered to a string, a <p> must never contain a <div>.
 */
function hasBlockInsideParagraph(html: string): boolean {
  // Walk the tags; track whether we are inside an open <p>.
  const tags = html.match(/<\/?[a-zA-Z][^>]*>/g) ?? [];
  let depth = 0;
  for (const tag of tags) {
    const name = /^<\/?([a-zA-Z0-9]+)/.exec(tag)?.[1]?.toLowerCase();
    const closing = tag.startsWith('</');
    if (name === 'p') {
      // A <p> opened inside a <p> is just as invalid as a <div>.
      if (!closing && depth > 0) return true;
      depth += closing ? -1 : 1;
    } else if (depth > 0 && !closing && /^(div|section|ul|ol|table|h[1-6])$/.test(name ?? '')) {
      return true;
    }
  }
  return false;
}

describe('page chrome renders valid HTML (no block inside <p>)', () => {
  it('PageHeader with a subtitle', () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Orders" subtitle="Cross-seller order list." />,
    );
    expect(html).toContain('Cross-seller order list.');
    expect(hasBlockInsideParagraph(html)).toBe(false);
  });

  it('PageHeader whose subtitle is itself a paragraph', () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Orders" subtitle={<p>Two sentences. Of guidance.</p>} />,
    );
    // Also covers a <p> inside a <p>: the wrapper must not be one.
    expect(hasBlockInsideParagraph(html)).toBe(false);
  });

  it('Section with a subtitle', () => {
    const html = renderToStaticMarkup(
      <Section title="Charges" subtitle="What was billed.">
        <div>body</div>
      </Section>,
    );
    expect(hasBlockInsideParagraph(html)).toBe(false);
  });

  it('the checker itself catches the old shape', () => {
    // Guard the guard: the markup PageHeader used to produce.
    expect(hasBlockInsideParagraph('<p class="x"><div id="h">help</div></p>')).toBe(true);
    expect(hasBlockInsideParagraph('<p><p>nested</p></p>')).toBe(true);
    // And does not mistake an SVG <path> for a <p>.
    expect(hasBlockInsideParagraph('<p><svg><path d="M1"></path></svg></p>')).toBe(false);
  });
});
