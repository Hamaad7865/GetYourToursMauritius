'use client';

import { useMoney } from './PreferencesProvider';

/**
 * Renders a EUR amount in the visitor's chosen display currency, reactively. Using a tiny client
 * island for every price means currency switches update instantly everywhere — even inside
 * server-rendered cards/pages — without threading currency state through the tree. Bookings are still
 * charged in EUR; USD is a live-rate display conversion.
 */
export function Price({ eur, className }: { eur: number; className?: string }) {
  const money = useMoney();
  return <span className={className}>{money(eur)}</span>;
}
