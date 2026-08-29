'use client';

import { useRef, useState } from 'react';
import { renderBlocks } from '@/components/content/RichText';
import { TEXTAREA_CLS } from '@/components/admin/ui';
import { IconLink } from '@/components/ui/icons';

/*
 * The blog section body editor: a plain textarea (content stays plain text) plus a toolbar that
 * writes markdown-lite marks, a link popover with an "open in new tab" toggle, and a live preview
 * rendered through the SAME renderer as the public article, so what she sees is what ships.
 */

const TBTN =
  'inline-flex h-8 items-center gap-1 rounded-lg border border-[#E2E7EA] bg-white px-2.5 text-[12.5px] font-semibold text-ink hover:border-teal hover:text-teal';

type LinkDraft = { start: number; end: number; url: string; newTab: boolean; touched: boolean };

export function RichBodyField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [link, setLink] = useState<LinkDraft | null>(null);
  const [linkError, setLinkError] = useState(false);

  /** Splice `insert` over [start,end), then restore focus with the caret/selection at `sel`. */
  function splice(start: number, end: number, insert: string, sel: [number, number]) {
    onChange(value.slice(0, start) + insert + value.slice(end));
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(sel[0], sel[1]);
    });
  }

  /** Wrap the current selection (bold/italic). With no selection, drop the caret between the marks. */
  function wrap(before: string, after: string) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const selected = value.slice(s, e);
    const insert = before + selected + after;
    const sel: [number, number] = selected
      ? [s, s + insert.length]
      : [s + before.length, s + before.length];
    splice(s, e, insert, sel);
  }

  /** Normalise the caret's line to a heading of the given level (toggles/replaces any existing one). */
  function heading(hashes: string) {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart;
    const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
    const nl = value.indexOf('\n', caret);
    const lineEnd = nl === -1 ? value.length : nl;
    const stripped = value.slice(lineStart, lineEnd).replace(/^#{1,4}\s+/, '');
    const line = `${hashes} ${stripped}`;
    splice(lineStart, lineEnd, line, [lineStart + line.length, lineStart + line.length]);
  }

  function openLink() {
    const el = ref.current;
    if (!el) return;
    setLinkError(false);
    setLink({
      start: el.selectionStart,
      end: el.selectionEnd,
      url: '',
      newTab: false,
      touched: false,
    });
  }

  function insertLink() {
    if (!link) return;
    const url = link.url.trim();
    if (!url) {
      setLinkError(true);
      return;
    }
    const label = value.slice(link.start, link.end) || 'link text';
    const markup = `[${label}](${url})${link.newTab ? '{_blank}' : ''}`;
    // Select the label so she can immediately type over the placeholder.
    const labelStart = link.start + 1;
    splice(link.start, link.end, markup, [labelStart, labelStart + label.length]);
    setLink(null);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={TBTN} onClick={() => heading('###')}>
          H3
        </button>
        <button type="button" className={TBTN} onClick={() => heading('####')}>
          H4
        </button>
        <span className="mx-0.5 h-5 w-px bg-[#E2E7EA]" aria-hidden="true" />
        <button
          type="button"
          aria-label="Bold"
          className={`${TBTN} font-bold`}
          onClick={() => wrap('**', '**')}
        >
          B
        </button>
        <button
          type="button"
          aria-label="Italic"
          className={`${TBTN} italic`}
          onClick={() => wrap('_', '_')}
        >
          I
        </button>
        <span className="mx-0.5 h-5 w-px bg-[#E2E7EA]" aria-hidden="true" />
        <button type="button" className={TBTN} onClick={openLink}>
          <IconLink width={14} height={14} /> Link
        </button>
      </div>

      {link && (
        <div className="mt-2 rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] p-3">
          <p className="text-[12.5px] font-bold text-ink/60">Insert link</p>
          <input
            autoFocus
            value={link.url}
            onChange={(e) => {
              const url = e.target.value;
              setLinkError(false);
              setLink((l) =>
                l ? { ...l, url, newTab: l.touched ? l.newTab : /^https?:\/\//i.test(url) } : l,
              );
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                insertLink();
              }
            }}
            placeholder="/activities or https://example.com"
            className="mt-1.5 w-full rounded-lg border border-[#E2E7EA] bg-white px-3 py-2 text-sm text-ink outline-none focus:border-teal"
          />
          {linkError && (
            <p role="alert" className="mt-1 text-[12px] font-medium text-coral-dark">
              Enter a URL first.
            </p>
          )}
          <label className="mt-2 flex items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={link.newTab}
              onChange={(e) =>
                setLink((l) => (l ? { ...l, newTab: e.target.checked, touched: true } : l))
              }
              className="h-4 w-4 accent-teal"
            />
            Open in new tab
          </label>
          <p className="ml-6 text-[12px] text-ink-muted">
            Adds <code>target=_blank</code> and <code>rel=noopener</code>.
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={insertLink}
              className="rounded-lg bg-teal px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-teal-dark"
            >
              Insert
            </button>
            <button
              type="button"
              onClick={() => setLink(null)}
              className="text-[12.5px] font-semibold text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        placeholder={placeholder}
        className={`mt-2 w-full ${TEXTAREA_CLS}`}
      />
      <p className="mt-1 text-[12px] text-ink-muted">
        Separate paragraphs with a blank line. Headings sit on their own line. Select text, then a
        button, to format it.
      </p>

      {value.trim() && (
        <div className="mt-3">
          <p className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">Preview</p>
          <div className="mt-1.5 rounded-xl border border-[#EAEEF0] bg-white p-4">
            {renderBlocks(value.split(/\n{2,}/))}
          </div>
        </div>
      )}
    </div>
  );
}
