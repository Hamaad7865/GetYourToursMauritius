import type { ReactNode } from 'react';
import Link from 'next/link';
import { parseBlocks, type Block, type InlineToken } from '@/lib/content/richtext';
import { IconExternalLink } from '@/components/ui/icons';

/*
 * Renders the markdown-lite token tree from `@/lib/content/richtext` into React. Used in two places
 * off the SAME parser so they cannot diverge: the live blog article (server, edge) and the admin
 * editor's live preview (client). No `dangerouslySetInnerHTML` — every node is a real element, so
 * there is no HTML to sanitise and no injection surface.
 */

const LINK_CLS = 'font-semibold text-teal underline underline-offset-2 hover:text-teal-dark';

function renderInline(tokens: InlineToken[]): ReactNode[] {
  return tokens.map((tok, i) => {
    switch (tok.kind) {
      case 'text':
        return <span key={i}>{tok.value}</span>;
      case 'strong':
        return (
          <strong key={i} className="font-semibold text-ink">
            {renderInline(tok.children)}
          </strong>
        );
      case 'em':
        return (
          <em key={i} className="italic">
            {renderInline(tok.children)}
          </em>
        );
      case 'link': {
        const inner = renderInline(tok.children);
        // Internal paths keep client-side navigation via next/link; external URLs are plain anchors.
        const external = !tok.href.startsWith('/');
        const newTabProps = tok.newTab
          ? { target: '_blank', rel: 'noopener noreferrer' as const }
          : {};
        const flag = tok.newTab ? (
          <>
            <IconExternalLink width={12} height={12} className="ml-0.5 inline-block align-[-1px]" />
            <span className="sr-only"> (opens in a new tab)</span>
          </>
        ) : null;
        return external ? (
          <a key={i} href={tok.href} className={LINK_CLS} {...newTabProps}>
            {inner}
            {flag}
          </a>
        ) : (
          <Link key={i} href={tok.href} className={LINK_CLS} {...newTabProps}>
            {inner}
            {flag}
          </Link>
        );
      }
    }
  });
}

function renderBlock(block: Block, key: number): ReactNode {
  const inner = renderInline(block.children);
  switch (block.kind) {
    case 'h3':
      return (
        <h3 key={key} className="mt-6 text-[17px] font-bold tracking-tight text-ink first:mt-0">
          {inner}
        </h3>
      );
    case 'h4':
      return (
        <h4 key={key} className="mt-5 text-[15.5px] font-semibold text-ink first:mt-0">
          {inner}
        </h4>
      );
    default:
      return (
        <p key={key} className="mt-3.5 text-[15.5px] leading-relaxed text-ink/80 first:mt-0">
          {inner}
        </p>
      );
  }
}

/** Render a post section's stored paragraphs (blank-line separated) as formatted blocks. */
export function renderBlocks(paragraphs: string[]): ReactNode {
  return parseBlocks(paragraphs).map(renderBlock);
}
