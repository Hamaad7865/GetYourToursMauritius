'use client';

import { useEffect, useState } from 'react';
import { loadLeads, setLeadStatus, type LeadRow, type LeadStatus } from '@/lib/admin/leads';

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}

const STATUS_STYLE: Record<LeadStatus, string> = {
  new: 'bg-coral/10 text-coral',
  contacted: 'bg-gold-light/20 text-gold',
  converted: 'bg-teal/10 text-teal-dark',
};

const STATUSES: LeadStatus[] = ['new', 'contacted', 'converted'];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// The public contact form stores free text in `contact`. Only turn it into a mailto: link when it
// is strictly a single email address — otherwise an attacker controls the URL after `mailto:` and
// could pre-populate `?cc=/&subject=/&body=` for a staff click. Anything else renders as plain text.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
function mailtoHref(contact: string): string | null {
  const trimmed = contact.trim();
  return EMAIL_RE.test(trimmed) ? `mailto:${trimmed}` : null;
}

export function AdminLeads() {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LeadStatus | 'all'>('all');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await loadLeads();
        if (active) setLeads(rows);
      } catch (err) {
        if (active) setError(errMessage(err, 'Could not load leads.'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function changeStatus(id: string, status: LeadStatus) {
    const prev = leads;
    setLeads((rows) => rows.map((l) => (l.id === id ? { ...l, status } : l))); // optimistic
    try {
      await setLeadStatus(id, status);
    } catch (err) {
      setLeads(prev); // revert
      setError(errMessage(err, 'Could not update the lead.'));
    }
  }

  const shown = filter === 'all' ? leads : leads.filter((l) => l.status === filter);
  const newCount = leads.filter((l) => l.status === 'new').length;

  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <h1 className="font-display text-2xl font-semibold text-ink">Leads</h1>
        {newCount > 0 && (
          <span className="rounded-full bg-coral/10 px-2.5 py-1 text-[12px] font-bold text-coral">
            {newCount} new
          </span>
        )}
      </div>
      <p className="mb-6 text-sm text-ink-muted">Enquiries from the contact form and the site.</p>

      <div className="mb-4 flex flex-wrap gap-2">
        {(['all', ...STATUSES] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold capitalize ${
              filter === f ? 'bg-teal text-white' : 'bg-white text-ink hover:bg-cream'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-coral/10 px-4 py-3 text-[13px] font-medium text-coral">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-ink/10 bg-white px-5 py-8 text-center text-sm text-ink-muted">
          {leads.length === 0 ? 'No enquiries yet.' : 'No leads in this view.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink/10 text-[12px] uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-bold">Name</th>
                <th className="px-4 py-3 font-bold">Contact</th>
                <th className="hidden px-4 py-3 font-bold sm:table-cell">Interested in</th>
                <th className="hidden px-4 py-3 font-bold md:table-cell">Received</th>
                <th className="px-4 py-3 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((lead) => {
                const href = mailtoHref(lead.contact);
                return (
                <tr key={lead.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3 font-semibold text-ink">{lead.name}</td>
                  <td className="px-4 py-3 text-ink">
                    {href ? (
                      <a href={href} className="text-teal hover:text-teal-dark">
                        {lead.contact}
                      </a>
                    ) : (
                      <span>{lead.contact}</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-ink-muted sm:table-cell">
                    {lead.interestActivityTitle ?? '—'}
                  </td>
                  <td className="hidden px-4 py-3 text-ink-muted md:table-cell">{formatWhen(lead.createdAt)}</td>
                  <td className="px-4 py-3">
                    <label className="sr-only" htmlFor={`status-${lead.id}`}>
                      Status for {lead.name}
                    </label>
                    <select
                      id={`status-${lead.id}`}
                      value={lead.status}
                      onChange={(e) => changeStatus(lead.id, e.target.value as LeadStatus)}
                      className={`rounded-full px-2.5 py-1 text-[12px] font-bold capitalize outline-none ${STATUS_STYLE[lead.status]}`}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
