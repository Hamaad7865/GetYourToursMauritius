'use client';

import { useEffect, useState } from 'react';
import Link from '@/components/site/LocaleLink';
import { useT } from '@/components/site/PreferencesProvider';
import { getBrowserSupabase } from '@/lib/supabase/browser';

/**
 * A slim "ZilAi is under maintenance" strip under the panel header, switched on and off by the owner
 * from the admin Dashboard (`business_settings.zilai_maintenance_since`, NULL = off).
 *
 * Read each time the panel opens, straight from the public-read singleton — so a flip in /admin shows
 * on the next open, with no redeploy and no cost to pages where nobody opens ZilAi. Any read failure
 * (no column yet, a Supabase blip) means no notice: it is information, never a gate — the chat below
 * stays usable either way.
 */
export function MaintenanceNotice({ open }: { open: boolean }) {
  const t = useT();
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      try {
        const { data, error } = await getBrowserSupabase()
          .from('business_settings')
          .select('zilai_maintenance_since')
          .limit(1)
          .maybeSingle();
        if (active) setOn(!error && Boolean(data?.zilai_maintenance_since));
      } catch {
        if (active) setOn(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  if (!on) return null;
  return (
    <p
      role="status"
      className="m-0 shrink-0 border-b border-ink/[0.08] bg-[#FFF6E5] px-4 py-2 text-[12.5px] leading-[1.45] text-[#6B4E0E]"
    >
      {t('ZilAi is under maintenance right now.')}{' '}
      <Link href="/contact" className="font-semibold underline underline-offset-2">
        {t('Contact us')}
      </Link>
    </p>
  );
}
