# Blog section rich-text formatting — design

- **Date:** 2026-08-28
- **Status:** Approved (brainstorming) — ready for implementation plan
- **Requested by:** SEO hire, via owner
- **Surface:** Admin blog editor + public blog article

## Problem

The SEO hire writes long-form blog guides in the admin (`/admin/blog`). Today a
post is built from **sections**, and each section body is a single plain
`<textarea>` (`src/components/admin/AdminBlog.tsx`). On the live article the body
renders as plain `<p>` paragraphs, and the only links that work are four
hard-coded internal shortcuts (`renderWithLinks` in
`app/(site)/blog/[slug]/page.tsx`).

She needs standard editorial formatting inside the body: **sub-headings, bold,
italic, and hyperlinks with an "open in new tab" option.** She framed the
headings as "H2 and H3"; since a section title already renders as the page `<h2>`,
that resolves to **H3/H4 sub-heads inside the body** (see Decisions) so the
heading hierarchy stays valid.

## Goals

- Bold, italic, H3 and H4 sub-headings, and arbitrary hyperlinks inside a blog
  section body.
- A hyperlink can open in a new tab (adds `target="_blank"` + `rel="noopener
noreferrer"`).
- The admin shows a formatted preview that is byte-for-byte the same as the live
  article.
- No regression for the ~10 built-in posts or any existing DB post.

## Non-goals (explicitly out of scope)

- **FAQ answers stay plain text.** They feed `faqPageJsonLd`
  (`src/lib/seo/jsonld.ts`); formatting markup would corrupt Google's FAQ
  rich-result structured data.
- Meta title, meta description, and excerpt stay plain text — they are `<title>`
  / `<meta>` / intro copy, not body content.
- No WYSIWYG / contentEditable editor, no stored HTML, no HTML sanitiser.
- No change to the section structure itself (heading + body + optional image).

## Decisions (from brainstorming)

| Decision      | Choice                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------ |
| Editing model | **Markdown-lite**: toolbar writes simple text marks; content stays plain text              |
| Admin preview | **Raw marks in the textarea + a live formatted preview pane below it**                     |
| Heading model | Section title stays the page `<h2>`; body supports **H3 and H4** sub-heads                 |
| Rendering     | **One shared, edge-safe React tokenizer** used by both the blog page and the admin preview |

## Content syntax

Stored inline in the existing `paragraphs: string[]` — **no data migration.** The
toolbar writes these; the writer rarely types them by hand.

Inline marks (apply within any block):

- `**bold**` → `<strong>`
- `_italic_` → `<em>`
- `[label](url)` → link, same tab
- `[label](url){_blank}` → link, `target="_blank" rel="noopener noreferrer"`

Block markers (a paragraph-block that _starts with_ the marker):

- `### Sub-head` → `<h3>`
- `#### Sub-head` → `<h4>`
- anything else → `<p>` (with inline marks applied)

Link behaviour:

- Internal links (`/…`) render through `next/link`; external (`http…`) render as
  `<a>`.
- The link popover pre-checks **Open in new tab** for external URLs and leaves it
  unchecked for internal `/…` links; the writer can always override.
- The four legacy auto-link shortcuts (`/airport-transfers`,
  `/ai-road-trip-planner`, `/attractions`, `/activities`) are preserved so old
  posts keep their links.

## Architecture

### Shared renderer (the load-bearing piece)

Extract today's inline `renderWithLinks` into a shared module, e.g.
`src/components/content/RichText.tsx`, exporting:

- `renderInline(text): ReactNode[]` — tokenizes inline marks + links (superset of
  the current `renderWithLinks`, keeping the legacy shortcuts).
- `renderBlocks(paragraphs: string[]): ReactNode` — classifies each block as
  `h3` / `h4` / `p` and renders it, calling `renderInline` for the text.

Constraints: pure JS/React, **edge-runtime safe** (the blog page is
`runtime = 'edge'`), returns React elements only — **no `dangerouslySetInnerHTML`,
no stored HTML, so no XSS surface and no sanitiser dependency.**

### Blog page

`app/(site)/blog/[slug]/page.tsx` replaces its local `renderWithLinks` and the
`section.paragraphs.map(<p>)` loop with `renderBlocks(section.paragraphs)`.

### Admin editor

`src/components/admin/AdminBlog.tsx` section body gains:

- A **toolbar** above the textarea: `H3`, `H4`, **B**, _I_, 🔗 Link.
  - B / I / H4… wrap or prefix the current selection/block in the textarea.
  - Link opens a small popover: URL field + **Open in new tab** checkbox +
    Insert; inserts `[selection](url)` or `[selection](url){_blank}`.
- A **live preview pane** below the textarea that renders the same
  `renderBlocks(...)` output, so preview == live article.

## Compatibility & i18n

- Existing posts are plain text and contain none of the markers → render exactly
  as before.
- Marks live inline in the section text, so French `PostTranslation` copy carries
  its own marks; the locale path needs no change.

## Files to touch

- `src/components/content/RichText.tsx` — **new** shared tokenizer + block
  renderer.
- `app/(site)/blog/[slug]/page.tsx` — use the shared renderer.
- `src/components/admin/AdminBlog.tsx` — toolbar + link popover + preview pane.
- `tests/unit/richtext.test.ts(x)` — **new** tokenizer tests.

## Testing (TDD — tokenizer first)

- Each inline mark in isolation: `**b**`, `_i_`, `[l](/x)`, `[l](https://x){_blank}`.
- Nesting: bold inside a link, italic inside bold.
- Block classification: `### `, `#### `, plain paragraph, and a `#`-inside-text
  false positive (marker only at block start).
- Malformed input: unclosed `**`, empty `[]()`, `[l]()` with no URL — must render
  as literal text, never throw.
- Link targets: internal `/…` → `next/link`; external → `<a>`; new-tab flag adds
  `target`/`rel`.
- Legacy shortcut auto-linking still fires.
- A plain-text (no-marker) input renders identically to the pre-change output.

## Risks / edge cases

- **Tokenizer correctness** is the whole risk; covered by unit tests above.
- Textarea caret math for block-level toolbar inserts (H3/H4) — insert on its own
  line separated by blank lines so the `\n{2,}` split keeps it a distinct block.
- Keep the renderer allocation-light; blog pages are edge-rendered per request.
