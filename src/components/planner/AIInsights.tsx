'use client';

import { useEffect, useRef, useState } from 'react';
import type { PlannerPlace } from '@/lib/validation/planner';
import { useT } from '@/components/site/PreferencesProvider';

interface Insights {
  overall: string;
  items: Array<{ name: string; insight: string }>;
}

/**
 * AI Insights — a Gemini-written local take on the day's places (one insight each + an overall tip),
 * the way the competitor's planner does, but original content we generate. Auto-loads when the day
 * changes, debounced, and cached per itinerary (sorted stop ids) so revisiting a day costs nothing.
 * Hides itself with no stops, and degrades quietly when the AI isn't configured.
 */
export function AIInsights({ stops }: { stops: PlannerPlace[] }) {
  const t = useT();
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const cache = useRef<Map<string, Insights | null>>(new Map());
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  const key = stops.map((s) => s.id).join(',');

  useEffect(() => {
    if (!key) {
      setInsights(null);
      setUnavailable(false);
      setLoading(false);
      return;
    }
    if (cache.current.has(key)) {
      const cached = cache.current.get(key) ?? null;
      setInsights(cached);
      setUnavailable(cached === null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setUnavailable(false);
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/ai/place-insights', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            places: stopsRef.current
              .slice(0, 12)
              .map((s) => ({ name: s.name, category: s.category, region: s.region })),
          }),
        }).then((r) => r.json());
        if (!active) return;
        const ins: Insights | null = res.ok ? res.data.insights : null;
        cache.current.set(key, ins);
        setInsights(ins);
        setUnavailable(ins === null);
      } catch {
        if (active) {
          setInsights(null);
          setUnavailable(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 700);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [key]);

  if (stops.length === 0) return null;

  return (
    <section className="mx-auto max-w-shell px-[22px] pt-4">
      <div className="rounded-[18px] border border-[#EEF4F3] bg-white p-5 shadow-[0_10px_30px_rgba(10,46,54,.05)]">
        <div className="mb-3 flex items-center gap-2.5">
          <span
            className="grid h-9 w-9 place-items-center rounded-xl"
            style={{
              background: 'linear-gradient(140deg,#EAF7F5,#fff)',
              border: '1px solid #E3EEEC',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z"
                fill="#F76C5E"
              />
              <circle cx={18} cy={17} r={1.6} fill="#C98A12" />
              <circle cx={5.5} cy={15.5} r={1.2} fill="#0E8C92" />
            </svg>
          </span>
          <div>
            <h2 className="font-display text-[18px] font-semibold leading-none text-ink">
              {t('AI insights for your day')}
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              {t('Local tips for the places you picked')}
            </p>
          </div>
          {loading && (
            <span className="ml-auto text-xs font-semibold text-teal">{t('thinking…')}</span>
          )}
        </div>

        {loading ? (
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-2.5">
                <div className="h-4 w-4 shrink-0 animate-pulse rounded bg-ink/5" />
                <div className="h-4 w-full animate-pulse rounded bg-ink/5" />
              </div>
            ))}
          </div>
        ) : unavailable || !insights ? (
          <p className="text-sm text-ink-muted">
            {t('AI insights aren’t available right now — the rest of your plan still works.')}
          </p>
        ) : (
          <div className="space-y-3">
            {insights.overall && (
              <p className="rounded-xl bg-teal-tint px-3.5 py-2.5 text-sm leading-relaxed text-teal-dark">
                {insights.overall}
              </p>
            )}
            <ul className="space-y-2.5">
              {insights.items.map((it, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-coral" aria-hidden />
                  <span>
                    <strong className="font-semibold text-ink">{it.name}.</strong>{' '}
                    <span className="text-ink-muted">{it.insight}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
