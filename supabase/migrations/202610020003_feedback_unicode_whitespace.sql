-- Match JavaScript trim semantics even for direct authenticated Data API inserts.
-- POSIX [[:space:]] alone does not recognize every Unicode whitespace character.
alter table public.feedback add constraint feedback_message_nonblank
  check (char_length(btrim(message,
    E' \t\n\r\f' || chr(11) ||
    U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  )) > 0);
