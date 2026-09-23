'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  ensurePhotographyCategory,
  loadPhotographyAdmin,
  type PhotographyAdminData,
} from '@/lib/admin/photography';
import { IconCamera, IconExternalLink, IconPlus } from '@/components/ui/icons';
import { AdminError, AdminHeading, BTN_GHOST, BTN_PRIMARY, Card } from '@/components/admin/ui';
import { PhotographyPhotosManager } from '@/components/admin/PhotographyPhotosManager';
import { PhotoBalancesCard } from '@/components/admin/PhotoBalancesCard';

function eur(n: number | null): string {
  return n == null ? '—' : `€${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
}

/**
 * /admin/photography — the photography business in one screen: the packages (each a catalogue
 * activity in the "Photography" category), a template to add one, and which private tours offer a
 * shoot as an add-on. Editing a package's copy, photos, prices, add-ons or dates opens the normal
 * tour editor, so there is still exactly one save path for anything that is sold.
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

  return (
    <div>
      <AdminHeading
        title="Photography"
        subtitle="Packages, page photos and tour pairings — packages are booked online like any tour."
        action={
          <div className="flex flex-wrap gap-2">
            <a href="/photography/packages" target="_blank" rel="noreferrer" className={BTN_GHOST}>
              <IconExternalLink width={15} height={15} /> View price list
            </a>
            <Link href="/admin/photography/new" className={BTN_PRIMARY}>
              <IconPlus width={16} height={16} /> New package
            </Link>
          </div>
        }
      />

      {error && <AdminError>{error}</AdminError>}

      {data && !data.categoryExists && (
        <Card className="mb-5">
          <p className="text-sm text-ink">
            There’s no <b>Photography</b> category yet. Packages are filed under it — that’s what
            puts them on /photography, in the navbar dropdown and on the price list.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void createCategory()}
            className={`${BTN_PRIMARY} mt-3`}
          >
            {busy ? 'Creating…' : 'Create the Photography category'}
          </button>
        </Card>
      )}

      <Card title="Packages" className="mb-5">
        {data === null ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : data.packages.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-2">
            <p className="text-sm text-ink-muted">
              No packages yet. Until you publish one, /photography shows example packages with a
              WhatsApp “Enquire” button instead of online booking.
            </p>
            <Link href="/admin/photography/new" className={BTN_PRIMARY}>
              <IconCamera width={16} height={16} /> Create your first package
            </Link>
          </div>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="text-[11.5px] uppercase tracking-wide text-ink-muted">
                <tr className="border-b border-[#F2F4F6]">
                  <th className="px-5 py-2 font-bold">Package</th>
                  <th className="px-3 py-2 font-bold">Price</th>
                  <th className="px-3 py-2 font-bold">Guests</th>
                  <th className="px-3 py-2 font-bold">Add-ons</th>
                  <th className="px-3 py-2 font-bold">Per day</th>
                  <th className="px-5 py-2 text-right font-bold">Manage</th>
                </tr>
              </thead>
              <tbody>
                {data.packages.map((p) => (
                  <tr key={p.id} className="border-b border-[#F2F4F6] last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-ink">{p.title}</span>
                        <span className="rounded-full bg-teal/10 px-2 py-0.5 text-[10.5px] font-bold text-teal-dark">
                          {p.group === 'weddings' ? 'Wedding' : 'Shoot'}
                        </span>
                        {p.status !== 'published' && (
                          <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[10.5px] font-bold text-ink-muted">
                            Draft
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-ink-muted">
                        /activities/{p.slug}
                        {p.durationMinutes ? ` · ${Math.round(p.durationMinutes / 6) / 10} h` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-3 font-semibold text-ink">
                      {p.baseEur == null ? (
                        <span className="text-coral">Not priced</span>
                      ) : (
                        eur(p.baseEur)
                      )}
                    </td>
                    <td className="px-3 py-3 text-ink/80">
                      {p.included != null
                        ? `${p.included} incl.${p.extraEur ? ` · +${eur(p.extraEur)} each` : ''}${
                            p.maxGuests ? ` · max ${p.maxGuests}` : ''
                          }`
                        : '—'}
                    </td>
                    <td className="px-3 py-3 text-ink/80">
                      {p.addOns.length
                        ? p.addOns.map((a) => `${a.name} ${eur(a.priceEur)}`).join(', ')
                        : '—'}
                    </td>
                    <td className="px-3 py-3">
                      {p.shootsPerDay ? (
                        <span className="text-ink/80">{p.shootsPerDay}</span>
                      ) : (
                        <span className="text-coral">Not set</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      <Link
                        href={`/admin/activities/${p.id}/edit`}
                        className="rounded-lg px-2.5 py-1.5 font-bold text-teal hover:bg-cream"
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/admin/activities/${p.id}/edit?s=pricing`}
                        className="rounded-lg px-2.5 py-1.5 font-bold text-teal hover:bg-cream"
                      >
                        Prices & add-ons
                      </Link>
                      <Link
                        href={`/admin/activities/${p.id}/availability`}
                        className="rounded-lg px-2.5 py-1.5 font-bold text-teal hover:bg-cream"
                      >
                        Dates
                      </Link>
                      <a
                        href={`/activities/${p.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg px-2.5 py-1.5 font-bold text-ink-muted hover:bg-cream"
                      >
                        View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isStaff && <PhotoBalancesCard />}

      {isStaff && <PhotographyPhotosManager />}

      <Card title="Offered on private tours" className="mb-5">
        <p className="mb-3 text-[13px] text-ink-muted">
          To offer a shoot on a tour, open the tour → <b>Logistics</b> → <b>Photography add-ons</b>{' '}
          and tick the packages. The tour’s booking card then offers them for the same day; each
          package page also suggests your private tours.
        </p>
        {data === null ? null : data.pairedTours.length === 0 ? (
          <p className="text-sm text-ink-muted">No tours offer a photography add-on yet.</p>
        ) : (
          <ul className="divide-y divide-[#F2F4F6]">
            {data.pairedTours.map((tour) => (
              <li key={tour.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-ink">{tour.title}</p>
                  <p className="text-[12.5px] text-ink-muted">
                    {tour.addOns
                      .map((s) => titleBySlug.get(s) ?? `${s} (not a package)`)
                      .join(', ')}
                  </p>
                </div>
                <Link
                  href={`/admin/activities/${tour.id}/edit?s=logistics`}
                  className="rounded-lg px-3 py-1.5 text-sm font-bold text-teal hover:bg-cream"
                >
                  Edit
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="How a booking works">
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-ink/80">
          <li>
            The guest picks a <b>date</b> (from the package’s Dates — how many shoots you can do per
            day), their <b>party</b> (the price covers the first guests; extra guests are charged
            per head, up to the maximum) and any <b>add-ons</b> (each charged once per shoot).
          </li>
          <li>
            Payment is in two halves: the guest pays a <b>50% deposit</b> by card to book (it is
            non-refundable), and the rest when the photos are delivered — use <b>Request balance</b>{' '}
            above. They get a deposit receipt first and the full invoice once the balance is paid.
          </li>
          <li>
            Confirmation emails, the calendar and invoices work exactly like a tour — the booking
            appears in Bookings and Calendar.
          </li>
          <li>
            Package titles or summaries mentioning “wedding” or “film” are listed under Weddings;
            everything else under Holiday &amp; family shoots.
          </li>
        </ul>
      </Card>
    </div>
  );
}
