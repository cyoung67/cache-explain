# Changelog

## 0.1.0

First release.

- `explainCaching()`: evaluates storability, freshness lifetime, and current
  age for a set of HTTP response headers, per RFC 9111.
- Cache-Control parsing handles `max-age`, `s-maxage`, `no-cache`/`no-store`,
  `private`/`public`, `must-revalidate`/`proxy-revalidate`, `immutable`,
  `no-transform`, and field-qualified `private="..."` / `no-cache="..."`.
- `Expires` is used as a fallback when no Cache-Control freshness directive
  is present, and an unparseable `Expires` date is treated as already
  expired rather than ignored.
- Current age is computed per RFC 9111 4.2.3 (apparent age vs. corrected
  Age header, plus resident time), not just read off the `Age` header.
- `stale-while-revalidate` and `stale-if-error` (RFC 5861) grace windows,
  with `must-revalidate` correctly cancelling the former but not the latter.
- Repeated header instances (e.g. two `Cache-Control` lines) are merged per
  RFC 9110 5.3 instead of only the first being read.
- `cache-explain` CLI: reads headers from a file or stdin, supports
  `--private`, `--request-time`/`--response-time`, and `--json` output.
