'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { useCategories } from '@/lib/categories/useCategories';
import { loadContentDefaults as loadContentDefaultsMap } from '@/lib/admin/content-defaults';
import { highlightsAreOverridden, type ContentDefaults } from '@/lib/catalogue/content-defaults';
import { SectionRail } from '@/components/admin/activity/SectionRail';
import {
  defaultSection,
  isSectionId,
  sectionIssues,
  visibleSections,
  type SectionId,
} from '@/components/admin/activity/sections';
import { BasicsSection } from '@/components/admin/activity/BasicsSection';
import { DescriptionSection } from '@/components/admin/activity/DescriptionSection';
import { MediaSection } from '@/components/admin/activity/MediaSection';
import { PricingSection } from '@/components/admin/activity/PricingSection';
import { ItinerarySection } from '@/components/admin/activity/ItinerarySection';
import { LogisticsSection } from '@/components/admin/activity/LogisticsSection';
import { InclusionsSection } from '@/components/admin/activity/InclusionsSection';
import { BadgesSection } from '@/components/admin/activity/BadgesSection';
import { SearchSection } from '@/components/admin/activity/SearchSection';
import { FrenchSection } from '@/components/admin/activity/FrenchSection';
import {
  EMPTY_ACTIVITY,
  EMPTY_ACTIVITY_TRANSLATION,
  createActivity,
  loadActivityForEdit,
  loadActivityTranslation,
  saveActivityTranslation,
  slugify,
  updateActivity,
  type ActivityFormValues,
  type ActivityTranslationForm,
} from '@/lib/admin/activity-write';

/**
 * The tour editor.
 *
 * This file owns the tour's state, its one load and its one save; every field lives in a pane under
 * `activity/` and the rail decides which pane is on screen. It used to be all of that in one
 * 1,548-line file rendering nine stacked cards — about six screens of scrolling to reach the price
 * tiers. Splitting the LAYOUT rather than the SAVE is the point: there is still exactly one save
 * path, so the write layer (`activity-write.ts`, incl. the option/price reconcile and the
 * staff-gated materialize RPC) did not have to change at all.
 */
export function ActivityForm({ mode, id }: { mode: 'new' | 'edit'; id?: string }) {
  const router = useRouter();
  const { profile } = useAuth();
  // The restricted 'seo' content role edits copy/photos/itinerary only: the pricing pane is hidden
  // and the save skips options/prices + the staff-gated materialize RPC (RLS blocks them).
  const contentOnly = profile?.role === 'seo';
  const categories = useCategories();
  const [values, setValues] = useState<ActivityFormValues | null>(
    mode === 'new' ? EMPTY_ACTIVITY : null,
  );
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  // Shows the "Saved ✓" confirmation after a successful save. Cleared the moment any field is
  // edited again (see `set`/`onTitle`/`onSlug`/`editFr`), so it only ever marks the current state.
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugLocked, setSlugLocked] = useState(mode === 'edit');
  const [active, setActive] = useState<SectionId>(defaultSection(false));
  // Rail dots stay off until the first save attempt — a brand-new tour has an empty title by
  // definition, and flagging that before anyone has tried to save is just nagging.
  const [submitted, setSubmitted] = useState(false);
  // Which categories have standard highlights — drives the notice on the Highlights field, since a
  // category's standard highlights REPLACE whatever is typed there. Best-effort: a failure just
  // means no notice, never a broken form.
  const [contentDefaults, setContentDefaults] = useState<Record<string, ContentDefaults>>({});
  // The activity's French translation (activity_translations, locale 'fr'). Loaded ALONGSIDE the
  // activity itself (same loading gate below) rather than in its own best-effort effect: saving the
  // form always upserts whatever is in `fr`, so if this failed to load independently and the admin
  // saved anyway, a real translation could be silently overwritten with nulls. Blocking the whole
  // form on this load, like the activity load, means that can't happen.
  const [fr, setFr] = useState<ActivityTranslationForm>(EMPTY_ACTIVITY_TRANSLATION);
  // 'machine' | 'human' | undefined (no translation row yet, e.g. a brand-new activity).
  const [frSource, setFrSource] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadContentDefaultsMap()
      .then((d) => {
        if (!cancelled) setContentDefaults(d);
      })
      .catch(() => {
        /* no notice is better than a broken editor */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Deep link: /admin/activities/<id>/edit?s=pricing opens straight on that pane. Read AFTER mount,
  // never in a `useState` initialiser — `window` doesn't exist during SSR, so seeding state from it
  // would make the client's first render disagree with the server's.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('s');
    if (isSectionId(requested, contentOnly)) setActive(requested);
    // A brand-new tour redirects to its own edit URL with ?saved=1 after Create, so the owner lands
    // INSIDE the tour they just made with the confirmation showing. Strip the flag so a reload
    // doesn't re-show it.
    if (params.get('saved') === '1') {
      setJustSaved(true);
      setSubmitted(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('saved');
      window.history.replaceState(null, '', url);
    }
  }, [contentOnly]);

  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    Promise.all([loadActivityForEdit(id), loadActivityTranslation(id)])
      .then(([v, t]) => {
        if (v) setValues(v);
        else setError('Activity not found.');
        setFr(t ? t.form : EMPTY_ACTIVITY_TRANSLATION);
        setFrSource(t?.source);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load.'))
      .finally(() => setLoading(false));
  }, [mode, id]);

  // Re-read the activity from the DB into the form after a save. This is what lets an edit-mode save
  // STAY in the tour: newly-added options/supplements come back carrying their fresh database ids, so
  // the next save reconciles them in place instead of inserting duplicates.
  async function reloadInto(activityId: string) {
    const [v, t] = await Promise.all([
      loadActivityForEdit(activityId),
      loadActivityTranslation(activityId),
    ]);
    if (v) setValues(v);
    setFr(t ? t.form : EMPTY_ACTIVITY_TRANSLATION);
    setFrSource(t?.source);
  }

  if (loading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!values) return <p className="text-sm text-coral">{error ?? 'Not found.'}</p>;
  const v = values;
  const highlightsOverridden = highlightsAreOverridden(v.category, contentDefaults);
  const sections = visibleSections(contentOnly);
  // The seo role can arrive on ?s=pricing before its profile has loaded, which would leave the rail
  // pointing at a pane that no longer exists once it has.
  const current = sections.some((s) => s.id === active) ? active : defaultSection(contentOnly);
  const issues = submitted ? sectionIssues(v, contentOnly) : {};

  function set<K extends keyof ActivityFormValues>(key: K, val: ActivityFormValues[K]) {
    setJustSaved(false);
    setValues((prev) => (prev ? { ...prev, [key]: val } : prev));
  }

  // The French pane edits `fr` directly (not through `set`); wrap it so those edits also drop the
  // stale "Saved ✓" badge.
  function editFr(next: React.SetStateAction<ActivityTranslationForm>) {
    setJustSaved(false);
    setFr(next);
  }

  function selectSection(next: SectionId) {
    setActive(next);
    const url = new URL(window.location.href);
    url.searchParams.set('s', next);
    // replaceState, not push: switching panes is not a navigation, and Back should leave the editor
    // rather than walk every pane the owner looked at.
    window.history.replaceState(null, '', url);
    window.scrollTo({ top: 0 });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setJustSaved(false);
    setSubmitted(true);
    // One pane is on screen, so an error about a private option is useless while you're looking at
    // Basics. Check before writing and go to the pane that owns the problem.
    const found = sectionIssues(v, contentOnly);
    const firstBad = sections.find((s) => found[s.id]);
    if (firstBad) {
      setActive(firstBad.id);
      setError(found[firstBad.id] ?? null);
      return;
    }
    setSaving(true);
    try {
      if (mode === 'new') {
        const newId = await createActivity(v, { contentOnly });
        // Saving the activity always saves its French alongside it — the owner typing (or simply
        // reviewing and clicking Save) IS the review, so this also clears the machine-draft badge.
        await saveActivityTranslation(newId, fr);
        // Stay IN the tour instead of bouncing to the list: switch this editor over to the tour that
        // was just created so a second save edits it in place (no duplicate). ?saved=1 re-shows the
        // confirmation after the edit page remounts with fresh, id-carrying data.
        router.replace(`/admin/activities/${newId}/edit?s=${current}&saved=1`);
        router.refresh();
        return;
      }
      if (id) {
        await updateActivity(id, v, { contentOnly });
        await saveActivityTranslation(id, fr);
        // Reload so newly-added options/supplements pick up their database ids, then stay on the
        // current pane with a "Saved ✓" confirmation rather than leaving the tour.
        await reloadInto(id);
        setJustSaved(true);
        // Revalidate the public site's server components so the change shows there too.
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the activity.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 pb-16 lg:flex-row lg:items-start lg:gap-6">
      <SectionRail
        sections={sections}
        active={current}
        onSelect={selectSection}
        values={v}
        issues={issues}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {current === 'basics' && (
          <BasicsSection
            v={v}
            set={set}
            categories={categories}
            onTitle={(title) =>
              setValues((prev) =>
                prev ? { ...prev, title, slug: slugLocked ? prev.slug : slugify(title) } : prev,
              )
            }
            onSlug={(slug) => {
              setSlugLocked(true);
              set('slug', slugify(slug));
            }}
          />
        )}
        {current === 'description' && <DescriptionSection v={v} set={set} />}
        {current === 'media' && <MediaSection v={v} set={set} />}
        {current === 'pricing' && <PricingSection v={v} set={set} />}
        {current === 'itinerary' && <ItinerarySection v={v} set={set} />}
        {current === 'logistics' && <LogisticsSection v={v} set={set} />}
        {current === 'inclusions' && (
          <InclusionsSection v={v} set={set} highlightsOverridden={highlightsOverridden} />
        )}
        {current === 'badges' && <BadgesSection v={v} set={set} />}
        {current === 'search' && <SearchSection v={v} set={set} />}
        {current === 'french' && (
          <FrenchSection
            fr={fr}
            setFr={editFr}
            frSource={frSource}
            // The supplements' FR labels live on the activity_supplements rows themselves, saved by
            // the main save path — not the translation upsert. The restricted 'seo' role can't write
            // that table (contentOnly saves skip the reconcile), so it doesn't get the inputs.
            supplements={contentOnly ? undefined : v.supplements}
            setSupplements={contentOnly ? undefined : (next) => set('supplements', next)}
          />
        )}

        {error && (
          <p
            role="alert"
            className="rounded-xl bg-coral/10 px-4 py-3 text-sm font-medium text-coral"
          >
            {error}
          </p>
        )}

        <div className="sticky bottom-0 flex items-center gap-2 border-t border-[#EAEEF0] bg-white/95 py-4 backdrop-blur">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center rounded-xl bg-teal px-5 py-2.5 text-[13.5px] font-bold text-white hover:bg-teal-dark disabled:opacity-50"
          >
            {saving ? 'Saving…' : mode === 'new' ? 'Create activity' : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/admin/activities')}
            className="inline-flex items-center justify-center rounded-xl border border-[#E2E7EA] bg-white px-5 py-2.5 text-[13.5px] font-semibold text-ink hover:border-teal hover:text-teal"
          >
            {mode === 'new' ? 'Cancel' : 'Back to tours'}
          </button>
          {justSaved ? (
            <span
              role="status"
              className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] font-bold text-teal"
            >
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M5 10.5l3.2 3.2L15 7"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Saved — you’re still in this tour
            </span>
          ) : (
            <span className="ml-auto text-[12px] text-ink-muted">Saving keeps you in the tour</span>
          )}
        </div>
      </div>
    </form>
  );
}
