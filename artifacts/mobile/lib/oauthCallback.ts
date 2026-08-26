/**
 * Reads a value from an OAuth redirect URL, checking both the query string
 * and the fragment (Supabase's implicit-flow redirects put tokens in the
 * fragment; the PKCE/code flow puts the code in the query string).
 */
export function authCallbackValue(url: string, key: string): string | null {
  const parsed = new URL(url);
  const queryValue = parsed.searchParams.get(key);
  if (queryValue) return queryValue;
  return new URLSearchParams(parsed.hash.replace(/^#/, "")).get(key);
}
