-- Best-effort home/boarding regions for the region-based transport add-on (per_person / per_group
-- activities with hotel pickup). The transport fee scales with the distance from the customer's pickup
-- to this region, so each such activity needs one. These are sensible defaults by category — refine any
-- of them per-activity in /admin → Activities → Home region (transport add-on).
--
-- Idempotent: only sets a region where it is still null, so re-running won't clobber admin edits.
-- Run AFTER supabase/seed-catalogue.sql (which creates the activities). Vehicle / vehicle_custom tours
-- are intentionally skipped (they already price the whole drive).

do $$
declare
  v_op uuid;
begin
  select id into v_op from operators where slug = 'belle-mare-tours';
  if v_op is null then
    raise notice 'operator belle-mare-tours not found — run the admin setup + catalogue seed first';
    return;
  end if;

  update activities set region = 'West'
    where operator_id = v_op and region is null and pricing_mode in ('per_person', 'per_group')
      and category = 'Dolphin swims';                 -- Tamarin Bay / Bénitier (west coast)

  update activities set region = 'East'
    where operator_id = v_op and region is null and pricing_mode in ('per_person', 'per_group')
      and category = 'Île aux Cerfs';                 -- east-coast island

  update activities set region = 'East'
    where operator_id = v_op and region is null and pricing_mode in ('per_person', 'per_group')
      and category = 'Catamaran cruises';             -- flagship departs east (Trou d'Eau Douce); adjust west/north ones

  update activities set region = 'North'
    where operator_id = v_op and region is null and pricing_mode in ('per_person', 'per_group')
      and category = 'Air activities';                -- seaplane Mont Choisy / skydive (north)

  update activities set region = 'West'
    where operator_id = v_op and region is null and pricing_mode in ('per_person', 'per_group')
      and category = 'Hiking & trails';               -- Black River Gorges / Tamarind Falls / Le Morne (west / south-west)

  update activities set region = 'West'
    where operator_id = v_op and region is null and pricing_mode in ('per_person', 'per_group')
      and category = 'Sea & water activities';        -- most dive/sea sites are west (Flic-en-Flac); adjust per site
end $$;

-- Verify:
--   select category, region, count(*) from activities
--   where pricing_mode in ('per_person','per_group') group by 1, 2 order by 1;
