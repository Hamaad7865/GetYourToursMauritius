'use client';

import { Field, Section } from '@/components/admin/fields';
import { ImagesEditor } from './ImagesEditor';
import { PriceListEditor } from './PriceListEditor';
import type { PaneProps } from './sections';

/**
 * Photos and the price-list PDF — the tour's uploaded assets.
 *
 * The PDF sits here rather than in Pricing & options on purpose: the whole Pricing pane is hidden
 * from the restricted 'seo' content role, and that role could always edit the price list (it is
 * page content, not a price the checkout reads). Moving it would have quietly taken it away.
 */
export function MediaSection({ v, set }: PaneProps) {
  return (
    <Section
      title="Photos & files"
      hint="Upload files or paste image URLs. Drag a photo by its handle to reorder (or use the arrows) — the first photo is the cover and the first five fill the detail-page gallery."
    >
      <div className="flex flex-col gap-5">
        <ImagesEditor images={v.images} slug={v.slug} onChange={(x) => set('images', x)} />
        <Field label="Price list (PDF)">
          <PriceListEditor
            url={v.priceListUrl}
            label={v.priceListLabel}
            slug={v.slug}
            onUrl={(u) => set('priceListUrl', u)}
            onLabel={(l) => set('priceListLabel', l)}
          />
          <p className="mt-1.5 text-[12px] text-ink-muted">
            Upload a price-list PDF to show a “Price list” section on the activity page (embedded on
            desktop, with a download button everywhere). Leave empty to hide it.
          </p>
        </Field>
      </div>
    </Section>
  );
}
