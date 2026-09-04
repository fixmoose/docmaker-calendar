-- DocMaker Calendar — delta: notes that belong to a day, and the shopping
-- list. Safe to run repeatedly.

-- Not everything worth writing down is about an event. "Took the subway that
-- day" is about the day itself, and pinning it to something that happened to
-- be in the diary would be filing it under the wrong thing.
alter table if exists cc_notes
  add column if not exists day date;

create index if not exists cc_notes_day_idx on cc_notes (day);

-- ------------------------------------------------------------------ --
-- The shopping list
-- ------------------------------------------------------------------ --

/*
 * A list belongs to a day, and to one person or one group, exactly as a note
 * does. It stays open until somebody finishes it: adding to an open list moves
 * it to the day it was last touched, so the calendar shows where the shopping
 * currently stands rather than where it started. Finishing one leaves it on
 * its day for good, and the next list begins where the next shopping does.
 */
create table if not exists cc_shopping_lists (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid references cc_groups (id) on delete cascade,
  day        date not null default (now() at time zone 'utc')::date,
  -- Finished, or given up on: either way it no longer moves.
  done       boolean not null default false,
  created_by uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cc_shopping_lists_day_idx on cc_shopping_lists (day);
create index if not exists cc_shopping_lists_group_idx on cc_shopping_lists (group_id, day desc);

drop trigger if exists cc_shopping_lists_touch on cc_shopping_lists;
create trigger cc_shopping_lists_touch
  before update on cc_shopping_lists
  for each row execute function cc_touch_updated_at();

create table if not exists cc_shopping_items (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references cc_shopping_lists (id) on delete cascade,
  text       text not null,
  -- Free text rather than a number: "2 ×", "500g" and "a case of" all happen.
  quantity   text,
  done       boolean not null default false,
  done_by    uuid references cc_profiles (id) on delete set null,
  done_at    timestamptz,
  position   integer not null default 0,
  created_by uuid not null default auth.uid() references cc_profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists cc_shopping_items_list_idx
  on cc_shopping_items (list_id, position);

alter table cc_shopping_lists enable row level security;
alter table cc_shopping_items enable row level security;

-- Yours, or your group's — the same rule a note follows.
drop policy if exists cc_shopping_lists_read on cc_shopping_lists;
create policy cc_shopping_lists_read on cc_shopping_lists for select using (
  created_by = auth.uid()
  or (group_id is not null and cc_is_group_member(group_id, auth.uid()))
);

drop policy if exists cc_shopping_lists_insert on cc_shopping_lists;
create policy cc_shopping_lists_insert on cc_shopping_lists for insert with check (
  created_by = auth.uid()
  and (group_id is null or cc_is_group_member(group_id, auth.uid()))
);

/*
 * A note is somebody's own words and only they may change them. A list is the
 * opposite: whoever is at the shop ticks it off, and whoever remembers the
 * milk adds it. So anyone the list is shared with may work it.
 */
drop policy if exists cc_shopping_lists_write on cc_shopping_lists;
create policy cc_shopping_lists_write on cc_shopping_lists for update using (
  created_by = auth.uid()
  or (group_id is not null and cc_is_group_member(group_id, auth.uid()))
) with check (
  created_by = auth.uid()
  or (group_id is not null and cc_is_group_member(group_id, auth.uid()))
);

drop policy if exists cc_shopping_lists_delete on cc_shopping_lists;
create policy cc_shopping_lists_delete on cc_shopping_lists for delete using (
  created_by = auth.uid()
  or (group_id is not null and cc_is_group_member(group_id, auth.uid()))
);

create or replace function cc_can_use_shopping_list(p_list uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from cc_shopping_lists l
    where l.id = p_list
      and (
        l.created_by = p_user
        or (l.group_id is not null and cc_is_group_member(l.group_id, p_user))
      )
  );
$$;

drop policy if exists cc_shopping_items_all on cc_shopping_items;
create policy cc_shopping_items_all on cc_shopping_items for all
  using (cc_can_use_shopping_list(list_id, auth.uid()))
  with check (cc_can_use_shopping_list(list_id, auth.uid()));

-- Ticking something off should show on the other person's screen while they
-- are standing in the aisle, not when they next reload.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'cc_shopping_lists'
  ) then
    alter publication supabase_realtime add table cc_shopping_lists;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'cc_shopping_items'
  ) then
    alter publication supabase_realtime add table cc_shopping_items;
  end if;
end $$;
