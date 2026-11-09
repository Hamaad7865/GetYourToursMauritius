'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { useToast } from '@/components/site/ToastProvider';
import { IconInfo } from '@/components/ui/icons';

/** "9 Nov, 14:05" in Mauritius time — when the notice was switched on. */
function since(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Indian/Mauritius',
  }).format(new Date(iso));
}

/**
 * Admin switch for ZilAi's maintenance notice (`business_settings.zilai_maintenance_since`, NULL = off).
 *
 * On, the assistant panel shows a slim "under maintenance" strip with a "Contact us" link; the chat
 * itself keeps working. Saves under staff RLS through the browser client, like WhatsAppNumberCard, and
 * takes effect the next time a visitor opens ZilAi — no redeploy.
 */
export function ZilAiMaintenanceCard() {
  const { showToast } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [onSince, setOnSince] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getBrowserSupabase()
      .from('business_settings')
      .select('zilai_maintenance_since')
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setLoadError('Could not load the current setting.');
        else setOnSince(data?.zilai_maintenance_since ?? null);
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const on = onSince !== null;

  async function toggle() {
    if (saving) return;
    setSaving(true);
    const next = on ? null : new Date().toISOString();
    const supabase = getBrowserSupabase();
    const { data: userData } = await supabase.auth.getUser();
    // `.select()` so a write RLS quietly filtered out (0 rows) is caught rather than reported as saved.
    const { data, error } = await supabase
      .from('business_settings')
      .update({
        zilai_maintenance_since: next,
        updated_at: new Date().toISOString(),
        updated_by: userData.user?.id ?? null,
      })
      .eq('id', true)
      .select('zilai_maintenance_since');
    setSaving(false);
    if (error || !data?.length) {
      showToast({
        title: 'Could not save',
        description: error?.message ?? 'Your account is not allowed to change this setting.',
        variant: 'error',
      });
      return;
    }
    setOnSince(next);
    showToast({
      title: next ? 'Maintenance notice on' : 'Maintenance notice off',
      description: next
        ? 'Visitors now see it when they open ZilAi.'
        : 'ZilAi no longer shows the notice.',
    });
  }

  return (
    <section className="rounded-2xl border border-[#EAEEF0] bg-white">
      <div className="flex items-center gap-2.5 border-b border-[#EEF1F3] px-[18px] py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FFF6E5] text-[#6B4E0E]">
          <IconInfo width={18} height={18} />
        </span>
        <div>
          <h2 className="text-[15px] font-extrabold text-ink">ZilAi maintenance notice</h2>
          <p className="text-[12.5px] text-ink-muted">
            A small “under maintenance” line at the top of the ZilAi assistant.
          </p>
        </div>
      </div>

      <div className="px-[18px] py-4">
        {loadError ? (
          <p className="rounded-xl border border-coral/30 bg-coral/5 p-3 text-[13px] font-medium text-coral">
            {loadError}
          </p>
        ) : !loaded ? (
          <div className="h-11 animate-pulse rounded-xl bg-[#F1F4F5]" />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[13px] text-ink-muted">
              {on ? (
                <>
                  <span className="font-bold text-ink">On</span> since {since(onSince!)}
                </>
              ) : (
                <>
                  <span className="font-bold text-ink">Off</span> — ZilAi shows no notice
                </>
              )}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label="Show the ZilAi maintenance notice"
              onClick={toggle}
              disabled={saving}
              className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-wait disabled:opacity-60 ${
                on ? 'bg-teal' : 'bg-[#cdd8d7]'
              }`}
            >
              {/* `left` stated: an absolutely positioned child of a <button> otherwise starts where
                  the button centres its content. */}
              <span
                className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                  on ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
