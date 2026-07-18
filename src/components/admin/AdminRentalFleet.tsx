'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  loadRentalFleet,
  createRentalVehicle,
  updateRentalVehicle,
  deleteRentalVehicle,
  type RentalVehicleInput,
} from '@/lib/admin/rental';
import { uploadActivityImage } from '@/lib/admin/activity-write';
import {
  AdminHeading,
  AdminError,
  Card,
  Field,
  INPUT_CLS,
  BTN_PRIMARY,
  BTN_GHOST,
} from '@/components/admin/ui';

const CATEGORY_HINT = 'scooter · economy · family · suv · van';

const BLANK: RentalVehicleInput = {
  slug: '',
  name: '',
  category: 'economy',
  seats: 5,
  transmission: 'automatic',
  airCon: true,
  imageUrl: null,
  dailyRateEur: 36,
  depositEur: 0,
  sort: 0,
  active: true,
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Editable fields shared by the edit rows and the add form. */
function VehicleFields({
  v,
  patch,
  lockSlug,
}: {
  v: RentalVehicleInput;
  patch: (p: Partial<RentalVehicleInput>) => void;
  lockSlug: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Field label="Name">
        <input
          className={INPUT_CLS}
          value={v.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Nissan March"
        />
      </Field>
      <Field label="Slug" hint={lockSlug ? 'Fixed' : 'Unique id'}>
        <input
          className={INPUT_CLS}
          value={v.slug}
          disabled={lockSlug}
          onChange={(e) => patch({ slug: slugify(e.target.value) })}
          placeholder="nissan-march"
        />
      </Field>
      <Field label="Category" hint={CATEGORY_HINT}>
        <input
          className={INPUT_CLS}
          value={v.category}
          onChange={(e) => patch({ category: e.target.value })}
          placeholder="economy"
        />
      </Field>
      <Field label="Seats">
        <input
          type="number"
          min={1}
          className={INPUT_CLS}
          value={v.seats}
          onChange={(e) => patch({ seats: e.target.value ? Number(e.target.value) : 1 })}
        />
      </Field>
      <Field label="Transmission">
        <input
          className={INPUT_CLS}
          value={v.transmission ?? ''}
          onChange={(e) => patch({ transmission: e.target.value || null })}
          placeholder="automatic"
        />
      </Field>
      <Field label="Daily rate (€)">
        <input
          type="number"
          min={0}
          step="0.01"
          className={INPUT_CLS}
          value={v.dailyRateEur}
          onChange={(e) => patch({ dailyRateEur: e.target.value ? Number(e.target.value) : 0 })}
        />
      </Field>
      <Field label="Deposit (€)" hint="At handover">
        <input
          type="number"
          min={0}
          step="0.01"
          className={INPUT_CLS}
          value={v.depositEur}
          onChange={(e) => patch({ depositEur: e.target.value ? Number(e.target.value) : 0 })}
        />
      </Field>
      <Field label="Sort" hint="Low = first">
        <input
          type="number"
          className={INPUT_CLS}
          value={v.sort}
          onChange={(e) => patch({ sort: e.target.value ? Number(e.target.value) : 0 })}
        />
      </Field>
      <Field label="Photo" hint="Upload a file, or paste a URL">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              className={`${INPUT_CLS} min-w-0 flex-1`}
              value={v.imageUrl ?? ''}
              onChange={(e) => patch({ imageUrl: e.target.value || null })}
              placeholder="https://… or Upload →"
            />
            <label
              className={`${BTN_GHOST} shrink-0 cursor-pointer whitespace-nowrap ${
                uploading ? 'pointer-events-none opacity-60' : ''
              }`}
            >
              {uploading ? 'Uploading…' : 'Upload'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={uploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ''; // allow re-selecting the same file
                  if (!file) return;
                  setUploadErr(null);
                  setUploading(true);
                  try {
                    const url = await uploadActivityImage(file, v.slug || 'rental');
                    patch({ imageUrl: url });
                  } catch (err) {
                    setUploadErr(err instanceof Error ? err.message : 'Upload failed');
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </label>
          </div>
          {uploadErr && <p className="text-[12px] font-medium text-coral">{uploadErr}</p>}
          {v.imageUrl && (
            // Preview shows the WHOLE image (object-contain) on white — the same as the /rent card — so a
            // cropped/awkward photo is obvious here before saving. eslint-disable: CF Pages serves
            // images unoptimized.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={v.imageUrl}
              alt=""
              className="h-24 w-full rounded-lg border border-[#EAEEF0] bg-white object-contain"
            />
          )}
        </div>
      </Field>
      <label className="flex items-center gap-2 self-end pb-2.5 text-[13px] font-semibold text-ink">
        <input
          type="checkbox"
          checked={v.airCon}
          onChange={(e) => patch({ airCon: e.target.checked })}
          className="h-4 w-4 accent-teal"
        />
        Air-con
      </label>
      <label className="flex items-center gap-2 self-end pb-2.5 text-[13px] font-semibold text-ink">
        <input
          type="checkbox"
          checked={v.active}
          onChange={(e) => patch({ active: e.target.checked })}
          className="h-4 w-4 accent-teal"
        />
        Active (shown on /rent)
      </label>
    </div>
  );
}

export function AdminRentalFleet() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'staff';

  const [fleet, setFleet] = useState<RentalVehicleInput[] | null>(null);
  const [draft, setDraft] = useState<RentalVehicleInput>(BLANK);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFleet(await loadRentalFleet());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the fleet.');
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  function patchRow(i: number, p: Partial<RentalVehicleInput>) {
    setFleet((cur) => cur && cur.map((v, idx) => (idx === i ? { ...v, ...p } : v)));
  }

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setSaved(null);
    try {
      await fn();
      await load();
      setSaved(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(null);
    }
  }

  function addVehicle() {
    const slug = draft.slug || slugify(draft.name);
    if (!slug || !draft.name.trim()) {
      setError('A new vehicle needs a name and a slug.');
      return;
    }
    void run('new', async () => {
      await createRentalVehicle({ ...draft, slug });
      setDraft(BLANK);
    });
  }

  if (!isAdmin) return <p className="text-sm text-coral">Access denied.</p>;

  return (
    <div>
      <AdminHeading
        title="Rental fleet"
        subtitle="Cars & scooters shown on /rent. Booking is WhatsApp-only — prices here drive the customer’s instant quote (days × daily rate)."
      />

      {error && <AdminError>{error}</AdminError>}

      <div className="space-y-4">
        {fleet === null ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : fleet.length === 0 ? (
          <p className="text-sm text-ink-muted">No vehicles yet — add one below.</p>
        ) : (
          fleet.map((v, i) => (
            <Card key={v.slug}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-[14px] font-extrabold text-ink">
                  {v.name || v.slug} {!v.active && <span className="text-ink-muted">· hidden</span>}
                </h2>
                <div className="flex items-center gap-2">
                  {saved === v.slug && (
                    <span className="text-sm font-semibold text-emerald-700">Saved ✓</span>
                  )}
                  <button
                    type="button"
                    disabled={busy === v.slug}
                    onClick={() => void run(v.slug, () => updateRentalVehicle(fleet[i]!))}
                    className={BTN_PRIMARY}
                  >
                    {busy === v.slug ? 'Saving…' : 'Save'}
                  </button>
                  {confirmDel === v.slug ? (
                    <button
                      type="button"
                      disabled={busy === `del-${v.slug}`}
                      onClick={() =>
                        void run(`del-${v.slug}`, () => deleteRentalVehicle(v.slug)).then(() =>
                          setConfirmDel(null),
                        )
                      }
                      className="inline-flex items-center justify-center rounded-xl bg-coral px-4 py-2.5 text-[13.5px] font-bold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Confirm delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDel(v.slug)}
                      className={BTN_GHOST}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <VehicleFields v={fleet[i]!} patch={(p) => patchRow(i, p)} lockSlug />
            </Card>
          ))
        )}

        {/* Add a vehicle */}
        <Card title="Add a vehicle" className="border-dashed">
          <VehicleFields v={draft} patch={(p) => setDraft({ ...draft, ...p })} lockSlug={false} />
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled={busy === 'new'}
              onClick={addVehicle}
              className={BTN_PRIMARY}
            >
              {busy === 'new' ? 'Adding…' : 'Add vehicle'}
            </button>
            {saved === 'new' && (
              <span className="text-sm font-semibold text-emerald-700">Added ✓</span>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
