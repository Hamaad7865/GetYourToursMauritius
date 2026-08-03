import { describe, expect, it } from 'vitest';
import { translationRowFromForm, isMachineDraft } from '@/lib/admin/activity-write';

/**
 * Saving French copy must flip source to 'human'. If it stayed 'machine', the owner's own edits
 * would keep showing the "needs review" badge and the worklist would never empty — the badge would
 * become noise and get ignored, which defeats the point of flagging drafts at all.
 */
describe('activity translation save', () => {
  const base = {
    title: 'Titre',
    summary: null,
    description: null,
    meetingPoint: null,
    seoTitle: null,
    seoDescription: null,
    supplementName: null,
    highlights: [],
    inclusions: [],
    exclusions: [],
  };

  it('marks an owner-edited translation as human-reviewed', () => {
    expect(translationRowFromForm('act-1', base).source).toBe('human');
  });

  it('maps camelCase form fields onto snake_case columns', () => {
    const row = translationRowFromForm('act-1', {
      ...base,
      meetingPoint: 'Quai de Trou d’Eau Douce',
    });
    expect(row.meeting_point).toBe('Quai de Trou d’Eau Douce');
    expect(row.activity_id).toBe('act-1');
    expect(row.locale).toBe('fr');
  });

  it('treats an empty string as untranslated (null), so SQL falls back to English', () => {
    // '' would win the coalesce and blank the field on the live page.
    expect(translationRowFromForm('act-1', { ...base, summary: '' }).summary).toBeNull();
  });

  it('treats a whitespace-only string as untranslated too', () => {
    expect(translationRowFromForm('act-1', { ...base, summary: '   ' }).summary).toBeNull();
  });

  it('identifies rows still awaiting review', () => {
    expect(isMachineDraft({ source: 'machine' })).toBe(true);
    expect(isMachineDraft({ source: 'human' })).toBe(false);
    expect(isMachineDraft(null)).toBe(false);
    expect(isMachineDraft(undefined)).toBe(false);
  });
});
