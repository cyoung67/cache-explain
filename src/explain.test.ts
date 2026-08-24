import { test } from 'node:test'
import assert from 'node:assert/strict'
import { explainCaching, parseCacheControl } from './explain.js'

const FIXED_NOW = new Date('2026-01-01T00:00:00Z')

test('parseCacheControl handles the awkward syntax cases', () => {
  const cases: Array<{
    name: string
    input: string
    check: (d: ReturnType<typeof parseCacheControl>) => void
  }> = [
    {
      name: 'a quoted value containing a comma is not split into two directives',
      input: 'private="X-Foo, X-Bar", max-age=10',
      check: (d) => {
        assert.deepEqual(d.privateFields, ['X-Foo', 'X-Bar'])
        assert.equal(d.maxAge, 10)
      },
    },
    {
      name: 'directive names are case-insensitive',
      input: 'MAX-AGE=100, NO-STORE',
      check: (d) => {
        assert.equal(d.maxAge, 100)
        assert.equal(d.noStore, true)
      },
    },
    {
      name: 'first occurrence of a duplicated directive wins',
      input: 'max-age=10, max-age=20',
      check: (d) => assert.equal(d.maxAge, 10),
    },
    {
      name: 'a non-numeric max-age is dropped rather than crashing',
      input: 'max-age=forever',
      check: (d) => assert.equal(d.maxAge, undefined),
    },
    {
      name: 'a negative max-age is dropped, not parsed as a small positive number',
      input: 'max-age=-5',
      check: (d) => assert.equal(d.maxAge, undefined),
    },
    {
      name: 'unknown extension directives are ignored without affecting the rest',
      input: 'max-age=10, foo-bar=baz',
      check: (d) => assert.equal(d.maxAge, 10),
    },
    {
      name: 'a bare no-cache with no field list',
      input: 'no-cache',
      check: (d) => {
        assert.equal(d.noCache, true)
        assert.deepEqual(d.noCacheFields, [])
      },
    },
  ]

  for (const { input, check } of cases) {
    check(parseCacheControl(input))
  }
})

test('explainCaching covers the header combinations that trip up naive implementations', () => {
  const cases: Array<{
    name: string
    headers: Record<string, string>
    cacheType?: 'shared' | 'private'
    expect: Partial<ReturnType<typeof explainCaching>>
  }> = [
    {
      name: 'no caching headers at all',
      headers: {},
      expect: { storable: true, freshnessLifetimeSeconds: null, isFresh: null },
    },
    {
      name: 'no-store beats a max-age on the same header',
      headers: { 'cache-control': 'no-store, max-age=3600' },
      expect: { storable: false, freshnessLifetimeSeconds: null },
    },
    {
      name: 'private is refused by a shared cache',
      headers: { 'cache-control': 'private, max-age=60' },
      cacheType: 'shared',
      expect: { storable: false },
    },
    {
      name: 'private is accepted by a private cache',
      headers: { 'cache-control': 'private, max-age=60' },
      cacheType: 'private',
      expect: { storable: true, freshnessLifetimeSeconds: 60 },
    },
    {
      name: 's-maxage overrides max-age for shared caches',
      headers: { 'cache-control': 's-maxage=60, max-age=3600' },
      cacheType: 'shared',
      expect: { freshnessLifetimeSeconds: 60 },
    },
    {
      name: 's-maxage is ignored by private caches',
      headers: { 'cache-control': 's-maxage=60, max-age=3600' },
      cacheType: 'private',
      expect: { freshnessLifetimeSeconds: 3600 },
    },
    {
      name: 'Age past the freshness lifetime makes the response stale',
      headers: { 'cache-control': 'max-age=100', age: '500' },
      expect: { isFresh: false, currentAgeSeconds: 500 },
    },
    {
      name: 'an invalid Expires date is treated as already expired',
      headers: { expires: 'not a date' },
      expect: { freshnessLifetimeSeconds: 0, isFresh: false },
    },
    {
      name: 'Cache-Control takes precedence over Expires when both are present',
      headers: { 'cache-control': 'max-age=60', expires: 'not a date' },
      expect: { freshnessLifetimeSeconds: 60 },
    },
    {
      name: 'no-cache forces revalidation even though the response could be fresh',
      headers: { 'cache-control': 'no-cache, max-age=3600' },
      expect: { alwaysRevalidate: true, isFresh: true },
    },
    {
      name: 'must-revalidate is surfaced separately from plain freshness',
      headers: { 'cache-control': 'max-age=60, must-revalidate' },
      expect: { mustRevalidateWhenStale: true },
    },
    {
      name: 'a garbage Age header is treated as zero rather than crashing',
      headers: { 'cache-control': 'max-age=60', age: 'lots' },
      expect: { currentAgeSeconds: 0 },
    },
  ]

  for (const { name, headers, cacheType, expect: expected } of cases) {
    const result = explainCaching({ headers, cacheType, now: FIXED_NOW })
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(
        (result as Record<string, unknown>)[key],
        value,
        `${name}: expected ${key} to be ${JSON.stringify(value)}, got ${JSON.stringify(
          (result as Record<string, unknown>)[key]
        )}`
      )
    }
  }
})
