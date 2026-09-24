import { Faq } from '@/components/catalogue/Faq';
import { IconCamera, IconCheck, IconDownload, IconHeart } from '@/components/ui/icons';
import { PHOTOGRAPHY_BENEFITS, PHOTOGRAPHY_INFORMATION } from '@/lib/catalogue/photography-content';
import { getT } from '@/lib/i18n/server';

const ICONS = {
  heart: IconHeart,
  camera: IconCamera,
  check: IconCheck,
  download: IconDownload,
};

export async function PhotographyBenefits() {
  const t = await getT();
  return (
    <section>
      <h2 className="text-[clamp(24px,3vw,36px)] font-extrabold leading-tight tracking-tight">
        {t('Why take photos with us?')}
      </h2>
      <div className="mt-8 grid gap-x-8 gap-y-9 sm:grid-cols-2">
        {PHOTOGRAPHY_BENEFITS.map((benefit) => {
          const Icon = ICONS[benefit.icon];
          return (
            <article key={benefit.icon}>
              <Icon width={28} height={28} aria-hidden className="mb-4 text-teal-bright" />
              <h3 className="text-[17px] font-bold">{t(benefit.title)}</h3>
              <p className="mt-2 text-[15px] leading-relaxed opacity-80">{t(benefit.body)}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export async function PhotographyInformation() {
  const t = await getT();
  return (
    <section>
      <h2 className="mb-6 text-[clamp(24px,3vw,36px)] font-extrabold leading-tight tracking-tight text-ink">
        {t('Useful information')}
      </h2>
      <Faq items={[...PHOTOGRAPHY_INFORMATION]} />
    </section>
  );
}
