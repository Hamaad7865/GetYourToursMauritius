import { getBrowserSupabase } from '@/lib/supabase/browser';

/* Admin leads inbox. Staff RLS (leads_staff) grants full read/write on leads, so the authenticated
 * admin reads + moves leads through their pipeline directly via the browser client — no RPC. */

export type LeadStatus = 'new' | 'contacted' | 'converted';

export interface LeadRow {
  id: string;
  name: string;
  contact: string;
  status: LeadStatus;
  source: string;
  interestActivityTitle: string | null;
  createdAt: string;
}

/** PostgREST embeds a to-one relation as an object|array|null; normalise to a single row. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

interface RawLead {
  id: string;
  name: string;
  contact: string;
  status: LeadStatus;
  source: string;
  created_at: string;
  activities: { title: string } | { title: string }[] | null;
}

/** All leads, newest first. Staff RLS returns every row. */
export async function loadLeads(limit = 300): Promise<LeadRow[]> {
  const { data, error } = await getBrowserSupabase()
    .from('leads')
    .select('id, name, contact, status, source, created_at, activities ( title )')
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<RawLead[]>();
  if (error) throw error;
  return (data ?? []).map((raw) => ({
    id: raw.id,
    name: raw.name,
    contact: raw.contact,
    status: raw.status,
    source: raw.source,
    interestActivityTitle: one(raw.activities)?.title ?? null,
    createdAt: raw.created_at,
  }));
}

/** Move a lead through its pipeline (new → contacted → converted). */
export async function setLeadStatus(id: string, status: LeadStatus): Promise<void> {
  const { error } = await getBrowserSupabase().from('leads').update({ status }).eq('id', id);
  if (error) throw error;
}
