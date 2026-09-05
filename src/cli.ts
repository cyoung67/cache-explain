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

function parseTimeFlag(args: string[], flag: string): Date | undefined {
  const prefix = `${flag}=`
  const arg = args.find((a) => a.startsWith(prefix))
  if (arg === undefined) return undefined
  const value = arg.slice(prefix.length)
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) throw new Error(`${flag} value "${value}" is not a valid date`)
  return new Date(parsed)
}

function main(): void {
  const args = process.argv.slice(2)
  const cacheType = args.includes('--private') ? 'private' : 'shared'
  const filePath = args.find((a) => !a.startsWith('--'))
  const requestTime = parseTimeFlag(args, '--request-time')
  const responseTime = parseTimeFlag(args, '--response-time')

  const headers = parseRawHeaders(readInput(filePath))
  const result = explainCaching({ headers, cacheType, requestTime, responseTime })

  const lifetime =
    result.freshnessLifetimeSeconds === null ? 'unknown' : `${result.freshnessLifetimeSeconds}s`

  console.log(`cache type:         ${result.cacheType}`)
  console.log(`storable:           ${result.storable}`)
  console.log(`freshness lifetime: ${lifetime}`)
  console.log(`current age:        ${result.currentAgeSeconds}s`)
  console.log(`fresh:              ${result.isFresh ?? 'unknown'}`)
  if (result.canServeStaleWhileRevalidating) console.log('stale-while-revalidate: within grace window')
  if (result.canServeStaleIfError) console.log('stale-if-error:     within grace window')
  console.log('')
  for (const reason of result.reasons) {
    console.log(`- ${reason}`)
  }
}

main()
