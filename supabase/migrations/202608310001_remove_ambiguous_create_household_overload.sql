-- PostgREST matches RPC calls by argument names. The legacy four-argument
-- overload has the same first four names as the current five-argument
-- function, whose timezone argument has a default. Keeping both makes a
-- four-argument call ambiguous and can also leave the schema cache confused
-- after clients upgrade. The five-argument function is the sole supported
-- create-household entry point.
drop function if exists public.create_household(text, text, text, text);

-- Ask PostgREST to refresh its function signature cache immediately.
notify pgrst, 'reload schema';
