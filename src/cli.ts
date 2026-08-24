#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { explainCaching } from './explain.js'

function parseRawHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return headers
}

function readInput(path: string | undefined): string {
  if (path !== undefined) return readFileSync(path, 'utf8')
  return readFileSync(0, 'utf8') // stdin
}

function main(): void {
  const args = process.argv.slice(2)
  const cacheType = args.includes('--private') ? 'private' : 'shared'
  const filePath = args.find((a) => !a.startsWith('--'))

  const headers = parseRawHeaders(readInput(filePath))
  const result = explainCaching({ headers, cacheType })

  const lifetime =
    result.freshnessLifetimeSeconds === null ? 'unknown' : `${result.freshnessLifetimeSeconds}s`

  console.log(`cache type:         ${result.cacheType}`)
  console.log(`storable:           ${result.storable}`)
  console.log(`freshness lifetime: ${lifetime}`)
  console.log(`current age:        ${result.currentAgeSeconds}s`)
  console.log(`fresh:              ${result.isFresh ?? 'unknown'}`)
  console.log('')
  for (const reason of result.reasons) {
    console.log(`- ${reason}`)
  }
}

main()
