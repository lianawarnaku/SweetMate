/** Attach the compatibility signal only to this project's PostgREST calls.
 * Auth and Edge Functions retain their existing headers/CORS behavior. */
export function createChorePolicyFetch(baseUrl: string, fetcher: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(`${baseUrl.replace(/\/$/, "")}/rest/v1/`)) return fetcher(input, init);
    const originalHeaders = typeof input === "object" && "headers" in input ? input.headers : undefined;
    const headers = new Headers(init?.headers ?? originalHeaders);
    headers.set("x-sweetmate-chore-policy", "single-obligation-v1");
    return fetcher(input, { ...init, headers });
  };
}
