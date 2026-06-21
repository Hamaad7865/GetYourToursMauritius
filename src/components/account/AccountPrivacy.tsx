'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { useDialog } from '@/lib/a11y/useDialog';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { useToast } from '@/components/site/ToastProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { buildAccountExport, type ExportBookingInput } from '@/lib/account/export';
import { deleteMyAccount } from '../../../app/(site)/account/actions';
import { SignedOutPrompt, AccountSpinner } from './AccountChrome';

/** Shape of the RLS-scoped bookings read (the owner's rows only). */
interface PrivacyBookingRow {
  ref: string;
  status: string;
  total_minor: number;
  currency: string;
  created_at: string;
  pickup_location: string | null;
  dropoff_location: string | null;
  booking_items: Array<{
    price_label: string;
    quantity: number;
    session_occurrences: {
      starts_at: string | null;
      activity_options: { activities: { title: string | null } | null } | null;
    } | null;
  }>;
}

const CONFIRM_WORD = 'DELETE';

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/** True if any item's occurrence starts in the future — an upcoming trip we should warn about. */
function hasUpcomingConfirmed(rows: PrivacyBookingRow[]): boolean {
  const now = Date.now();
  return rows.some(
    (b) =>
      (b.status === 'confirmed' || b.status === 'completed') &&
      b.booking_items.some((i) => {
        const s = i.session_occurrences?.starts_at;
        return !!s && new Date(s).getTime() > now;
      }),
  );
}

export function AccountPrivacy() {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const { user, session, loading, signOut } = useAuth();

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [upcomingWarning, setUpcomingWarning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  // APG modal behaviour for the destructive confirm: scroll-lock, Escape, focus the DELETE
  // input on open, trap Tab, and restore focus to the trigger on close.
  const dialogRef = useDialog(confirmOpen, () => setConfirmOpen(false), () => confirmInputRef.current);

  if (loading) return <AccountSpinner />;
  if (!user) return <SignedOutPrompt message={t('Sign in to manage your data and privacy.')} />;

  /** Fetch the caller's own profile + bookings under RLS and download them as JSON. */
  async function downloadData() {
    if (!user) return;
    setExporting(true);
    setExportError(null);
    try {
      const sb = getBrowserSupabase();
      const [{ data: prof, error: profErr }, { data: rows, error: bookErr }] = await Promise.all([
        sb.from('profiles').select('full_name, phone').eq('id', user.id).maybeSingle(),
        sb
          .from('bookings')
          .select(
            'ref, status, total_minor, currency, created_at, pickup_location, dropoff_location, booking_items(price_label, quantity, session_occurrences(starts_at, activity_options(activities(title))))',
          )
          .order('created_at', { ascending: false })
          .returns<PrivacyBookingRow[]>(),
      ]);
      if (profErr) throw profErr;
      if (bookErr) throw bookErr;

      const exportBookings: ExportBookingInput[] = (rows ?? []).map((b) => ({
        ref: b.ref,
        status: b.status,
        total_minor: b.total_minor,
        currency: b.currency,
        created_at: b.created_at,
        pickup_location: b.pickup_location,
        dropoff_location: b.dropoff_location,
        items: b.booking_items.map((i) => ({
          price_label: i.price_label,
          quantity: i.quantity,
          starts_at: i.session_occurrences?.starts_at ?? null,
          title: i.session_occurrences?.activity_options?.activities?.title ?? null,
        })),
      }));

      const payload = buildAccountExport(
        prof ?? null,
        user.email ?? null,
        exportBookings,
        new Date().toISOString(),
      );

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `account-data-${todayStamp()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : t('Could not prepare your data. Please try again.'));
    } finally {
      setExporting(false);
    }
  }

  /** Open the confirm dialog, first checking the loaded bookings for an upcoming confirmed trip. */
  async function openConfirm() {
    setDeleteError(null);
    setConfirmText('');
    setUpcomingWarning(false);
    // Best-effort upcoming-trip check (RLS-scoped). A read hiccup must not block deletion.
    try {
      const { data } = await getBrowserSupabase()
        .from('bookings')
        .select('ref, status, total_minor, currency, created_at, pickup_location, dropoff_location, booking_items(price_label, quantity, session_occurrences(starts_at, activity_options(activities(title))))')
        .returns<PrivacyBookingRow[]>();
      setUpcomingWarning(hasUpcomingConfirmed(data ?? []));
    } catch {
      setUpcomingWarning(false);
    }
    setConfirmOpen(true);
  }

  async function confirmDelete() {
    if (!session?.access_token) {
      setDeleteError(t('Your session has expired. Please sign in again.'));
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await deleteMyAccount(session.access_token);
      if (!res.ok) {
        setDeleteError(
          res.error === 'unauthenticated'
            ? t('Your session has expired. Please sign in again.')
            : t('We couldn’t delete your account. Please contact us and we’ll help.'),
        );
        setDeleting(false);
        return;
      }
      // Success: sign out locally, confirm, then land home. The toast outlives the navigation.
      await signOut();
      await getBrowserSupabase().auth.signOut();
      showToast({
        title: t('Account deleted'),
        description: t('Your account and personal data were deleted.'),
        variant: 'info',
      });
      router.replace('/');
    } catch {
      setDeleteError(t('We couldn’t delete your account. Please contact us and we’ll help.'));
      setDeleting(false);
    }
  }

  const confirmReady = confirmText.trim().toUpperCase() === CONFIRM_WORD;

  return (
    <div className="max-w-xl">
      <h1 className="font-display text-2xl font-semibold text-ink">{t('Data & privacy')}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t('Download a copy of your data, or permanently delete your account.')}
      </p>

      {/* Download my data */}
      <section className="mt-8 rounded-2xl border border-ink/10 bg-white p-6">
        <h2 className="font-display text-lg font-semibold text-ink">{t('Download my data')}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {t('Export your profile and booking history as a JSON file.')}
        </p>
        {exportError && (
          <p role="alert" className="mt-3 text-[13px] font-medium text-coral">
            {exportError}
          </p>
        )}
        <button
          type="button"
          onClick={downloadData}
          disabled={exporting}
          className="mt-4 rounded-xl bg-teal px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-dark disabled:opacity-60"
        >
          {exporting ? t('Preparing…') : t('Download my data')}
        </button>
      </section>

      {/* Delete my account */}
      <section className="mt-6 rounded-2xl border border-coral/30 bg-white p-6">
        <h2 className="font-display text-lg font-semibold text-ink">{t('Delete my account')}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {t(
            'This permanently removes your profile and personal details. Paid bookings are kept for legal and accounting reasons but are anonymized.',
          )}
        </p>

        <button
          type="button"
          onClick={openConfirm}
          className="mt-4 rounded-xl border border-coral px-5 py-2.5 text-sm font-bold text-coral transition hover:bg-coral/10"
        >
          {t('Delete my account')}
        </button>

        {confirmOpen && (
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="del-acct-title"
            className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
            onMouseDown={() => !deleting && setConfirmOpen(false)}
          >
            <div
              className="relative w-full max-w-[460px] rounded-2xl bg-white p-6 shadow-2xl sm:p-8"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h2 id="del-acct-title" className="font-display text-lg font-semibold text-ink">
                {t('Delete my account')}
              </h2>

              {upcomingWarning && (
                <p
                  role="status"
                  className="mt-3 rounded-lg bg-gold-light/20 px-3 py-2 text-[13px] font-medium text-ink"
                >
                  {t(
                    'Your upcoming bookings will be anonymized — contact us to reschedule before deleting.',
                  )}
                </p>
              )}

              <label className="mt-4 flex flex-col gap-1.5">
                <span className="text-[13px] font-bold text-ink">
                  {t('Type DELETE to confirm')}
                </span>
                <input
                  ref={confirmInputRef}
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoComplete="off"
                  placeholder={CONFIRM_WORD}
                  className="rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-coral"
                />
              </label>

              {deleteError && (
                <p role="alert" className="mt-3 text-[13px] font-medium text-coral">
                  {deleteError}
                </p>
              )}

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={!confirmReady || deleting}
                  className="rounded-xl bg-coral px-5 py-2.5 text-sm font-bold text-white transition hover:bg-coral/90 disabled:opacity-50"
                >
                  {deleting ? t('Deleting…') : t('Permanently delete')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  disabled={deleting}
                  className="rounded-xl border border-ink/15 px-5 py-2.5 text-sm font-bold text-ink transition hover:bg-cream disabled:opacity-60"
                >
                  {t('Cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
