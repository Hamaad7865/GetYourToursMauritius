import { IconArrowRight, IconPin } from '@/components/ui/icons';

/**
 * Keyless fallback shown when the Google Maps JS API isn't available (no key, API not enabled
 * for the project, or load error). It deep-links to Google Maps — which needs no key — so the
 * traveller always has a working way to see the location instead of a broken map.
 */
export function MapLinkCard({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-ink/[0.03] p-4 transition hover:border-teal/40 hover:bg-teal/5"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal/10 text-teal">
        <IconPin width={20} height={20} />
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-bold text-ink">View on Google Maps</span>
        <span className="block truncate text-[13px] text-ink-muted">{label}</span>
      </span>
      <IconArrowRight width={16} height={16} className="ml-auto shrink-0 text-teal" />
    </a>
  );
}
