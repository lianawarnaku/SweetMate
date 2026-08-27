-- Deterministic replacement for waiting for every household to open a new
-- client. Existing normalized IDs win; this only fills records that have
-- never reached their canonical table.
insert into public.chores (
  id, household_id, title, description, creator_id, assigned_to,
  assignment_mode, round_robin_participant_ids, round_robin_all_members,
  round_robin_cursor, excluded_participant_ids, due_date, initial_due_date,
  next_due_date, scheduled_date, initial_scheduled_date, monthly_anchor_day,
  excluded_occurrence_dates, materialization_starts_on, recurrence_ends_on,
  completed, completed_at, completed_by_user_id, points, category, recurring,
  recurrence_series_id, occurrence_index, next_occurrence_id, source_key,
  created_at, updated_at
)
select
  c->>'id', hs.household_id, c->>'title', nullif(c->>'description', ''),
  nullif(c->>'creatorId', '')::uuid, nullif(c->>'assignedTo', '')::uuid,
  coalesce(nullif(c->>'assignmentMode', ''), 'specific-person'),
  array(select value::uuid from jsonb_array_elements_text(coalesce(c->'roundRobinParticipantIds', '[]'::jsonb))),
  coalesce((c->>'roundRobinAllMembers')::boolean, false),
  coalesce((c->>'roundRobinCursor')::integer, 0),
  array(select value::uuid from jsonb_array_elements_text(coalesce(c->'excludedParticipantIds', '[]'::jsonb))),
  (c->>'dueDate')::timestamptz, nullif(c->>'initialDueDate', '')::timestamptz,
  nullif(c->>'nextDueDate', '')::timestamptz, nullif(c->>'scheduledDate', '')::date,
  nullif(c->>'initialScheduledDate', '')::date, nullif(c->>'monthlyAnchorDay', '')::integer,
  array(select value::date from jsonb_array_elements_text(coalesce(c->'excludedOccurrenceDates', '[]'::jsonb))),
  nullif(c->>'materializationStartsOn', '')::date, nullif(c->>'recurrenceEndsOn', '')::date,
  coalesce((c->>'completed')::boolean, false), nullif(c->>'completedAt', '')::timestamptz,
  nullif(c->>'completedByUserId', '')::uuid, coalesce((c->>'points')::integer, 0),
  coalesce(nullif(c->>'category', ''), 'other'), nullif(c->>'recurring', ''),
  nullif(c->>'recurrenceSeriesId', ''), nullif(c->>'occurrenceIndex', '')::integer,
  nullif(c->>'nextOccurrenceId', ''), nullif(c->>'sourceKey', ''),
  coalesce(nullif(c->>'createdAt', '')::timestamptz, now()),
  coalesce(nullif(c->>'updatedAt', '')::timestamptz, now())
from public.household_states hs
cross join lateral jsonb_array_elements(coalesce(hs.state->'chores', '[]'::jsonb)) c
where c ? 'id'
on conflict (id) do nothing;

insert into public.expenses (
  id, household_id, paid_by, creator_id, amount_cents, expense_date,
  settled, entry, created_at, updated_at
)
select
  e->>'id', hs.household_id, (e->>'paidBy')::uuid,
  nullif(e->>'creatorId', '')::uuid,
  coalesce((e->>'amountCents')::bigint, round((e->>'amount')::numeric * 100)::bigint),
  (e->>'date')::date, coalesce((e->>'settled')::boolean, false), e,
  coalesce(nullif(e->>'createdAt', '')::timestamptz, now()),
  coalesce(nullif(e->>'updatedAt', '')::timestamptz, nullif(e->>'createdAt', '')::timestamptz, now())
from public.household_states hs
cross join lateral jsonb_array_elements(coalesce(hs.state->'expenses', '[]'::jsonb)) e
where e ? 'id'
on conflict (id) do nothing;

insert into public.shopping_lists (
  id, household_id, name, assigned_to, pinned, planned_date, sort_order, entry, updated_at
)
select
  l->>'id', hs.household_id, l->>'name', nullif(l->>'assignedTo', '')::uuid,
  coalesce((l->>'pinned')::boolean, false), nullif(l->>'plannedDate', '')::date,
  ordinality::integer - 1, l,
  coalesce(nullif(l->>'updatedAt', '')::timestamptz, '1970-01-01'::timestamptz)
from public.household_states hs
cross join lateral jsonb_array_elements(coalesce(hs.state->'shoppingLists', '[]'::jsonb)) with ordinality as lists(l, ordinality)
where l ? 'id'
on conflict (id) do nothing;

insert into public.shopping_items (
  id, household_id, list_id, name, completed, sort_order, entry, updated_at
)
select
  i->>'id', hs.household_id, i->>'listId', i->>'name',
  coalesce((i->>'completed')::boolean, false), ordinality::integer - 1, i,
  coalesce(nullif(i->>'updatedAt', '')::timestamptz, '1970-01-01'::timestamptz)
from public.household_states hs
cross join lateral jsonb_array_elements(coalesce(hs.state->'shoppingItems', '[]'::jsonb)) with ordinality as items(i, ordinality)
where i ? 'id'
on conflict (id) do nothing;

insert into public.shared_borrow_items (
  id, household_id, creator_id, owner_id, borrowed_from, borrowed_by,
  due_date, returned, entry, created_at, updated_at
)
select
  b->>'id', hs.household_id, nullif(b->>'creatorId', '')::uuid,
  coalesce(nullif(b->>'ownerId', '')::uuid, nullif(b->>'creatorId', '')::uuid),
  (b->>'borrowedFrom')::uuid, nullif(b->>'borrowedBy', '')::uuid,
  (b->>'dueDate')::timestamptz, coalesce((b->>'returned')::boolean, false),
  jsonb_set(b, '{visibility}', '"shared"'::jsonb, true),
  coalesce(nullif(b->>'createdAt', '')::timestamptz, now()),
  coalesce(nullif(b->>'updatedAt', '')::timestamptz, nullif(b->>'createdAt', '')::timestamptz, now())
from public.household_states hs
cross join lateral jsonb_array_elements(coalesce(hs.state->'borrowItems', '[]'::jsonb)) b
where b ? 'id' and coalesce(b->>'visibility', 'shared') = 'shared'
on conflict (id) do nothing;
