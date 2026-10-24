/**
 * @file docs-tails-generated-folder-artwork.test.js
 * @description Covers the tree icon pack as used by BOTH nav surfaces:
 * the grid cards render the same `treeIcon` glyphs as the treeview —
 * deterministic per-name artwork (seeded paper fan/SMIL phase), open
 * vs closed folder faces, and per-kind file silhouettes.
 */
import { describe, test, expect } from '@jest/globals'
import { treeIcon } from '@docs/tree-icon.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'

const ICON = `.${DOCS_CLASSES.DOCS_TREE_ICON}`
const PAPER = `.${DOCS_CLASSES.DOCS_TREE_PAPER}`
const BODY = `.${DOCS_CLASSES.DOCS_TREE_ICON}-body`
const FLAP = `.${DOCS_CLASSES.DOCS_TREE_ICON}-flap`
const FACE = `.${DOCS_CLASSES.DOCS_TREE_ICON}-face`

const dir = (name, children = []) => ({ type: 'dir', name, path: `docs/${name}`, children })

describe('generated folder artwork', () => {
  test('dir glyph draws the wireframe folder silhouette', () => {
    const svg = treeIcon(dir('architecture'), false)

    expect(svg.matches('svg')).toBe(true)
    expect(svg.matches(ICON)).toBe(true)
    // Reference-pack wireframe: a single body outline — no filled face.
    expect(svg.querySelector(BODY)).toBeTruthy()
    expect(svg.querySelector(FACE)).toBeFalsy()
    expect(svg.querySelector(FLAP)).toBeFalsy()
  })

  test('open dir swaps the closed body for plate + swung-open flap', () => {
    const svg = treeIcon(
      dir('open', [{ type: 'file', name: 'a.md', path: 'docs/open/a.md' }]),
      true
    )

    expect(svg.querySelector(FLAP)).toBeTruthy()
    // The flap carries the one-shot swing-in animation.
    expect(svg.querySelector(`${FLAP} animateTransform`)).toBeTruthy()
    expect(svg.querySelector(FACE)).toBeFalsy()
  })

  test('the same name always produces the same artwork', () => {
    const a = treeIcon(dir('guides'), false).outerHTML
    const b = treeIcon(dir('guides'), false).outerHTML

    expect(a).toBe(b)
  })

  test('different names spread the hash space', () => {
    const children = [
      { type: 'file', name: 'a.ts', path: 'docs/x/a.ts' },
      { type: 'file', name: 'b.ts', path: 'docs/x/b.ts' },
      { type: 'file', name: 'c.ts', path: 'docs/x/c.ts' },
    ]

    const a = treeIcon(dir('docs', children), false).outerHTML
    const b = treeIcon(dir('reports', children), false).outerHTML

    expect(a).not.toBe(b)
  })

  test('file glyph resolves the kind pack, not a generic page', () => {
    const svg = treeIcon({ type: 'file', name: 'website.md', path: 'docs/website.md' }, false)

    expect(svg.matches(`${ICON}--${DOCS_CLASSES.DOCS_ICON_KINDS.MD}`)).toBe(true)
  })

  test('paper sheets scale with children for the grid cards', () => {
    const kids = ['a', 'b'].map((n) => ({ type: 'file', name: `${n}.ts`, path: `docs/m/${n}.ts` }))

    expect(treeIcon(dir('m', kids), false).querySelectorAll(PAPER).length).toBe(2)
  })
})
