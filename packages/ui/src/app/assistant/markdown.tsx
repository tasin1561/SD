import { Fragment, type MouseEvent, type ReactElement, type ReactNode } from 'react';

/**
 * A SAFE markdown subset, rendered as React elements.
 *
 * Text from the model and from tool results is UNTRUSTED. This file never
 * builds an HTML string and there is no `dangerouslySetInnerHTML`: every
 * piece of source text reaches the DOM as a React text node, so `<script>`
 * and `<img onerror>` are inert characters. A link is live only when its
 * target is `https://` (a `javascript:`/`data:` target is shown as plain
 * text), and the model can never link to an in-app route — the only in-app
 * links are the order numbers and waybills THIS file recognises itself.
 *
 * Supported: paragraphs, **bold**, bullet and numbered lists, `inline code`,
 * fenced code, [text](https://…) links, bare https:// links, # headings
 * (shown as bold lines).
 */

export type Inline =
  | { readonly k: 'text'; readonly v: string }
  | { readonly k: 'bold'; readonly c: readonly Inline[] }
  | { readonly k: 'code'; readonly v: string }
  | { readonly k: 'link'; readonly href: string; readonly v: string }
  | { readonly k: 'entity'; readonly kind: 'order' | 'awb'; readonly v: string };

export type Block =
  | { readonly k: 'p'; readonly lines: readonly (readonly Inline[])[] }
  | { readonly k: 'ul' | 'ol'; readonly items: readonly (readonly Inline[])[] }
  | { readonly k: 'pre'; readonly v: string };

/** Order numbers are `SD-YYYY-YY-NNNNNN`; Delhivery waybills are 13-15 digits. */
export const ORDER_NUMBER = /\bSD-\d{4}-\d{2}-\d{4,8}\b/;
export const AWB_NUMBER = /\b\d{13,15}\b/;

const INLINE =
  /(\*\*[^*\n]+?\*\*)|(`[^`\n]+`)|(\[[^\]\n]+\]\(([^)\s]+)\))|(https?:\/\/[^\s<>()]+)|(\bSD-\d{4}-\d{2}-\d{4,8}\b)|(\b\d{13,15}\b)/g;

function safeHref(url: string): boolean {
  return /^https:\/\/[^\s]+$/i.test(url);
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const re = new RegExp(INLINE.source, 'g');
  const pushText = (v: string): void => {
    if (v !== '') out.push({ k: 'text', v });
  };
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    pushText(src.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      out.push({ k: 'bold', c: parseInline(m[1].slice(2, -2)) });
    } else if (m[2] !== undefined) {
      const inner = m[2].slice(1, -1);
      if (new RegExp(`^(?:${ORDER_NUMBER.source})$`).test(inner)) {
        out.push({ k: 'entity', kind: 'order', v: inner });
      } else if (new RegExp(`^(?:${AWB_NUMBER.source})$`).test(inner)) {
        out.push({ k: 'entity', kind: 'awb', v: inner });
      } else {
        out.push({ k: 'code', v: inner });
      }
    } else if (m[3] !== undefined) {
      const label = m[3].slice(1, m[3].indexOf(']('));
      const url = m[4] ?? '';
      // An unsafe target is shown exactly as written: text, never a link.
      if (safeHref(url)) out.push({ k: 'link', href: url, v: label });
      else pushText(m[3]);
    } else if (m[5] !== undefined) {
      const trail = /[.,;:!?]+$/.exec(m[5]);
      const url = trail ? m[5].slice(0, -trail[0].length) : m[5];
      if (safeHref(url)) out.push({ k: 'link', href: url, v: url });
      else pushText(url);
      if (trail) pushText(trail[0]);
    } else if (m[6] !== undefined) {
      out.push({ k: 'entity', kind: 'order', v: m[6] });
    } else if (m[7] !== undefined) {
      out.push({ k: 'entity', kind: 'awb', v: m[7] });
    }
  }
  pushText(src.slice(last));
  return out;
}

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length > 0) {
      blocks.push({ k: 'p', lines: para.map(parseInline) });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*```/.test(line)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? '')) {
        code.push(lines[i] ?? '');
        i++;
      }
      blocks.push({ k: 'pre', v: code.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    const listMatch = bullet ?? numbered;
    if (listMatch !== null) {
      flushPara();
      const kind = bullet !== null ? 'ul' : 'ol';
      const prev = blocks[blocks.length - 1];
      const item = parseInline(listMatch[1] ?? '');
      if (prev !== undefined && prev.k === kind) {
        blocks[blocks.length - 1] = { k: kind, items: [...prev.items, item] };
      } else {
        blocks.push({ k: kind, items: [item] });
      }
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    if (heading !== null) {
      flushPara();
      blocks.push({ k: 'p', lines: [[{ k: 'bold', c: parseInline(heading[1] ?? '') }]] });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

export interface MarkdownProps {
  readonly text: string;
  /** This console's route for an order number or waybill; the ONLY in-app link made. */
  readonly entityHref: (value: string) => string;
  readonly onNavigate?: ((href: string) => void) | undefined;
}

function renderInline(
  nodes: readonly Inline[],
  props: MarkdownProps,
  keyPrefix: string,
): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}.${i}`;
    switch (n.k) {
      case 'text':
        return <Fragment key={key}>{n.v}</Fragment>;
      case 'bold':
        return <strong key={key}>{renderInline(n.c, props, key)}</strong>;
      case 'code':
        return (
          <code key={key} className="sk-ai-code">
            {n.v}
          </code>
        );
      case 'link':
        return (
          <a key={key} href={n.href} target="_blank" rel="noopener noreferrer nofollow">
            {n.v}
          </a>
        );
      case 'entity': {
        const href = props.entityHref(n.v);
        const onClick = (e: MouseEvent<HTMLAnchorElement>): void => {
          if (!props.onNavigate || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          props.onNavigate(href);
        };
        return (
          <a key={key} href={href} className="sk-ai-entity" data-kind={n.kind} onClick={onClick}>
            {n.v}
          </a>
        );
      }
    }
  });
}

export function Markdown(props: MarkdownProps): ReactElement {
  const blocks = parseBlocks(props.text);
  return (
    <div className="sk-ai-md">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.k) {
          case 'p':
            return (
              <p key={key}>
                {b.lines.map((line, j) => (
                  <Fragment key={j}>
                    {j > 0 ? <br /> : null}
                    {renderInline(line, props, `${key}.${j}`)}
                  </Fragment>
                ))}
              </p>
            );
          case 'ul':
          case 'ol': {
            const Tag = b.k;
            return (
              <Tag key={key}>
                {b.items.map((item, j) => (
                  <li key={j}>{renderInline(item, props, `${key}.${j}`)}</li>
                ))}
              </Tag>
            );
          }
          case 'pre':
            return (
              <pre key={key} className="sk-ai-pre">
                <code>{b.v}</code>
              </pre>
            );
        }
      })}
    </div>
  );
}
