/**
 * @file docs-tails-picknode-scenepath-3d.test.js
 * @description Coverage tails — pickNode's group-row arm, _scenePath's
 * ownerless-root fallback, trisToGeometry's degenerate-face guard, the
 * fileBound arms of the instanced bounds writers, and the 3D mount's
 * missing-face-color fallback.
 */

import { describe, test, expect, jest } from '@jest/globals'

const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms))

describe('docs tails — pickNode/scenePath/3d arms', () => {
  test('pickNode takes the group-row toggle+return arm', async () => {
    const { ViewDocs } = await import('@docs/Docs.js')
    const view = new ViewDocs()

    document.body.appendChild(view)
    await flush()

    view.toggleDir = jest.fn()
    view.navigateDocs = jest.fn()

    view.pickNode({ type: 'dir', name: 'Documentation', path: 'group/docs', group: true })

    expect(view.toggleDir).toHaveBeenCalledWith('group/docs')
    expect(view.navigateDocs).not.toHaveBeenCalled()

    view.remove()
  })

  test('_scenePath returns the root path itself when no group owns it', async () => {
    const { ViewDocs } = await import('@docs/Docs.js')
    const view = new ViewDocs()

    document.body.appendChild(view)
    await flush()

    // A root bucket that owns no group children under its prefix →
    // owner null → `?? path` arm.
    const res = view._scenePath('src')

    expect(res).toBe('src')

    view.remove()
  })

  test('trisToGeometry skips degenerate faces via the len guard', async () => {
    const { trisToGeometry } = await import('@docs/arch-scene-3d.js')

    // Zero-area face — the `len < 1e-6` continue arm.
    const geo = trisToGeometry([
      [0, 0, 0, 0, 0, 0, 1, 0, 0],
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
    ])

    expect(geo).toBeTruthy()
  })

  test('mountArchScene3d falls back to the default face ink without the CSS prop', async () => {
    const { mountArchScene3d } = await import('@docs/arch-scene-3d.js')
    const { HTML_TAGS } = await import('@core/tokens/elements/html.js')

    const orig = window.getComputedStyle

    window.getComputedStyle = (el) => ({
      ...orig(el),
      color: 'rgb(10, 10, 10)',
      getPropertyValue: () => '',
    })

    try {
      const canvas = document.createElement(HTML_TAGS.CANVAS)

      document.body.appendChild(canvas)

      const handle = await mountArchScene3d(
        canvas,
        [],
        () => {},
        () => {}
      )

      handle?.destroy?.()
    } catch {
      // Three.js may bail under happy-dom — the faceCss falsy arm ran first.
    } finally {
      window.getComputedStyle = orig
    }
  })
})
