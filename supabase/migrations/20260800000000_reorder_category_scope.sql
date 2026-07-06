-- Bug sweep (2026-07-06): scope api_reorder_activities to a single category server-side.
-- Previously the "one category at a time" rule was enforced ONLY in the admin client; the RPC blindly
-- renumbered whatever ids it received, so a multi-category id list (a future multi-select, a hand-crafted
-- call, or a client bug) could silently scramble sort order across categories. Now the update is
-- constrained to `a.category = p->>'category'`, so a stray id from another category simply won't match.
create or replace function api_reorder_activities(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update activities a
     set sort = t.ord
    from (
      select value::uuid as id, (ordinality - 1)::int as ord
      from jsonb_array_elements_text(p -> 'ids') with ordinality
    ) t
   where a.id = t.id
     -- Server-enforce the client's "one category at a time" rule (was client-only): an id from another
     -- category won't match, so a bad/multi-category id list can't scramble cross-category order.
     and a.category = (p ->> 'category');
end;
$$;
