import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionCard } from '@/components/admin/assistant/ActionCard';
import { StaticAdminAccess } from '@/components/admin/AdminAccessProvider';
import { buildAccess } from '@/lib/admin/permissions';
import type { AssistantAction } from '@/lib/validation/admin-assistant';

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
  useRouter: () => ({ push: () => {} }),
}));

/**
 * Apply is the only place a proposal becomes real, and it runs as the signed-in member. The server
 * stops offering the model tools for sections the caller lacks; this is the second lock, for a card
 * that reaches the panel anyway (a thread kept open across a role change).
 */

const createTour: AssistantAction = {
  kind: 'create_tour',
  label: 'Create draft tour "Sunset cruise"',
  caveat: 'Created as a draft with no prices.',
  patch: { title: 'Sunset cruise' },
};
const updateTour: AssistantAction = {
  kind: 'update_tour',
  label: 'Rewrite the summary',
  caveat: 'Content only.',
  activityId: 'act-1',
  activityTitle: 'Catamaran Cruise',
  patch: { summary: 'New.' },
};
const draftQuote: AssistantAction = {
  kind: 'draft_quote_from_email',
  label: 'Draft a quote',
  caveat: 'Opens a new quote.',
  email: 'Hello, we are 4 adults and 2 children for the catamaran on 20 October.',
};

function render(action: AssistantAction, permissions: string[], role = 'staff'): string {
  const access = buildAccess({ role, teamRoleId: 'r', teamRoleName: 'Role', permissions });
  return renderToStaticMarkup(
    createElement(StaticAdminAccess, { value: access }, createElement(ActionCard, { action })),
  );
}

const HAS_APPLY = />Apply</;

describe('ActionCard withholds Apply from a role without the section', () => {
  it('a tour proposal needs Tours', () => {
    for (const action of [createTour, updateTour]) {
      const without = render(action, ['section.assistant', 'section.quotes']);
      expect(without).not.toMatch(HAS_APPLY);
      expect(without).toContain('doesn’t include Tours');
      expect(render(action, ['section.assistant', 'section.tours'])).toMatch(HAS_APPLY);
    }
  });

  it('a quote hand-off needs Quotes', () => {
    const without = render(draftQuote, ['section.assistant', 'section.tours']);
    expect(without).not.toMatch(HAS_APPLY);
    expect(without).toContain('doesn’t include Quotes');
    expect(render(draftQuote, ['section.assistant', 'section.quotes'])).toMatch(HAS_APPLY);
  });

  it('the Owner holds every section, so Apply is always there', () => {
    for (const action of [createTour, updateTour, draftQuote]) {
      expect(render(action, [], 'admin')).toMatch(HAS_APPLY);
    }
  });
});
