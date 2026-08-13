// The path part of a path, for the two rules in this module that must not read a query string.
//
// NOT canonical.ts's `normalisedPath`, deliberately, and the difference is load-bearing: that one
// COLLAPSES a signup preselection (`/merchant/signup/yearly` → `/merchant/signup`), which is right
// for a canonical URL and destroys the exact segment cta.ts exists to read. It also keeps a query
// string, which scope.ts must drop to answer for `/reset-password?shop=<slug>`.

/** Everything before the first `?` or `#`. */
export function pathOnly(value: string): string {
  return value.split('?')[0].split('#')[0]
}
