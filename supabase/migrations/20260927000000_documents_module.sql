-- 20260927000000_documents_module
--
-- The DOCUMENTS module: standalone quotes / invoices / proformas / receipts for any client, in
-- MUR / EUR / USD, paid offline or unpaid. A self-contained ISLAND — it never reads or writes
-- bookings, payments or the Peach ledger, so it cannot destabilise the money path. It exists to bill
-- the parties that never go through the online booking flow (the GLOBALAND case, which had to be run
-- from a throwaway script). Full design: docs/superpowers/specs/2026-08-12-documents-module-design.md.
--
-- Two staff-only tables + a per-type/per-year numbering counter, and four small SECURITY DEFINER
-- helpers for the transitions that must be atomic (gapless numbering) or cross-cutting
-- (issue / convert / void). Staff read and write the tables directly through the browser client under
-- the *_staff RLS policies, exactly as the quotes module does (20260909000000); only the numbered and
-- linked transitions go through an RPC.
--
-- Money is in integer MINOR units (all three currencies are ISO exponent-2). Idempotent throughout
-- (this file is mirrored into supabase/catch-up.sql and bundled into supabase/setup.sql).

-- ---------------------------------------------------------------------------
-- 1) document_clients — the self-building bill-to list. The operator free-types a client on a
--    document and may tick "remember", which upserts a reusable row here. PII, so staff-only.
-- ---------------------------------------------------------------------------
create table if not exists document_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  street text,
  locality text,
  region text,
  country text,
  brn text,
  vat text,
  -- `set null`, like quotes.created_by: a document outlives its author, so removing a departed
  -- colleague's auth user must forget who saved the client, never be blocked by it.
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table document_clients enable row level security;
drop policy if exists document_clients_staff_all on document_clients;
create policy document_clients_staff_all on document_clients
  for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- 2) documents — one row = one document. Once ISSUED it is an immutable snapshot: client_snapshot and
--    issuer_snapshot freeze the bill-to and our own identity, so a reprint is stable even if the
--    client record or the business address later changes (the same discipline booking supplements use).
--    The stored *_minor totals are for the list + sorting; the renderer recomputes from `lines`, so a
--    drifted stored total can never produce a wrong PDF.
-- ---------------------------------------------------------------------------
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('quote', 'invoice', 'proforma', 'receipt')),
  -- Null until issued: a draft is unnumbered, so an abandoned draft never burns a number.
  number text,
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'accepted', 'declined', 'expired', 'paid', 'part_paid', 'void', 'converted')),
  currency text not null check (currency in ('MUR', 'EUR', 'USD')),
  client_id uuid references document_clients (id) on delete set null,
  client_snapshot jsonb not null default '{}'::jsonb,
  issuer_snapshot jsonb not null default '{}'::jsonb,
  -- [{ description, quantity, unitMinor }] — the itemisation, snapshotted on the document.
  lines jsonb not null default '[]'::jsonb,
  vat_mode text not null default 'inclusive' check (vat_mode in ('inclusive', 'exclusive', 'none')),
  vat_rate_pct int not null default 15,
  -- bigint like every money column on the repo's money path: a full-boat charter overflows int4 cents.
  subtotal_net_minor bigint not null default 0 check (subtotal_net_minor >= 0),
  vat_minor bigint not null default 0 check (vat_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  -- Manual settlement — NOT the Peach ledger. Drives the PAID stamp / Amount Due on the document.
  amount_paid_minor bigint not null default 0 check (amount_paid_minor >= 0),
  payment_method text,
  payment_ref text,
  paid_at timestamptz,
  issue_date date,
  due_date date,
  valid_until date,
  -- Client-facing covering note (rendered) and staff-only note (never rendered).
  notes text,
  internal_notes text,
  -- The quote this invoice was converted from (convert_document), for provenance.
  source_document_id uuid references documents (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_type_status_idx on documents (type, status);
create index if not exists documents_created_idx on documents (created_at desc);
create index if not exists documents_number_idx on documents (number);

alter table documents enable row level security;
drop policy if exists documents_staff_all on documents;
create policy documents_staff_all on documents
  for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- 3) document_counters — the per-type, per-year sequence behind gapless numbering. No RLS policy:
--    only allocate_document_number (SECURITY DEFINER) ever touches it, so no role reaches it directly.
-- ---------------------------------------------------------------------------
create table if not exists document_counters (
  doc_type text not null,
  year int not null,
  next_val int not null default 0,
  primary key (doc_type, year)
);
alter table document_counters enable row level security;

-- Table privileges. The one-time `grant ... on all tables in schema public` (20260615120800) only
-- covered the tables that existed then, so a table added later must state its own grants. RLS (above)
-- is what gates the ROWS to staff; these grants are the table-level privilege that both the browser
-- client (direct staff reads/writes) and the definer helpers' `returns documents` composite require.
-- anon gets nothing — the whole module is staff-only. document_counters is reached ONLY through
-- allocate_document_number (definer), so it is never granted to authenticated.
grant select, insert, update, delete on document_clients to authenticated;
grant select, insert, update, delete on documents to authenticated;
grant all on document_clients, documents, document_counters to service_role;

-- ---------------------------------------------------------------------------
-- 4) allocate_document_number — atomically claim the next number for a (type, year). The upsert's
--    ON CONFLICT DO UPDATE increments under the row lock, so two staff issuing at the same instant
--    serialise here rather than both reading the same next_val. Format PREFIX-YYYY-#### (4-digit).
-- ---------------------------------------------------------------------------
create or replace function allocate_document_number(p_type text, p_year int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next int;
  v_prefix text;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;

  v_prefix := case p_type
    when 'quote' then 'QUO'
    when 'invoice' then 'INV'
    when 'proforma' then 'PRO'
    when 'receipt' then 'RCT'
    else null
  end;
  if v_prefix is null then
    raise exception 'invalid_document_type' using detail = coalesce(p_type, 'null');
  end if;

  insert into document_counters as c (doc_type, year, next_val)
    values (p_type, p_year, 1)
  on conflict (doc_type, year)
    do update set next_val = c.next_val + 1
  returning next_val into v_next;

  return v_prefix || '-' || p_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$$;
-- `from public, anon`, never just PUBLIC: Supabase grants EXECUTE to anon AND authenticated explicitly
-- at creation (not via PUBLIC), so a revoke naming only PUBLIC leaves anon holding it — the one-word
-- omission that has shipped a live leak from this repo more than once. is_staff() guards the body too.
revoke execute on function allocate_document_number(text, int) from public, anon;
grant execute on function allocate_document_number(text, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) issue_document — allocate the number, freeze the issuer snapshot, move off draft, all atomically
--    under a row lock so a double-click cannot issue the same document twice or burn two numbers.
--    Refuses anything already issued (a numbered document is voided, never re-issued).
-- ---------------------------------------------------------------------------
create or replace function issue_document(p_id uuid, p_issuer jsonb)
returns documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc documents;
  v_year int;
  v_number text;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;

  select * into v_doc from documents where id = p_id for update;
  if v_doc.id is null then
    raise exception 'document_not_found';
  end if;
  if v_doc.status <> 'draft' then
    raise exception 'document_already_issued' using detail = v_doc.status;
  end if;

  v_year := extract(year from coalesce(v_doc.issue_date, current_date))::int;
  v_number := allocate_document_number(v_doc.type, v_year);

  update documents
     set number = v_number,
         issuer_snapshot = coalesce(p_issuer, issuer_snapshot),
         status = 'issued',
         issue_date = coalesce(issue_date, current_date),
         updated_at = now()
   where id = p_id
   returning * into v_doc;

  return v_doc;
end;
$$;
revoke execute on function issue_document(uuid, jsonb) from public, anon;
grant execute on function issue_document(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) convert_document — clone a QUOTE into a fresh invoice DRAFT and mark the quote converted, in one
--    transaction. The new invoice is a draft (unnumbered) so the operator can adjust it before issuing.
-- ---------------------------------------------------------------------------
create or replace function convert_document(p_id uuid)
returns documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src documents;
  v_new documents;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;

  select * into v_src from documents where id = p_id for update;
  if v_src.id is null then
    raise exception 'document_not_found';
  end if;
  if v_src.type <> 'quote' then
    raise exception 'not_a_quote' using detail = v_src.type;
  end if;

  insert into documents (
    type, status, currency, client_id, client_snapshot, lines,
    vat_mode, vat_rate_pct, subtotal_net_minor, vat_minor, total_minor,
    notes, source_document_id, created_by
  )
  values (
    'invoice', 'draft', v_src.currency, v_src.client_id, v_src.client_snapshot, v_src.lines,
    v_src.vat_mode, v_src.vat_rate_pct, v_src.subtotal_net_minor, v_src.vat_minor, v_src.total_minor,
    v_src.notes, v_src.id, auth.uid()
  )
  returning * into v_new;

  update documents set status = 'converted', updated_at = now() where id = v_src.id;

  return v_new;
end;
$$;
revoke execute on function convert_document(uuid) from public, anon;
grant execute on function convert_document(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) void_document — a numbered document is VOIDED, never deleted, so the sequence stays gapless and
--    audit-clean. A draft has no number and is deleted outright by the client, so voiding one is refused.
-- ---------------------------------------------------------------------------
create or replace function void_document(p_id uuid)
returns documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc documents;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;

  select * into v_doc from documents where id = p_id for update;
  if v_doc.id is null then
    raise exception 'document_not_found';
  end if;
  if v_doc.status = 'draft' then
    raise exception 'draft_not_voidable';
  end if;

  update documents set status = 'void', updated_at = now() where id = p_id returning * into v_doc;
  return v_doc;
end;
$$;
revoke execute on function void_document(uuid) from public, anon;
grant execute on function void_document(uuid) to authenticated, service_role;
