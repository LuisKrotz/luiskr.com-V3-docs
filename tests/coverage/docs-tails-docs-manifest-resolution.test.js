/**
 * @file docs-tails-docs-manifest-resolution.test.js
 * @description Split from docs-tails.test.js — covers the "docs manifest resolution" describe.
 */
import { describe, test, expect, jest } from '@jest/globals'
import {
  getDocsManifest,
  docsGeneratedAt,
  resolveDocsPath,
  crumbsForPath,
  fetchDocsFile,
} from '@docs/manifest.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'

const _flush = (ms = 40) => new Promise((r) => setTimeout(r, ms))

// ─── manifest.ts ─────────────────────────────────────────────────────────────
describe('docs manifest resolution', () => {
  test('manifest accessor + generated stamp come from the virtual module', () => {
    expect(getDocsManifest().roots.length).toBe(3)
    expect(docsGeneratedAt()).toBe('2024-06-01T12:00:00.000Z')
  })

  test('empty path resolves to the portal root (null node)', () => {
    expect(resolveDocsPath(CHAR_STRINGS.EMPTY)).toBe(null)
  })

  test('bare root name resolves to a synthetic dir node', () => {
    const node = resolveDocsPath('docs')

    expect(node?.type).toBe('dir')
    expect(node?.name).toBe('Documentation')
    expect(node?.children?.length).toBe(3)
  })

  test('nested path resolves through the tree', () => {
    const node = resolveDocsPath('docs/architecture/website.md')

    expect(node?.type).toBe('file')
    expect(node?.id).toBe('docs:architecture/website.md')
  })

  test('unmatched leading segment falls back to searching every root', () => {
    const node = resolveDocsPath('architecture')

    expect(node?.type).toBe('dir')
    expect(node?.path).toBe('docs/architecture')
  })

  test('case-merged subtrees hydrate their real rel path and id', () => {
    // 'App/' was merged under 'app/' — the wire carries an explicit rel
    // override so path and fetch id keep the real casing.
    const file = resolveDocsPath('src/app/x.ts')

    expect(file?.type).toBe('file')
    expect(file?.path).toBe('src/App/x.ts')
    expect(file?.id).toBe('src:App/x.ts')

    const dir = resolveDocsPath('src/app/sub')

    expect(dir?.type).toBe('dir')
    expect(dir?.path).toBe('src/App/sub')

    // Children under an overridden dir derive from the real parent rel —
    // they carry no override of their own.
    const nested = resolveDocsPath('src/app/sub/y.ts')

    expect(nested?.path).toBe('src/App/sub/y.ts')
    expect(nested?.id).toBe('src:App/sub/y.ts')
  })

  test('unknown segments resolve to null', () => {
    expect(resolveDocsPath('docs/never/there')).toBe(null)
    expect(resolveDocsPath('src/nothing.ts')).toBe(null)
  })

  test('crumbsForPath walks the path segment by segment', () => {
    expect(crumbsForPath(CHAR_STRINGS.EMPTY)).toEqual([])

    const crumbs = crumbsForPath('docs/architecture/website.md')

    expect(crumbs.map((c) => c.label)).toEqual(['docs', 'architecture', 'website.md'])
    expect(crumbs[2].path).toBe('docs/architecture/website.md')
  })

  test('fetchDocsFile encodes the id and parses the payload', async () => {
    const orig = globalThis.fetch
    const seen = []

    globalThis.fetch = jest.fn(async (url) => {
      seen.push(url)

      return { ok: true, json: async () => ({ format: 'markdown' }) }
    })

    const payload = await fetchDocsFile('docs:a b/c.md')

    expect(payload?.format).toBe('markdown')
    expect(seen[0]).toContain('a%20b/c.md.json')

    globalThis.fetch = orig
  })

  test('fetchDocsFile returns null on !ok and on throw', async () => {
    const orig = globalThis.fetch

    globalThis.fetch = jest.fn(async () => ({ ok: false }))
    expect(await fetchDocsFile('docs:x.md')).toBe(null)

    globalThis.fetch = jest.fn(async () => {
      throw new Error('net')
    })
    expect(await fetchDocsFile('docs:x.md')).toBe(null)

    globalThis.fetch = orig
  })
})
