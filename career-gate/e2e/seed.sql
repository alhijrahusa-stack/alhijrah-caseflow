-- Test staff linked to test auth users (e2e only). Emails use the reserved .invalid TLD.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a001', 'admin@test.invalid'),
  ('00000000-0000-4000-8000-00000000a002', 'manager@test.invalid'),
  ('00000000-0000-4000-8000-00000000a003', 'staff@test.invalid');
insert into staff (display_name, email, role, auth_user_id) values
  ('TEST Admin', 'admin@test.invalid', 'admin', '00000000-0000-4000-8000-00000000a001'),
  ('TEST Manager', 'manager@test.invalid', 'manager', '00000000-0000-4000-8000-00000000a002'),
  ('TEST Staff', 'staff@test.invalid', 'staff', '00000000-0000-4000-8000-00000000a003');
