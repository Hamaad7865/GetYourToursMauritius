'use client';

import { Fragment, useMemo } from 'react';
import { parseRichText, type RichSpan } from '@/lib/planner/rich-text';
import type { PlacePreview } from '@/lib/planner/place-lookup';
import { PlaceHint } from './PlaceHint';

/**
 * One ZilAi reply, rendered.
 *
 * ZilAi emphasises place and activity names with `**double asterisks**` and lists options with `* `
 * bullets. Printed as a raw string those markers leak into the bubble and the whole reply collapses
 * into one run-on line — which is most of why the chat read as a broken machine rather than a local
 * answering. Every emphasised name we recognise also becomes a {@link PlaceHint}, so hovering it
 * shows the place's photos and description.
 */
export function RichText({
  text,
  preview,
}: {
  text: string;
  /** Resolve an emphasised name to a preview card, or null when we don't know the place. */
  preview?: (name: string) => PlacePreview | null;
}) {
  const blocks = useMemo(() => parseRichText(text), [text]);

  const spans = (parts: RichSpan[], key: string) =>
    parts.map((span, i) => {
      if (!span.bold) return <Fragment key={`${key}-${i}`}>{span.text}</Fragment>;
      const hit = preview?.(span.text) ?? null;
      return hit ? (
        <PlaceHint key={`${key}-${i}`} label={span.text} preview={hit} />
      ) : (
        <strong key={`${key}-${i}`} className="font-bold text-ink">
          {span.text}
        </strong>
      );
    });

  return (
    <>
      {blocks.map((block, b) =>
        block.kind === 'list' ? (
          <ul key={b} className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 first:mt-0">
            {block.items.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-teal"
                />
                <span className="min-w-0">{spans(item, `${b}-${i}`)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={b} className="m-0 mt-2 first:mt-0">
            {block.lines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {spans(line, `${b}-${i}`)}
              </Fragment>
            ))}
          </p>
        ),
      )}
    </>
  );
}
