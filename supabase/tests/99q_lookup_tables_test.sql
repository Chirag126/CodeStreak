-- Phase 43: the lookup-table row is service-role only and holds valid addresses.
\set QUIET on
set client_min_messages = warning;

do $$ begin
  assert not has_table_privilege('anon', 'public.chain_lookup_tables', 'select');
  assert not has_table_privilege('authenticated', 'public.chain_lookup_tables', 'select');
  assert not has_table_privilege('authenticated', 'public.chain_lookup_tables', 'insert');
end $$;

-- The worker's upsert (PostgREST on_conflict=authority, merge).
insert into public.chain_lookup_tables (authority, address, addresses)
values ('Verif1er11111111111111111111111111111111111', 'Tab1e111111111111111111111111111111111111111', 9);
insert into public.chain_lookup_tables (authority, address, addresses)
values ('Verif1er11111111111111111111111111111111111', 'Tab1e222222222222222222222222222222222222222', 10)
on conflict (authority) do update set address = excluded.address, addresses = excluded.addresses, updated_at = now();
do $$ begin
  assert (select address from public.chain_lookup_tables where authority = 'Verif1er11111111111111111111111111111111111') = 'Tab1e222222222222222222222222222222222222222';
end $$;

-- Not an address, or more than a table can hold: refused.
do $$ begin
  begin
    insert into public.chain_lookup_tables (authority, address) values ('not an address', 'Tab1e333333333333333333333333333333333333333');
    raise exception 'NOT REJECTED: bad authority';
  exception when check_violation then null;
  end;
  begin
    insert into public.chain_lookup_tables (authority, address, addresses) values ('Other11111111111111111111111111111111111111', 'Tab1e444444444444444444444444444444444444444', 257);
    raise exception 'NOT REJECTED: 257 addresses';
  exception when check_violation then null;
  end;
end $$;

set role anon;
do $$ begin
  perform 1 from public.chain_lookup_tables limit 1;
  raise exception 'NOT REJECTED: anon read chain_lookup_tables';
exception when insufficient_privilege then null;
end $$;
reset role;

delete from public.chain_lookup_tables where authority = 'Verif1er11111111111111111111111111111111111';
do $$ begin raise notice '99q_lookup_tables_test: all passed'; end $$;
