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

  test('an open dir draws the mouth plate + flap and papers in the folder ink', () => {
    const children = [{ type: 'file', name: 'a.md', path: 'docs/full/a.md' }]

    const svg = treeIcon({ type: 'dir', name: 'full', path: 'docs/full', children }, true)

    expect(svg.querySelector(FLAP)).toBeTruthy()
    expect(svg.querySelectorAll(PAPER).length).toBe(1)
    // The lone (front) sheet leans out with the slow bob animation —
    // plain .docs-tree-paper now, the reference pack dropped the tone fan.
    expect(svg.querySelector(`g animateTransform`)).toBeTruthy()
    expect(svg.querySelector(`.${DOCS_CLASSES.DOCS_TREE_PAPER_TONES[0]}`)).toBeFalsy()
  })

  test('a closed dir with many children caps the peeking page tops', () => {
    const children = Array.from({ length: 7 }, (_, i) => ({
      type: 'file',
      name: `f${i}.ts`,
      path: `docs/many/f${i}.ts`,
    }))

    const svg = treeIcon({ type: 'dir', name: 'many', path: 'docs/many', children }, false)

    // 7 children → capped stack (TREE_SHEET_CAP_CLOSED), still no flap.
    expect(svg.querySelectorAll(PAPER).length).toBe(3)
    expect(svg.querySelector(FLAP)).toBeFalsy()
  })

  test('an open dir caps the leaning sheets at the reference pair', () => {
    const children = Array.from({ length: 6 }, (_, i) => ({
      type: 'file',
      name: `f${i}.ts`,
      path: `docs/wide/f${i}.ts`,
    }))

    const svg = treeIcon({ type: 'dir', name: 'wide', path: 'docs/wide', children }, true)

    // 6 children → capped lean (TREE_SHEET_CAP_OPEN = 2) — the reference
    // pack's open folder shows two restrained pages, not a fan.
    expect(svg.querySelectorAll(PAPER).length).toBe(2)
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
      ['page.html', KINDS.HTML],
      ['index.html', KINDS.WEB],
      ['snake.py', KINDS.PY],
      ['widget.tsx', KINDS.ATOM],
      ['comp.jsx', KINDS.ATOM],
      ['lib.rs', KINDS.RS],
      ['main.go', KINDS.GO],
      ['Main.java', KINDS.JAVA],
      ['mod.cpp', KINDS.CPP],
      ['Mod.cs', KINDS.CS],
      ['entry.php', KINDS.PHP],
      ['gem.rb', KINDS.RB],
      ['q.sql', KINDS.SQL],
      ['feed.xml', KINDS.XML],
      ['README.md', KINDS.MD],
      ['cover.png', KINDS.IMG],
      ['shot.jpg', KINDS.PHOTO],
      ['scan.jpeg', KINDS.PHOTO],
      ['loop.gif', KINDS.GIF],
      ['icon.svg', KINDS.VEC],
      ['ci.yml', KINDS.YML],
      ['app.toml', KINDS.CONF],
      ['yarn.lock', KINDS.LOCK],
      ['inter.woff2', KINDS.FONT],
      ['engine.wasm', KINDS.WASM],
      ['pack.zip', KINDS.ARCHIVE],
      ['deploy.sh', KINDS.SHELL],
      ['setup.exe', KINDS.EXE],
      ['vol.dmg', KINDS.DMG],
      ['clip.webm', KINDS.VIDEO],
      ['clip.mov', KINDS.CAM],
      ['song.mp3', KINDS.NOTE],
      ['theme.wav', KINDS.AUDIO],
      ['lib.tar.gz', KINDS.CRATE],
      ['dist.tgz', KINDS.CRATE],
      ['notes.txt', KINDS.TXT],
      ['paper.pdf', KINDS.PDF],
      ['letter.docx', KINDS.DOCX],
      ['book.xlsx', KINDS.XLSX],
      ['deck.pptx', KINDS.PPT],
      ['table.csv', KINDS.CSV],
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
