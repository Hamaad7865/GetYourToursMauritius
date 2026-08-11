'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { SITE, whatsappUrl } from '@/lib/seo/site';
import { useToast } from '@/components/site/ToastProvider';
import { IconChat } from '@/components/ui/icons';

/** Digits only — what wa.me actually dials, ignoring spaces/`+`/dashes. */
function digitsOf(value: string): string {
  return value.replace(/[^\d]/g, '');
}

/**
 * Admin control for the customer-facing "Chat on WhatsApp" number (the `business_settings` singleton).
 *
 * Loads the current value, validates the digit count (8..15 — the wa.me/E.164 range, matched to the
 * DB CHECK), previews the resulting wa.me link, and saves under staff RLS through the browser client
 * (like `setLeadStatus` — no API route). Leaving it blank clears the override, so every "Chat on
 * WhatsApp" link falls back to the built-in number (`SITE.phone`).
 */
export function WhatsAppNumberCard() {
  const { showToast } = useToast();
  const [loaded, setLoaded] = useState(false);
  // The last-persisted value; '' means "no override set — using the default".
  const [saved, setSaved] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getBrowserSupabase()
      .from('business_settings')
      .select('whatsapp_number')
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setLoadError('Could not load the current number.');
        } else {
          const current = data?.whatsapp_number ?? '';
          setSaved(current);
          setValue(current);
        }
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const trimmed = value.trim();
  const digits = digitsOf(trimmed);
  const isBlank = trimmed.length === 0;
  const valid = isBlank || (digits.length >= 8 && digits.length <= 15);
  const dirty = trimmed !== saved.trim();

  async function save() {
    if (!valid || saving || !dirty) return;
    setSaving(true);
    const next = isBlank ? null : trimmed;
    const supabase = getBrowserSupabase();
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('business_settings')
      .update({
        whatsapp_number: next,
        updated_at: new Date().toISOString(),
        updated_by: userData.user?.id ?? null,
      })
      .eq('id', true);
    setSaving(false);
    if (error) {
      showToast({ title: 'Could not save', description: error.message, variant: 'error' });
      return;
    }
    setSaved(next ?? '');
    showToast({
      title: 'WhatsApp number saved',
      description: next
        ? `“Chat on WhatsApp” links now use ${next}.`
        : `Cleared — links use the default ${SITE.phone}.`,
    });
  }

  return (
    <section className="rounded-2xl border border-[#EAEEF0] bg-white">
      <div className="flex items-center gap-2.5 border-b border-[#EEF1F3] px-[18px] py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal/10 text-teal">
          <IconChat width={18} height={18} />
        </span>
        <div>
          <h2 className="text-[15px] font-extrabold text-ink">WhatsApp number</h2>
          <p className="text-[12.5px] text-ink-muted">
            The number behind every “Chat on WhatsApp” link on the site.
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
          <>
            <label htmlFor="wa-number" className="sr-only">
              WhatsApp number
            </label>
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                id="wa-number"
                type="tel"
                inputMode="tel"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && valid && dirty) save();
                }}
                placeholder={SITE.phone}
                aria-invalid={!valid}
                className={`min-w-0 flex-1 rounded-xl border bg-white px-3.5 py-2.5 text-sm font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-muted focus:ring-2 ${
                  valid
                    ? 'border-[#E2E7EA] focus:border-teal focus:ring-teal/20'
                    : 'border-coral/50 focus:border-coral focus:ring-coral/20'
                }`}
              />
              <button
                type="button"
                onClick={save}
                disabled={!valid || !dirty || saving}
                className="shrink-0 rounded-xl bg-teal px-4 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
              {!valid ? (
                <span className="font-medium text-coral">
                  Enter 8–15 digits (with or without the country code).
                </span>
              ) : isBlank ? (
                <span className="text-ink-muted">
                  Blank — links use the default{' '}
                  <span className="font-semibold text-ink">{SITE.phone}</span>.
                </span>
              ) : (
                <>
                  <span className="text-ink-muted">
                    Opens <span className="font-semibold text-ink">wa.me/{digits}</span>
                  </span>
                  <a
                    href={whatsappUrl('Test message from Belle Mare Tours', trimmed)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-teal hover:text-teal-dark hover:underline"
                  >
                    Test link ↗
                  </a>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
