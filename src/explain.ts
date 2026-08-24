// Parsing and evaluation for the one question this tool answers:
// given a set of HTTP response headers, is the response cacheable,
// and if so, for how long. Rules are drawn from RFC 9111 (HTTP Caching).

export interface CacheControlDirectives {
  maxAge?: number
  sMaxAge?: number
  noCache: boolean
  noCacheFields: string[]
  noStore: boolean
  private: boolean
  privateFields: string[]
  public: boolean
  mustRevalidate: boolean
  proxyRevalidate: boolean
  immutable: boolean
  noTransform: boolean
  staleWhileRevalidate?: number
  staleIfError?: number
}

function emptyDirectives(): CacheControlDirectives {
  return {
    noCache: false,
    noCacheFields: [],
    noStore: false,
    private: false,
    privateFields: [],
    public: false,
    mustRevalidate: false,
    proxyRevalidate: false,
    immutable: false,
    noTransform: false,
  }
}

// Splits a Cache-Control header value into (name, value) pairs, respecting
// commas inside quoted-strings so `private="X-Foo, X-Bar"` stays one
// directive instead of being cut into two by a naive comma split.
function tokenize(headerValue: string): Array<[string, string | undefined]> {
  const pairs: Array<[string, string | undefined]> = []
  const len = headerValue.length
  let i = 0

  while (i < len) {
    while (i < len && /[\s,]/.test(headerValue[i])) i++
    if (i >= len) break

    const nameStart = i
    while (i < len && headerValue[i] !== '=' && headerValue[i] !== ',') i++
    const name = headerValue.slice(nameStart, i).trim()
    if (name === '') break

    if (i < len && headerValue[i] === '=') {
      i++
      while (i < len && /\s/.test(headerValue[i])) i++
      if (headerValue[i] === '"') {
        i++
        const valueStart = i
        while (i < len && headerValue[i] !== '"') i++
        pairs.push([name.toLowerCase(), headerValue.slice(valueStart, i)])
        if (i < len) i++ // skip closing quote
      } else {
        const valueStart = i
        while (i < len && headerValue[i] !== ',') i++
        pairs.push([name.toLowerCase(), headerValue.slice(valueStart, i).trim()])
      }
    } else {
      pairs.push([name.toLowerCase(), undefined])
    }
  }

  return pairs
}

function parseDeltaSeconds(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : undefined
}

function splitFieldNames(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function parseCacheControl(headerValue: string): CacheControlDirectives {
  const directives = emptyDirectives()

  for (const [name, value] of tokenize(headerValue)) {
    switch (name) {
      case 'max-age':
        if (directives.maxAge === undefined) directives.maxAge = parseDeltaSeconds(value)
        break
      case 's-maxage':
        if (directives.sMaxAge === undefined) directives.sMaxAge = parseDeltaSeconds(value)
        break
      case 'no-cache':
        directives.noCache = true
        if (value) directives.noCacheFields.push(...splitFieldNames(value))
        break
      case 'no-store':
        directives.noStore = true
        break
      case 'private':
        directives.private = true
        if (value) directives.privateFields.push(...splitFieldNames(value))
        break
      case 'public':
        directives.public = true
        break
      case 'must-revalidate':
        directives.mustRevalidate = true
        break
      case 'proxy-revalidate':
        directives.proxyRevalidate = true
        break
      case 'immutable':
        directives.immutable = true
        break
      case 'no-transform':
        directives.noTransform = true
        break
      case 'stale-while-revalidate':
        if (directives.staleWhileRevalidate === undefined)
          directives.staleWhileRevalidate = parseDeltaSeconds(value)
        break
      case 'stale-if-error':
        if (directives.staleIfError === undefined)
          directives.staleIfError = parseDeltaSeconds(value)
        break
      default:
        // unknown or extension directive: ignored per RFC 9111 5.2.3
        break
    }
  }

  return directives
}

export interface ExplainInput {
  headers: Record<string, string>
  cacheType?: 'shared' | 'private'
  now?: Date
}

export interface ExplainResult {
  cacheType: 'shared' | 'private'
  storable: boolean
  freshnessLifetimeSeconds: number | null
  currentAgeSeconds: number
  isFresh: boolean | null
  alwaysRevalidate: boolean
  mustRevalidateWhenStale: boolean
  varyStar: boolean
  reasons: string[]
}

function lookupHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key]
  }
  return undefined
}

export function explainCaching(input: ExplainInput): ExplainResult {
  const cacheType = input.cacheType ?? 'shared'
  const now = input.now ?? new Date()
  const reasons: string[] = []

  const ccHeader = lookupHeader(input.headers, 'cache-control')
  const cc = ccHeader !== undefined ? parseCacheControl(ccHeader) : emptyDirectives()

  const storable = evaluateStorable(cc, cacheType, reasons)
  const freshnessLifetimeSeconds = storable
    ? computeFreshnessLifetime(cc, cacheType, input.headers, now, reasons)
    : null
  const currentAgeSeconds = computeCurrentAge(input.headers, reasons)

  const isFresh =
    freshnessLifetimeSeconds === null ? null : currentAgeSeconds < freshnessLifetimeSeconds

  if (isFresh === true)
    reasons.push(`fresh: age ${currentAgeSeconds}s is within the ${freshnessLifetimeSeconds}s lifetime`)
  if (isFresh === false)
    reasons.push(`stale: age ${currentAgeSeconds}s exceeds the ${freshnessLifetimeSeconds}s lifetime`)
  if (cc.noCache) reasons.push('no-cache: must revalidate before every use, even while fresh')

  const mustRevalidateWhenStale = cc.mustRevalidate || (cacheType === 'shared' && cc.proxyRevalidate)
  if (mustRevalidateWhenStale) reasons.push('must not serve this stale without revalidating first')

  const varyStar = (lookupHeader(input.headers, 'vary') ?? '').trim() === '*'
  if (varyStar && cacheType === 'shared')
    reasons.push('Vary: * present — a shared cache can never match a later request to this one')

  return {
    cacheType,
    storable,
    freshnessLifetimeSeconds,
    currentAgeSeconds,
    isFresh,
    alwaysRevalidate: cc.noCache,
    mustRevalidateWhenStale,
    varyStar,
    reasons,
  }
}

function evaluateStorable(
  cc: CacheControlDirectives,
  cacheType: 'shared' | 'private',
  reasons: string[]
): boolean {
  if (cc.noStore) {
    reasons.push('no-store: response must not be stored at all')
    return false
  }
  if (cacheType === 'shared' && cc.private) {
    reasons.push('private: a shared cache must not store this response')
    return false
  }
  return true
}

function computeFreshnessLifetime(
  cc: CacheControlDirectives,
  cacheType: 'shared' | 'private',
  headers: Record<string, string>,
  now: Date,
  reasons: string[]
): number | null {
  if (cacheType === 'shared' && cc.sMaxAge !== undefined) {
    reasons.push(`s-maxage=${cc.sMaxAge} sets the freshness lifetime for shared caches`)
    return cc.sMaxAge
  }
  if (cc.maxAge !== undefined) {
    reasons.push(`max-age=${cc.maxAge} sets the freshness lifetime`)
    return cc.maxAge
  }

  const expiresValue = lookupHeader(headers, 'expires')
  if (expiresValue !== undefined) {
    const expires = Date.parse(expiresValue)
    if (Number.isNaN(expires)) {
      reasons.push('Expires is present but not a valid date — treated as already expired')
      return 0
    }
    const dateValue = lookupHeader(headers, 'date')
    const dateHeader = dateValue !== undefined ? Date.parse(dateValue) : NaN
    const basis = Number.isNaN(dateHeader) ? now.getTime() : dateHeader
    const lifetime = Math.round((expires - basis) / 1000)
    reasons.push(`Expires sets the freshness lifetime to ${lifetime}s`)
    return lifetime
  }

  reasons.push('no max-age, s-maxage, or Expires — this tool has no explicit freshness to report')
  return null
}

function computeCurrentAge(headers: Record<string, string>, reasons: string[]): number {
  const ageValue = lookupHeader(headers, 'age')
  if (ageValue === undefined) return 0
  const age = parseDeltaSeconds(ageValue.trim())
  if (age === undefined) {
    reasons.push(`Age header "${ageValue}" is not a valid non-negative integer — treated as 0`)
    return 0
  }
  return age
}
