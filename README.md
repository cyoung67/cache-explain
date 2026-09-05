# cache-explain

Answers one question: given the response headers of an HTTP response, will
this get cached, and for how long?

Cache-Control has enough interacting directives (`max-age` vs `s-maxage`,
`no-cache` vs `no-store`, `private` vs `public`, `Expires` as a fallback,
`Age` eating into the freshness budget) that eyeballing a header dump doesn't
reliably tell you what a browser or CDN will actually do with the response.
This tool runs the same freshness calculation a cache would, following
RFC 9111, and prints out the answer plus the reasoning that led to it.

## Usage

Save the response headers you want to check to a file, one `Name: value`
per line:

```
Cache-Control: max-age=300, must-revalidate
Age: 120
Date: Tue, 25 Aug 2026 12:00:00 GMT
```

Then run:

```
npm run build
node dist/cli.js headers.txt
```

```
cache type:         shared
storable:           true
freshness lifetime: 300s
current age:        120s
fresh:              true

- max-age=300 sets the freshness lifetime
- fresh: age 120s is within the 300s lifetime
- must not serve this stale without revalidating first
```

Pipe headers in over stdin instead of a file, and add `--private` to
evaluate as a browser cache rather than a shared cache (CDN, reverse proxy):

```
curl -sI https://example.com | node dist/cli.js --private
```

If you know when the request was sent and when the response was received —
say, from timing a request yourself rather than reading headers off a
prior capture — pass them along so the age calculation accounts for
network delay and time already spent in cache instead of trusting the
`Age` header verbatim:

```
node dist/cli.js --request-time=2026-08-25T12:00:00Z --response-time=2026-08-25T12:00:01Z headers.txt
```

## Library usage

```ts
import { explainCaching } from './src/explain.js'

const result = explainCaching({
  headers: { 'cache-control': 'private, max-age=60' },
  cacheType: 'shared',
})

result.storable // false — a shared cache must not store a `private` response
```

## What it gets right on purpose

- `s-maxage` only applies when evaluating a shared cache; `max-age` is the
  fallback either way.
- `no-store` and shared-cache `private` make a response unstorable outright,
  independent of any freshness lifetime.
- An `Expires` header with an unparseable date is treated as already expired,
  per RFC 9111, instead of being ignored or crashing.
- `Cache-Control` freshness directives take precedence over `Expires` when
  both are present.
- Quoted directive values (`private="X-Foo, X-Bar"`) aren't split on the
  comma inside the quotes.
- Qualified `private="field"` doesn't block a shared cache from storing the
  response — only the named fields have to be stripped before reuse. A bare
  `private` is what makes the whole response unstorable.
- Qualified `no-cache="field"` doesn't force revalidation of the whole
  response — only the named fields can't be reused without revalidating
  first. A bare `no-cache` is what makes the whole response always-revalidate.
- `stale-while-revalidate` and `stale-if-error` (RFC 5861) extend how long a
  stale response stays usable — the former for routine background
  revalidation, the latter as a fallback when revalidation fails outright.
  `must-revalidate` cancels the `stale-while-revalidate` grace window, since
  it's an explicit instruction never to serve stale; it does not cancel
  `stale-if-error`, which only kicks in once revalidation has already failed.
- Current age is computed per RFC 9111 section 4.2.3, not just read off the
  `Age` header: it takes the larger of the apparent age (response time minus
  the `Date` header) and the `Age` header corrected for request/response
  delay, then adds however long the response has been sitting in cache since
  it was received. Without explicit `--request-time`/`--response-time`
  (or their library equivalents), both default to `now`, which collapses
  this back to the bare `Age` header — so nothing changes for callers who
  don't have those timestamps.

## What it doesn't handle yet

- Only the first `Cache-Control` header is read; a response with multiple
  `Cache-Control` header instances (as opposed to multiple directives in one
  instance) isn't merged.

## Requirements

Node.js 18+. No third-party dependencies — parsing and tests use only the
Node standard library (`node:fs`, `node:test`, `node:assert`).

## License

MIT
