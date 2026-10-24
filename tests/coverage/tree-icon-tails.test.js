/**
 * @file tree-icon-tails.test.js
 * @description Coverage tail for tree-icon.tsx — the node-shape arms the
 * portal's small fixture tree never renders: a dir with no children
 * (undefined vs empty-list arms, no sheets, no count badge), open vs
 * closed folder glyphs, and file icons for extensionless / trailing-dot
 * / extension-bearing names (the ext-hash vs name-hash seed arms).
 */
import { describe, test, expect } from '@jest/globals'
import { treeIcon } from '@docs/tree-icon.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'

const ICON = `.${DOCS_CLASSES.DOCS_TREE_ICON}`
const BODY = `.${DOCS_CLASSES.DOCS_TREE_ICON}-body`
const FLAP = `.${DOCS_CLASSES.DOCS_TREE_ICON}-flap`
const EXT = `.${DOCS_CLASSES.DOCS_TREE_ICON}-ext`
const COUNT = `.${DOCS_CLASSES.DOCS_TREE_COUNT}`

describe('treeIcon — node-shape arms', () => {
  test('a childless dir (children absent) draws the closed folder with no sheets or badge', () => {
    const svg = treeIcon({ type: 'dir', name: 'empty', path: 'docs/empty' }, false)

    expect(svg.matches('svg')).toBe(true)
    expect(svg.querySelector(BODY)).toBeTruthy()
    // No children → no sheet threads, no count badge, no open flap.
    expect(svg.querySelector(`.${DOCS_CLASSES.DOCS_FOLDER_THREAD}`)).toBeFalsy()
    expect(svg.querySelector(COUNT)).toBeFalsy()
    expect(svg.querySelector(FLAP)).toBeFalsy()
  })

  test('an empty-children dir draws the badge-free closed folder', () => {
    const svg = treeIcon({ type: 'dir', name: 'vacant', path: 'docs/vacant', children: [] }, false)

    expect(svg.querySelector(COUNT)).toBeFalsy()
  })

  test('an open dir draws the mouth plate + flap and the child-count badge', () => {
    const children = [{ type: 'file', name: 'a.md', path: 'docs/full/a.md' }]

    const svg = treeIcon({ type: 'dir', name: 'full', path: 'docs/full', children }, true)

    expect(svg.querySelector(FLAP)).toBeTruthy()

    const badge = svg.querySelector(COUNT)

    expect(badge).toBeTruthy()
    expect(badge.querySelector('text').textContent).toBe('1')
    // One child → one animated sheet line.
    expect(svg.querySelectorAll(`.${DOCS_CLASSES.DOCS_FOLDER_THREAD}`).length).toBe(1)
  })

  test('a closed dir with many children caps sheets at four and keeps the exact count', () => {
    const children = Array.from({ length: 7 }, (_, i) => ({
      type: 'file',
      name: `f${i}.ts`,
      path: `docs/many/f${i}.ts`,
    }))

    const svg = treeIcon({ type: 'dir', name: 'many', path: 'docs/many', children }, false)

    expect(svg.querySelectorAll(`.${DOCS_CLASSES.DOCS_FOLDER_THREAD}`).length).toBe(4)
    expect(svg.querySelector(COUNT).textContent).toBe('7')
  })

  test('files key their glyph off the extension tag', () => {
    const svg = treeIcon({ type: 'file', name: 'readme.md', path: 'docs/readme.md' }, false)

    expect(svg.querySelector(EXT).textContent).toBe('MD')
  })

  test('an extensionless file seeds the thread from its name and draws no ext tag', () => {
    const svg = treeIcon({ type: 'file', name: 'LICENSE', path: 'src/LICENSE' }, false)

    expect(svg.matches(ICON)).toBe(true)
    expect(svg.querySelector(EXT)).toBeFalsy()
  })

  test('a trailing-dot name resolves to the empty extension arm', () => {
    const svg = treeIcon({ type: 'file', name: 'makefile.', path: 'src/makefile.' }, false)

    expect(svg.querySelector(EXT)).toBeFalsy()
  })
})
