'use client';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  ensurePhotographyCategory,
  importStarterPackages,
  loadPhotographyAdmin,
  type PhotographyAdminData,
} from '@/lib/admin/photography';
import { IconCamera, IconExternalLink, IconPlus } from '@/components/ui/icons';
import { PhotographyPhotosManager } from '@/components/admin/PhotographyPhotosManager';
import { PhotoBalancesCard } from '@/components/admin/PhotoBalancesCard';
import { CustomerGalleriesCard } from '@/components/admin/CustomerGalleriesCard';
import { PHOTOGRAPHY_SHOOTS, matchesPhotographyShoot } from '@/lib/catalogue/photography-shoots';
import {
  P_BTN,
  P_BTN_GHOST,
  P_LABEL,
  PNotice,
  PPill,
  PSection,
} from '@/components/admin/photo-kit';

function eur(n: number | null): string {
  return n == null ? '—' : `€${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
}

/**
 * /admin/photography — the photography studio: the packages (each a catalogue activity in the
 * "Photography" category), the page photos, balances to collect and customer galleries, plus which
 * private tours offer a shoot as an add-on. Everything about a package is edited from its card —
 * the editor there hosts the package form, the dates and the full tour editor in one place.
 */
export function AdminPhotography() {
  const { profile } = useAuth();
  const isStaff = profile?.role === 'admin' || profile?.role === 'staff';
  const [data, setData] = useState<PhotographyAdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await loadPhotographyAdmin());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load photography.');
    }
  }, []);

  useEffect(() => {
    if (isStaff) void load();
  }, [isStaff, load]);

  const [notice, setNotice] = useState<string | null>(null);

  async function importExamples() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // The examples live under the Photography category, so make sure it exists first.
      if (data && !data.categoryExists) await ensurePhotographyCategory();
      const created = await importStarterPackages();
      setNotice(
        created > 0
          ? `Added ${created} example package${created === 1 ? '' : 's'} as drafts. Open each one, check the price and add-ons, then set it to Published.`
          : 'The example packages are already here.',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the example packages.');
    } finally {
      setBusy(false);
    }
  }

  async function createCategory() {
    setBusy(true);
    try {
      await ensurePhotographyCategory();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the category.');
    } finally {
      setBusy(false);
    }
  }

  const titleBySlug = new Map((data?.packages ?? []).map((p) => [p.slug, p.title]));
  const published = (data?.packages ?? []).filter((p) => p.status === 'published').length;

  return (
    <div className="pb-10">
      {/* Studio header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-tight text-ink">Photography studio</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {data
              ? `${data.packages.length} package${data.packages.length === 1 ? '' : 's'} · ${published} published`
              : 'Packages, page photos, balances and galleries.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="#photography-gallery" className={P_BTN_GHOST}>
            <IconCamera width={15} height={15} /> Manage gallery
          </a>
          <a href="/photography" target="_blank" rel="noreferrer" className={P_BTN_GHOST}>
            <IconExternalLink width={15} height={15} /> View page
          </a>
          <Link href="/admin/photography/new" className={P_BTN}>
            <IconPlus width={16} height={16} /> New package
          </Link>
        </div>
      </div>

      <div className="space-y-4">
        {error && <PNotice tone="error">{error}</PNotice>}
        {notice && <PNotice tone="ok">{notice}</PNotice>}

        {data && !data.categoryExists && (
          <PNotice tone="warn">
            There’s no <b>Photography</b> category yet — packages are filed under it, and that’s
            what puts them on /photography.{' '}
            <button
              type="button"
              disabled={busy}
              onClick={() => void createCategory()}
              className="ml-1 font-extrabold underline underline-offset-2 hover:text-teal-dark"
            >
              {busy ? 'Creating…' : 'Create it now'}
            </button>
          </PNotice>
        )}

        <PSection
          title="Packages"
          description="What guests see on /photography. Everything about a package — photos, dates, prices, French, SEO — is edited from its card."
          action={
            data && data.packages.length > 0 ? (
              <Link href="/admin/photography/new" className={P_BTN}>
                <IconPlus width={15} height={15} /> New package
              </Link>
            ) : undefined
          }
        >
          {data === null ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[240px] animate-pulse rounded-card border border-ink/10 bg-teal-tint/40"
                />
              ))}
            </div>
          ) : data.packages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink/15 bg-teal-tint/40 px-6 py-10 text-center">
              <IconCamera width={28} height={28} className="mx-auto text-teal-dark" />
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
                No packages yet. Import the wedding &amp; couples presets as drafts, or start from
                scratch — review prices, photos and dates before publishing.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void importExamples()}
                  className={P_BTN}
                >
                  {busy ? 'Adding…' : 'Add wedding & couples presets'}
                </button>
                <Link href="/admin/photography/new" className={P_BTN_GHOST}>
                  Start from scratch
                </Link>
              </div>
            </div>
          ) : (
            /* The same card anatomy as the public /photography grid — what the owner manages is
               what the guest sees. */
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.packages.map((p) => (
                <article
                  key={p.id}
                  className="group flex flex-col overflow-hidden rounded-card border border-ink/10 bg-white transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_rgba(10,46,54,0.35)]"
                >
                  <div className="relative aspect-[16/10] overflow-hidden bg-teal-tint">
                    {p.coverUrl ? (
                      <img
                        src={p.coverUrl}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-ink-muted">
                        <IconCamera width={26} height={26} />
                      </div>
                    )}
                    <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold text-ink shadow-sm">
                      {p.group === 'weddings' ? 'Weddings' : 'Photoshoots'}
                    </span>
                    {p.bestSeller && (
                      <span className="absolute bottom-3 left-3">
                        <PPill tone="coral">Best seller</PPill>
                      </span>
                    )}
                    <span className="absolute right-3 top-3">
                      <PPill tone={p.status === 'published' ? 'ok' : 'warn'}>
                        {p.status === 'published' ? 'Published' : 'Draft'}
                      </PPill>
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col p-4">
                    <h3 className="line-clamp-2 text-sm font-extrabold leading-snug tracking-tight text-ink">
                      {p.title}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                      {[
                        p.durationMinutes ? `${Math.round(p.durationMinutes / 6) / 10} h` : null,
                        p.included != null
                          ? `${p.included} guests incl.${
                              p.extraEur ? ` · +${eur(p.extraEur)} each` : ''
                            }${p.maxGuests ? ` · max ${p.maxGuests}` : ''}`
                          : null,
                        p.shootsPerDay != null
                          ? `${p.shootsPerDay} shoot${p.shootsPerDay === 1 ? '' : 's'}/day`
                          : 'No dates set',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {p.addOns.length > 0 && (
                      <ul className="mt-2.5 flex flex-wrap gap-1.5">
                        {p.addOns.map((a) => (
                          <li
                            key={a.name}
                            className="rounded-full bg-teal-tint px-2.5 py-0.5 text-[10.5px] font-semibold text-teal-dark"
                          >
                            {a.name} · {eur(a.priceEur)}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                      {p.baseEur == null ? (
                        <span className="text-xs font-bold text-coral">Not priced</span>
                      ) : (
                        <p className="text-[11px] text-ink-muted">
                          From{' '}
                          <b className="text-base font-extrabold tabular-nums tracking-tight text-ink">
                            {eur(p.baseEur)}
                          </b>
                        </p>
                      )}
                      <a
                        href={`/activities/${p.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`View ${p.title} on the site`}
                        className="rounded-full p-1.5 text-ink-muted transition hover:bg-teal-tint hover:text-teal-dark"
                      >
                        <IconExternalLink width={15} height={15} />
                      </a>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-ink/10 pt-3">
                      <Link
                        href={`/admin/photography/${p.id}/edit`}
                        className="flex items-center justify-center rounded-full bg-teal px-3 py-2 text-xs font-bold text-white transition hover:bg-teal-dark"
                      >
                        Edit package
                      </Link>
                      <Link
                        href={`/admin/photography/${p.id}/edit?tab=dates`}
                        className="flex items-center justify-center rounded-full border-[1.5px] border-ink/10 px-3 py-2 text-xs font-bold text-ink transition hover:border-teal hover:text-teal-dark"
                      >
                        Dates
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </PSection>

        {isStaff && data && PHOTOGRAPHY_SHOOTS.length > 0 && (
          <PSection
            title="Shoot types"
            description="Unconfigured shoots show “Price on request” on the website. Set your own price, duration, photos and dates, then publish."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {PHOTOGRAPHY_SHOOTS.map((shoot) => {
                const existing = data.packages.find((p) => matchesPhotographyShoot(shoot, p));
                return (
                  <Link
                    key={shoot.key}
                    href={
                      existing
                        ? `/admin/photography/${existing.id}/edit`
                        : `/admin/photography/new?template=${shoot.key}`
                    }
                    className="flex items-center justify-between gap-3 rounded-xl border border-ink/10 bg-white p-4 text-sm transition hover:border-teal hover:shadow-[0_10px_24px_-16px_rgba(10,46,54,0.3)]"
                  >
                    <span className="font-semibold">{shoot.title}</span>
                    <span className="font-bold text-teal-dark">
                      {existing ? 'Edit package' : 'Set up package'} →
                    </span>
                  </Link>
                );
              })}
            </div>
          </PSection>
        )}

        {isStaff && (
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <PhotoBalancesCard />
            <CustomerGalleriesCard />
          </div>
        )}

        {isStaff && <PhotographyPhotosManager />}

        <PSection
          title="Offered on private tours"
          description={
            <>
              To offer a shoot on a tour, open the tour → <b>Logistics</b> →{' '}
              <b>Photography add-ons</b> and tick the packages. The tour’s booking card then offers
              them for the same day.
            </>
          }
        >
          {data === null ? null : data.pairedTours.length === 0 ? (
            <p className="text-sm text-ink-muted">No tours offer a photography add-on yet.</p>
          ) : (
            <ul className="divide-y divide-ink/5">
              {data.pairedTours.map((tour) => (
                <li key={tour.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-ink">{tour.title}</p>
                    <p className="mt-0.5 text-[12.5px] text-ink-muted">
                      {tour.addOns
                        .map((s) => titleBySlug.get(s) ?? `${s} (not a package)`)
                        .join(', ')}
                    </p>
                  </div>
                  <Link
                    href={`/admin/activities/${tour.id}/edit?s=logistics`}
                    className={P_BTN_GHOST}
                  >
                    Edit pairing
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </PSection>

        {/* How the money flows — a real sequence, so numbered steps earn their place. */}
        <section className="rounded-card border border-teal/15 bg-teal-tint/60 p-6">
          <p className={P_LABEL}>How a booking works</p>
          <div className="mt-4 grid gap-5 md:grid-cols-3">
            {[
              [
                'The guest books',
                'They pick a date, their party and add-ons, and pay a 50% deposit by card (non-refundable). The booking lands in Bookings and Calendar like any tour.',
              ],
              [
                'You shoot & deliver',
                'Upload the finished photos under Customer galleries and send the gallery link. A sneak peek within 48 hours keeps guests happy.',
              ],
              [
                'You collect the rest',
                'Press Request balance under Balances to collect — the guest gets an email with a card link. The full invoice follows the balance payment.',
              ],
            ].map(([title, body], i) => (
              <div key={title} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-teal text-xs font-extrabold text-white">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-[13.5px] font-extrabold tracking-tight text-ink">{title}</h3>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
