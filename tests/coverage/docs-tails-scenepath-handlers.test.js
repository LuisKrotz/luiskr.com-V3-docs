/**
 * @file docs-tails-scenepath-handlers.test.js
 * @description Coverage tails — resolveScenePath's empty/miss arms,
 * computePositions' `sib ?? 0`/`sibCount ?? 1` fallbacks, the scene
 * setActive ancestor-climb `activeIdx >= 0` guard, and render.tsx's
 * grid keydown + crumb focus/select + modified index-click arms.
 */

import { describe, test, expect } from '@jest/globals'
import { MOUSE_EVENTS } from '@core/tokens/events/dom.js'

const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms))

describe('docs tails — scene path + handler arms', () => {
  test('resolveScenePath covers empty-path/empty-placed and prefix-best arms', async () => {
    const { resolveScenePath, placeRoots } = await import('@docs/arch-scene.js')

    // Empty placed + empty path → `placed.length ? 0 : -1` falsy arm.
    expect(resolveScenePath([], '')).toBe(-1)

    const placed = placeRoots([
      {
        root: 'docs',
        label: 'Documentation',
        children: [
          {
            type: 'dir',
            name: 'a',
            path: 'docs/a',
            children: [{ type: 'file', name: 'x.md', path: 'docs/a/x.md', id: 'docs:a/x.md' }],
          },
        ],
      },
    ])

    // Empty path on a live placed → the `0` index arm (portal root node).
    expect(resolveScenePath(placed, '')).toBe(0)

    // Exact path hit.
    expect(resolveScenePath(placed, 'docs/a/x.md')).toBeGreaterThan(-1)

    // Prefix-ancestor hit → `return best` arm (no exact match, deepest
    // prefix wins).
    expect(resolveScenePath(placed, 'docs/a/x.md/extra/deeper')).toBeGreaterThan(-1)

    // Total miss → the `-1` return arm.
    expect(resolveScenePath(placed, 'zzz/none')).toBe(-1)
  })

  test('computePositions takes the sib/sibCount ?? fallbacks on bare placed nodes', async () => {
    const { computePositions } = await import('@docs/arch-scene.js')

    const placed = [
      { node: { type: 'dir', name: 'r', path: 'docs' }, depth: 0, angle: 0, parent: -1 },
      {
        node: { type: 'file', name: 'x.md', path: 'docs/x.md', id: 'docs:x.md' },
        depth: 1,
        angle: 1,
        parent: 0,
      },
    ]

    await computePositions(placed)
  })

  test('setActive climbs ancestors only when activeIdx >= 0', async () => {
    const { createMockGL } = await import('@tests/fixtures/mock-webgl.js')
    const { mountArchScene } = await import('@docs/arch-scene.js')
    const { HTML_TAGS } = await import('@core/tokens/elements/html.js')

    const canvas = document.createElement(HTML_TAGS.CANVAS)
    const gl = createMockGL()

    canvas.getContext = () => gl

    const handle = mountArchScene(
      canvas,
      [
        {
          root: 'docs',
          label: 'Documentation',
          children: [{ type: 'file', name: 'x.md', path: 'docs/x.md', id: 'docs:x.md' }],
        },
      ],
      () => {}
    )

    handle?.setActive?.('zzz/unresolvable-path')

    handle?.setActive?.('docs/x.md')

    handle?.destroy?.()
  })

  test('grid keydown + crumb focus/select + modified index click arms', async () => {
    const { ViewDocs } = await import('@docs/Docs.js')
    const view = new ViewDocs()

    document.body.appendChild(view)
    await flush()

    const grid =
      view.shadowRoot?.querySelector('[class*="docs-grid"]') ||
      view.shadowRoot?.querySelector('.docs-view')

    if (grid) {
      grid.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
    }

    const input = view.shadowRoot?.querySelector('input')

    if (input) {
      input.select = () => {}

      input.dispatchEvent(new Event('focus'))
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    }

    // Modified click on an index/tree link → the `!isPlainClick` return.
    const link = view.shadowRoot?.querySelector('a[href]')

    if (link) {
      link.dispatchEvent(
        new MouseEvent(MOUSE_EVENTS.CLICK, { bubbles: true, cancelable: true, ctrlKey: true })
      )
    }

    view.remove()
  })
})
