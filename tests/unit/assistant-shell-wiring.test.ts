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

  it('becomes a static, width-animated column from lg', () => {
    // `lg:static` is what takes it out of the overlay layer; the width pair is what makes the main
    // column reflow. Losing either one silently restores the covering behaviour the owner rejected.
    expect(panel).toContain('lg:static');
    expect(panel).toContain('lg:w-[400px]');
    expect(panel).toContain('lg:w-0');
    expect(panel).toContain('transition-[transform,width,opacity]');
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
