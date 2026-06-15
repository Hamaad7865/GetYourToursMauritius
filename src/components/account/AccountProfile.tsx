'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { SignedOutPrompt, AccountSpinner } from './AccountChrome';

export function AccountProfile() {
  const { user, profile, loading, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFullName(profile?.fullName ?? '');
    setPhone(profile?.phone ?? '');
  }, [profile?.fullName, profile?.phone]);

  if (loading) return <AccountSpinner />;
  if (!user) return <SignedOutPrompt message="Sign in to view and edit your profile." />;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const { error } = await getBrowserSupabase()
      .from('profiles')
      .update({ full_name: fullName || null, phone: phone || null })
      .eq('id', user.id);
    if (error) {
      setError(error.message);
    } else {
      setSaved(true);
      await refreshProfile();
    }
    setSaving(false);
  }

  return (
    <div className="max-w-xl">
      <h1 className="font-display text-2xl font-semibold text-ink">Profile</h1>
      <p className="mt-1 text-sm text-ink-muted">Manage your contact details for bookings.</p>

      <form onSubmit={save} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-ink">Email</span>
          <input
            type="email"
            value={user.email ?? ''}
            disabled
            className="rounded-xl border border-ink/15 bg-cream px-3.5 py-2.5 text-sm text-ink-muted"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-ink">Full name</span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your name"
            className="rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-teal"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-ink">Phone</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+230 …"
            className="rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-teal"
          />
        </label>

        {error && <p className="text-[13px] font-medium text-coral">{error}</p>}
        {saved && <p className="text-[13px] font-medium text-teal-dark">Saved.</p>}

        <div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-teal px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-dark disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
