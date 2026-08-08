import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The assistant's PLACE in the admin shell, guarded as source facts because they are the owner's
 * two explicit requirements and both are easy to regress invisibly:
 *
 *  1. it is reachable from the TOP BAR of every admin screen, not from one screen's toolbar;
 *  2. the panel is a COLUMN that narrows the content, never a sheet that covers it.
 *
 * (2) is asserted on the layout classes rather than by rendering, because the failure mode is
 * visual: a `fixed` panel with no `lg:static` looks identical in a DOM snapshot and wrong on screen.
 */

const ROOT = join(__dirname, '..', '..');
const source = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/**
 * The same file with `//` comments removed. A negative assertion ("this class is gone") otherwise
 * fails on the comment that EXPLAINS why it is gone — which would push the next author to delete
 * the explanation to make the test pass, exactly backwards.
 */
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');

describe('the assistant is global', () => {
  it('lives in the admin shell, wrapped in its provider', () => {
    const shell = source('src/components/admin/AdminShell.tsx');
    expect(shell).toContain('AssistantProvider');
    expect(shell).toMatch(
      /dynamic\(\s*\(\)\s*=>\s*import\('@\/components\/admin\/assistant\/AssistantPanel'\)/,
    );
    // A static import would defeat the dynamic() and put the chat in every screen's first paint.
    expect(shell).not.toMatch(/import\s*\{[^}]*AssistantPanel[^}]*\}\s*from/);
  });

  it('puts the launcher in the top bar, and the quotes screen no longer owns one', () => {
    expect(source('src/components/admin/AdminShell.tsx')).toContain('AssistantLauncher');
    const quotes = source('src/components/admin/AdminQuotes.tsx');
    expect(quotes).not.toContain('AiSparkButton');
    // The screen still describes itself to the assistant — that is how it stays context-aware.
    expect(quotes).toContain('useAssistantContext');
  });

  it('is withheld from the restricted content role, like the rest of the money surfaces', () => {
    const shell = source('src/components/admin/AdminShell.tsx');
    expect(shell).toMatch(/!isSeoRole && <AssistantPanel \/>/);
    expect(shell).toMatch(/!isSeoRole && <AssistantLauncher \/>/);
  });
});

describe('the panel pushes the content instead of covering it', () => {
  const panel = source('src/components/admin/assistant/AssistantPanel.tsx');

  it('becomes an in-flow, width-animated column from lg', () => {
    // The width pair is what makes the main column reflow. Losing it silently restores the
    // covering behaviour the owner rejected.
    expect(panel).toContain('lg:w-[400px]');
    expect(panel).toContain('lg:w-0');
    expect(panel).toContain('transition-[transform,width,opacity]');
  });

  it('is STICKY, not static — a static column scrolls away and leaves white space', () => {
    // Reported by the owner: scrolling a long quote form left blank space beside it. A static
    // column is exactly one viewport tall and scrolls off with the page; sticky stays in flow (so
    // it still pushes the content) but pins to the viewport.
    expect(panel).toContain('lg:sticky');
    expect(panel).toContain('lg:top-0');
    expect(code('src/components/admin/assistant/AssistantPanel.tsx')).not.toContain('lg:static');
  });

  it('grows the composer to fit a pasted thread, up to a cap', () => {
    // A rows={1} textarea keeps one line's height however much is pasted — and pasting an email
    // thread is the main thing this box is for. Driven by the VALUE so a programmatic fill grows too.
    expect(panel).toMatch(/el\.style\.height = 'auto'/);
    expect(panel).toMatch(/Math\.min\(el\.scrollHeight, 168\)/);
    expect(panel).toContain('max-h-[168px]');
  });

  it('keeps a scrim ONLY below lg, where it genuinely overlays', () => {
    expect(panel).toMatch(/ai-scrim[^"]*lg:hidden/);
  });

  it('sends the newest turns only, so a long chat cannot start failing the request cap', () => {
    expect(panel).toContain('slice(-THREAD_CAP)');
  });

  it('keeps the honest disclaimer', () => {
    expect(panel).toContain('Gemini can make mistakes');
  });
});

describe('the quote hand-off survives being applied on the quotes screen itself', () => {
  // The bug this guards: the hand-off was a `?assistant=draft` flag read by a MOUNT effect. Applying
  // while already on /admin/quotes changed no route, remounted nothing, and the effect never
  // re-fired — "pressing open does nothing". It now travels as context state, which every consumer
  // re-renders on regardless of navigation.
  it('carries the enquiry through the assistant context, not the URL or sessionStorage', () => {
    const provider = source('src/components/admin/assistant/AssistantProvider.tsx');
    expect(provider).toContain('quoteHandoff');
    expect(provider).toContain('handOffQuoteEmail');

    const lib = source('src/lib/admin/assistant.ts');
    expect(lib).toContain('handOffQuoteEmail');
    // A customer's email must never reach the URL or storage. Matched on the CALLS, not the word:
    // the module's comment explains why neither is used, and should stay readable.
    expect(code('src/lib/admin/assistant.ts')).not.toMatch(/sessionStorage/);
    expect(lib).not.toContain('assistant=draft');
  });

  it('both consumers key their effect on the VALUE, never on mount alone', () => {
    const quotes = source('src/components/admin/AdminQuotes.tsx');
    expect(quotes).toMatch(/useEffect\([\s\S]{0,120}?\}, \[handoff\]\)/);
    expect(code('src/components/admin/AdminQuotes.tsx')).not.toContain('assistant=draft');

    const draft = source('src/components/admin/quotes/DraftFromEmail.tsx');
    expect(draft).toMatch(/\}, \[handoff\]\)/);
    expect(code('src/components/admin/quotes/DraftFromEmail.tsx')).not.toContain('sessionStorage');
  });

  it('navigating to the page you are already on is guarded, since push would be a no-op', () => {
    const card = source('src/components/admin/assistant/ActionCard.tsx');
    expect(card).toMatch(/pathname !== href\.split\('\?'\)\[0\]/);
  });
});

describe('the animations respect reduced motion', () => {
  const css = source('app/globals.css');

  it('every assistant entrance is frozen to its RESTING state, not its first frame', () => {
    // `animation: none` on a `both`-filled keyframe would strand the element at `from` — invisible.
    // The reduced-motion block must therefore also reset transform and opacity.
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const cls of [
      '.ai-msg-in',
      '.ai-card-in',
      '.ai-suggestion',
      '.ai-chip',
      '.ai-spark-float',
    ]) {
      expect(reduced).toContain(cls);
    }
    expect(reduced).toMatch(/opacity: 1 !important/);
  });

  it('the panel modules import cleanly outside a browser', async () => {
    const panelMod = await import('@/components/admin/assistant/AssistantPanel');
    const cardMod = await import('@/components/admin/assistant/ActionCard');
    const providerMod = await import('@/components/admin/assistant/AssistantProvider');
    expect(typeof panelMod.AssistantPanel).toBe('function');
    expect(typeof cardMod.ActionCard).toBe('function');
    expect(typeof providerMod.AssistantProvider).toBe('function');
  });
});
