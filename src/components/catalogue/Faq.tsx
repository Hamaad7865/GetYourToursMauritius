import type { Faq as FaqItem } from '@/lib/catalogue/detail';
import { getT } from '@/lib/i18n/server';
import { IconChevron } from '@/components/ui/icons';

/**
 * FAQ accordion built on native <details>/<summary> so it works with zero client
 * JS (edge-friendly) and stays keyboard-accessible. The first item is open by default.
 */
export async function Faq({ items }: { items: FaqItem[] }) {
  if (items.length === 0) return null;
  const t = await getT();
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item, i) => (
        <details
          key={item.q}
          open={i === 0}
          className="group overflow-hidden rounded-[14px] border border-ink/10 bg-white"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-[17px] py-[15px] text-[14.5px] font-bold text-ink [&::-webkit-details-marker]:hidden">
            {t(item.q)}
            <IconChevron
              width={18}
              height={18}
              className="shrink-0 text-ink-muted transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="px-[17px] pb-4 text-sm leading-relaxed text-ink/75">{t(item.a)}</div>
        </details>
      ))}
    </div>
  );
}
