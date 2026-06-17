-- Flat-fare tours were charged per head. private-south-tour-with-pickup ('Private group' €110 up to 6),
-- airport-transfer ('Per transfer' per vehicle) and car-and-scooter-rental ('Per day' per vehicle) were
-- left at the default pricing_mode 'per_person', so their single flat per-booking fare was multiplied by
-- the party size — a 4-person private-south tour billed €440 instead of €110. They are per-group fares:
-- the tier price covers the whole party up to the tier's max_guests (extra vehicles billed via ceil),
-- which create_booking already implements for pricing_mode='per_group'.
--
-- Guard on the current value so this never clobbers a later deliberate change (e.g. an admin moving one
-- to 'vehicle'); it only corrects rows still sitting on the wrong default.
update activities
set pricing_mode = 'per_group'
where slug in ('private-south-tour-with-pickup', 'airport-transfer', 'car-and-scooter-rental')
  and pricing_mode = 'per_person';
