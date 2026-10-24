/**
 * @file tree-icon-tails.test.js
 * @description Coverage tail for tree-icon.tsx — the node-shape arms the
 * portal's small fixture tree never renders: a dir with no children
 * (undefined vs empty-list arms, no paper sheets), open vs closed
 * folder glyphs, and the file icon pack's kind resolution (ext map,
 * test/spec compounds, bare-name specials, extensionless and
 * trailing-dot names, unknown extensions → the doc fallback).
 */
import { describe, test, expect } from '@jest/globals'
import { treeIcon } from '@docs/tree-icon.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'

const BODY = `.${DOCS_CLASSES.DOCS_TREE_ICON}-body`
const FLAP = `.${DOCS_CLASSES.DOCS_TREE_ICON}-flap`
const PAPER = `.${DOCS_CLASSES.DOCS_TREE_PAPER}`
const KINDS = DOCS_CLASSES.DOCS_ICON_KINDS

const kindSel = (kind) => `.${DOCS_CLASSES.DOCS_TREE_ICON}--${kind}`

describe('treeIcon — node-shape arms', () => {
  test('a childless dir (children absent) draws the closed folder with no papers', () => {
    const svg = treeIcon({ type: 'dir', name: 'empty', path: 'docs/empty' }, false)

    expect(svg.matches('svg')).toBe(true)
    expect(svg.querySelector(BODY)).toBeTruthy()
    // No children → no paper sheets, no open flap.
    expect(svg.querySelectorAll(PAPER).length).toBe(0)
    expect(svg.querySelector(FLAP)).toBeFalsy()
  })

  test('an empty-children dir draws the paper-free closed folder', () => {
    const svg = treeIcon({ type: 'dir', name: 'vacant', path: 'docs/vacant', children: [] }, false)

    expect(svg.querySelectorAll(PAPER).length).toBe(0)
  })

  test('an open dir draws the mouth plate + flap and one paper per child', () => {
    const children = [{ type: 'file', name: 'a.md', path: 'docs/full/a.md' }]

    const svg = treeIcon({ type: 'dir', name: 'full', path: 'docs/full', children }, true)

    expect(svg.querySelector(FLAP)).toBeTruthy()
    expect(svg.querySelectorAll(PAPER).length).toBe(1)
    // The lone (top) sheet carries the bob animation.
    expect(svg.querySelector(`${PAPER} animateTransform`)).toBeTruthy()
  })

  test('a closed dir with many children caps the paper stack', () => {
    const children = Array.from({ length: 7 }, (_, i) => ({
      type: 'file',
      name: `f${i}.ts`,
      path: `docs/many/f${i}.ts`,
    }))

    const svg = treeIcon({ type: 'dir', name: 'many', path: 'docs/many', children }, false)

    // 7 children → capped stack (TREE_SHEET_CAP), still no flap.
    expect(svg.querySelectorAll(PAPER).length).toBe(5)
    expect(svg.querySelector(FLAP)).toBeFalsy()
  })

  test('a middling dir shows a mid-height stack', () => {
    const children = [
      { type: 'file', name: 'a.ts', path: 'docs/mid/a.ts' },
      { type: 'file', name: 'b.ts', path: 'docs/mid/b.ts' },
      { type: 'file', name: 'c.ts', path: 'docs/mid/c.ts' },
    ]

    const svg = treeIcon({ type: 'dir', name: 'mid', path: 'docs/mid', children }, false)

    expect(svg.querySelectorAll(PAPER).length).toBe(3)
  })

  test('every file kind resolves its own authored glyph class', () => {
    const cases = [
      ['app.ts', KINDS.TS],
      ['app.test.ts', KINDS.TEST],
      ['a.spec.js', KINDS.TEST],
      ['run.mjs', KINDS.JS],
      ['site.json', KINDS.JSON],
      ['theme.scss', KINDS.SASS],
      ['base.css', KINDS.CSS],
      ['index.html', KINDS.HTML],
      ['README.md', KINDS.MD],
      ['cover.png', KINDS.IMG],
      ['icon.svg', KINDS.VEC],
      ['ci.yml', KINDS.YML],
      ['app.toml', KINDS.CONF],
      ['yarn.lock', KINDS.LOCK],
      ['inter.woff2', KINDS.FONT],
      ['engine.wasm', KINDS.WASM],
      ['pack.zip', KINDS.ARCHIVE],
      ['deploy.sh', KINDS.SHELL],
      ['clip.webm', KINDS.VIDEO],
      ['theme.mp3', KINDS.AUDIO],
      ['LICENSE', KINDS.CERT],
      ['Makefile', KINDS.CONF],
      ['CHANGELOG', KINDS.MD],
      ['data.xyz', KINDS.DOC],
      ['LICENSE.foo', KINDS.CERT],
    ]

    for (const [name, kind] of cases) {
      const svg = treeIcon({ type: 'file', name, path: `docs/${name}` }, false)

      expect(svg.matches(kindSel(kind))).toBe(true)
    }
  })

  test('a leading-dot name (hidden file) resolves to the doc fallback', () => {
    // '.gitignore' → bare stem is empty (the || EMPTY arm), ext unknown.
    const svg = treeIcon({ type: 'file', name: '.gitignore', path: 'docs/.gitignore' }, false)

    expect(svg.matches(kindSel(KINDS.DOC))).toBe(true)
  })

  test('an extensionless file draws the doc fallback glyph', () => {
    const svg = treeIcon({ type: 'file', name: 'plainfile', path: 'docs/plainfile' }, false)

    expect(svg.matches(kindSel(KINDS.DOC))).toBe(true)
  })

  test('a trailing-dot name resolves to the doc fallback', () => {
    const svg = treeIcon({ type: 'file', name: 'plainfile.', path: 'docs/plainfile.' }, false)

    expect(svg.matches(kindSel(KINDS.DOC))).toBe(true)
  })

  test('names colliding with Object prototype keys still resolve safely', () => {
    // `constructor.xyz`/`toString` used to leak inherited props into the
    // kind lookup — they must fall through to the authored doc glyph.
    for (const name of ['constructor.xyz', 'toString', 'hasOwnProperty.js']) {
      const svg = treeIcon({ type: 'file', name, path: `docs/${name}` }, false)

      expect(svg.matches('svg')).toBe(true)
    }

    expect(
      treeIcon({ type: 'file', name: 'constructor.xyz', path: 'docs/c' }, false).matches(
        kindSel(KINDS.DOC)
      )
    ).toBe(true)

    expect(
      treeIcon({ type: 'file', name: 'hasOwnProperty.js', path: 'docs/h' }, false).matches(
        kindSel(KINDS.JS)
      )
    ).toBe(true)
  })
})
