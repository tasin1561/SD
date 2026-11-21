-- Additive: how many parcels one automatic print group holds on the Shipping
-- labels tab. Default 30; the API clamps to 1..200 when it reads it.
INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_int",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "created_at", "updated_at"
)
VALUES (
  uuidv7(), 'warehouse.print_group_size', 'ops', 'int', 30,
  'Parcels per label group',
  'Shipping labels are offered in groups: sorted by courier, then oldest order first, cut into groups of this many parcels. The last group of a courier may be smaller. From 1 to 200.',
  true, false, false, now(), now()
)
ON CONFLICT ("key") DO NOTHING;
