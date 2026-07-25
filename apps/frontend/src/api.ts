// The single seam between the browser and the backend read/write API, and the one place the
// four old failure contracts collapse into ONE.
//
// Every call returns a `Result`:
//
//   { ok: true,  data }   — the request landed with a 2xx.
//   { ok: false, error }  — it did not: a non-2xx, OR a `fetch` rejection (network/CORS).
//
// `fetch` REJECTS on a network or CORS failure (unlike supabase-js, which resolved
// { data:null, error }); catching that rejection here is what turns it into the same
// `{ ok:false }` sentinel every caller now branches on. The "could not ask" vs "the answer is
// empty" distinction that lookupProducts / lookupMerchantVoucher depend on is carried by the
// TYPE — `{ ok:false }` vs `{ ok:true, data:[] }` — not by a doc comment.
//
// Callers that would rather let a failure throw to a React error boundary (admin lists, order
// history) wrap the call in `unwrap()`; the throw is then explicit at the call site.
import { supabase } from './supabase'

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'

// The generic failure payload. `E` on `Result` defaults to this; calls with a richer domain
// error (placeOrder → OrderError, quoteDelivery → DeliveryQuoteError) parameterise `E` instead.
export interface ApiError {
  status?: number   // the HTTP status, absent when the request never landed
  code?: string     // a machine code — the backend's `error` string, or a client one like 'not_signed_in'
  message: string   // human-readable, safe to surface
}

export type Result<T, E = ApiError> =
  | { ok: true; data: T }
  | { ok: false; error: E }

// The escape hatch for callers that WANT a throw (error boundaries, react-query). Explicit at
// the call site: `unwrap(await fetchAllMerchants())`.
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.data
  throw r.error instanceof Error
    ? r.error
    : new Error((r.error as { message?: string })?.message || 'Request failed')
}

//   false      — no Authorization header.
//   true       — attach the token IF a session exists (guest-tolerant reads/writes).
//   'required' — no session short-circuits to a `not_signed_in` failure WITHOUT sending.
type Auth = boolean | 'required'
interface Opts { auth?: Auth }

const NOT_SIGNED_IN: ApiError = { code: 'not_signed_in', message: 'Not signed in' }

// Resolves the request headers, or a short-circuit failure when `auth:'required'` has no session.
async function resolveHeaders(
  base: Record<string, string>,
  auth: Auth | undefined,
): Promise<{ headers: Record<string, string> } | { fail: ApiError }> {
  if (!auth) return { headers: base }
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (token) return { headers: { ...base, Authorization: `Bearer ${token}` } }
  if (auth === 'required') return { fail: NOT_SIGNED_IN }
  return { headers: base } // auth:true, no session → send unauthenticated
}

// Turns a non-2xx Response into an ApiError, reading the backend's `{ error }` body when present.
async function errorFromResponse(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  return { status: res.status, code: body.error, message: body.error || `Request failed: ${res.status}` }
}

// The single failure any rejection collapses to. No status — the request never landed.
const NETWORK_ERROR: ApiError = { message: 'Network request failed' }

export async function apiGet<T>(path: string, opts?: Opts): Promise<Result<T>> {
  const h = await resolveHeaders({}, opts?.auth)
  if ('fail' in h) return { ok: false, error: h.fail }
  try {
    const res = await fetch(`${API_URL}${path}`, { headers: h.headers })
    if (!res.ok) return { ok: false, error: await errorFromResponse(res) }
    return { ok: true, data: (await res.json()) as T }
  } catch {
    return { ok: false, error: NETWORK_ERROR }
  }
}

type Method = 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export async function apiSend<T>(path: string, method: Method, body?: unknown, opts?: Opts): Promise<Result<T>> {
  const h = await resolveHeaders({ 'Content-Type': 'application/json' }, opts?.auth)
  if ('fail' in h) return { ok: false, error: h.fail }
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: h.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) return { ok: false, error: await errorFromResponse(res) }
    const text = await res.text()
    return { ok: true, data: (text ? JSON.parse(text) : null) as T }
  } catch {
    return { ok: false, error: NETWORK_ERROR }
  }
}
