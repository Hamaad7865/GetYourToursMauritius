'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchAccountGalleries } from '@/lib/booking/account-galleries-client';
import {
  galleriesKey,
  galleriesState,
  settleGalleries,
  type AccountGalleriesState,
  type SettledGalleries,
} from '@/lib/booking/account-galleries-state';

/**
 * The signed-in customer's galleries, for the account nav and the Galleries page. The answer is kept
 * against the customer (and the retry count), not the access token, so a token refresh refetches in
 * the background while the cards already on screen stay put; see `account-galleries-state.ts` for the
 * rules. `null` (signed out) reads as `loading`.
 */
export function useAccountGalleries(
  session: Session | null,
): AccountGalleriesState & { retry: () => void } {
  const accessToken = session?.access_token ?? null;
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<SettledGalleries | null>(null);
  const key = galleriesKey(session?.user.id ?? null, attempt);

  // Depends on the token so a refresh refetches; the key (customer + attempt) is what the result is
  // stored under, so the old answer keeps matching meanwhile.
  useEffect(() => {
    if (!accessToken || !key) return;
    let cancelled = false;
    void fetchAccountGalleries(accessToken).then((cards) => {
      if (!cancelled) setSettled((prev) => settleGalleries(prev, key, cards));
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...galleriesState(settled, key), retry };
}
