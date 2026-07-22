'use client';

import { useEffect, useState } from 'react';
import type { TourSummary } from '@/lib/validation/tours';

export interface ActivitySuggestion {
  slug: string;
  title: string;
  category: string;
  imageUrl: string | null;
}

/**
 * Live "matching activities" suggestions for the header search box, debounced 350ms (mirrors the
 * AI planner's PlacesDrawer typeahead). Queries the existing public GET /api/v1/activities search
 * endpoint — no new backend route. Below a 2-character query, returns no suggestions (too noisy;
 * the caller's own recent-searches/category panel covers that case).
 */
export function useActivitySuggestions(query: string): {
  suggestions: ActivitySuggestion[];
  loading: boolean;
} {
  const [suggestions, setSuggestions] = useState<ActivitySuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/v1/activities?q=${encodeURIComponent(trimmed)}&pageSize=6`)
        .then((r) => r.json())
        .then((res) => {
          if (!active) return;
          const items = res.ok ? (res.data as TourSummary[]) : [];
          setSuggestions(
            items.map((a) => ({
              slug: a.slug,
              title: a.title,
              category: a.category,
              imageUrl: a.heroImage?.url ?? null,
            })),
          );
        })
        .catch(() => {
          if (active) setSuggestions([]);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  return { suggestions, loading };
}
