/**
 * @file manifest-nodocsroot-tails.test.js
 * @description Coverage tail for manifest.ts — buildGroups' `docsRoot`
 * falsy arm (a manifest with no `kind:'docs'` root leaves the
 * Documentation and Architecture sections empty/dropped).
 */

import { describe, test, expect, jest } from '@jest/globals'
import { encodeManifest } from '@build/docs/encode.mjs'

jest.unstable_mockModule('virtual:docs-manifest', () => ({
  default: encodeManifest({
    generated: '2024-06-01T12:00:00.000Z',
    roots: [
      {
        root: 'src',
        label: 'Source',
        kind: 'source',
        children: [
          {
            type: 'dir',
            name: 'core',
            path: 'src/core',
            children: [
              {
                type: 'file',
                name: 'jsx.ts',
                path: 'src/core/jsx.ts',
                id: 'src:core/jsx.ts',
                format: 'typescript',
                size: 5,
                mtime: '2024-06-01T12:00:00.000Z',
                embedded: true,
              },
            ],
          },
        ],
      },
      {
        root: 'coverage',
        label: 'Coverage',
        kind: 'coverage',
        children: [
          {
            type: 'file',
            name: 'index.html',
            path: 'coverage/index.html',
            id: 'coverage:index.html',
            format: 'html',
            size: 5,
            mtime: '2024-06-01T12:00:00.000Z',
            embedded: true,
          },
        ],
      },
      {
        root: 'misc',
        label: 'Misc',
        kind: 'misc',
        children: [],
      },
    ],
  }),
}))

describe('docs manifest — no docs-root arms', () => {
  test('docsGroups drops the docs/arch sections when no docs root exists', async () => {
    const { docsGroups, getDocsManifest } = await import('@docs/manifest.js')
    const groups = docsGroups()

    expect(getDocsManifest().roots.length).toBe(3)
    expect(groups.some((g) => g.path === 'group/docs')).toBe(false)
    expect(groups.some((g) => g.path === 'group/architecture')).toBe(false)
    expect(groups.some((g) => g.path === 'group/source')).toBe(true)
    expect(groups.some((g) => g.path === 'group/reports')).toBe(true)
  })

  test('_scenePath falls back to the raw root when no group owns it', async () => {
    const { ViewDocs } = await import('@docs/Docs.js')
    const view = new ViewDocs()

    document.body.appendChild(view)
    await new Promise((r) => setTimeout(r, 40))

    // 'misc' is a root of an unclaimed kind — no group child matches it
    // or prefixes it → the `?? path` miss arm.
    expect(view._scenePath('misc')).toBe('misc')

    view.remove()
  })
})
