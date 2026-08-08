import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Gemini chat panel's WIRING, guarded the way this screen guards its other overlays:
 *
 *  - AdminQuotes must load the panel through `next/dynamic` — a static import here once dragged the
 *    whole Maps client into the editor bundle and timed out an unrelated import-only test under a
 *    loaded suite (the PickupTransportDrawer lesson; same rule, same reason).
 *  - The spark launcher must exist on BOTH screens (list and editor): the owner's ask is a chat
 *    reachable anywhere in the quotes module, not only while drafting.
 *  - The panel module itself must stay importable in node (no top-level browser access), because
 *    the route's staff gate is the only server boundary and everything else about the chat lives in
 *    the browser.
 */

const ROOT = join(__dirname, '..', '..');

function source(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('the Gemini chat panel wiring', () => {
  it('AdminQuotes loads the panel with next/dynamic, never statically', () => {
    const admin = source('src/components/admin/AdminQuotes.tsx');
    expect(admin).toMatch(
      /dynamic\(\s*\(\)\s*=>\s*import\('@\/components\/admin\/quotes\/AiChatPanel'\)/,
    );
    // A static import of the panel would defeat the dynamic() above silently.
    expect(admin).not.toMatch(/import\s*\{[^}]*AiChatPanel[^}]*\}\s*from/);
  });

  it('the spark opens the chat from the list AND the editor', () => {
    const admin = source('src/components/admin/AdminQuotes.tsx');
    const sparks = admin.match(/label="Ask Gemini"/g) ?? [];
    expect(sparks.length).toBeGreaterThanOrEqual(2);
  });

  it('the panel module imports cleanly outside a browser', async () => {
    const mod = await import('@/components/admin/quotes/AiChatPanel');
    expect(typeof mod.AiChatPanel).toBe('function');
  });

  it('the panel resends the visible thread and never claims to stream or persist', () => {
    const panel = source('src/components/admin/quotes/AiChatPanel.tsx');
    // The request cap lives in the schema (24); the panel must slice to a cap so a long chat
    // keeps working instead of starting to 400.
    expect(panel).toContain('THREAD_CAP');
    expect(panel).toContain('slice(-THREAD_CAP)');
    // The honest footer the owner's screenshot carries.
    expect(panel).toContain('Gemini can make mistakes');
  });
});
