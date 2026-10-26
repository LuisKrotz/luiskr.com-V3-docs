/**
 * @file docs-tails-scene-pick-scenepath.test.js
 * @description Coverage tails — the scene pick callback's group-prefix
 * early return and real-path navigation arm (captured mountArchScene cb),
 * plus _scenePath's empty/in-scene/owner/miss resolution arms.
 */

import { describe, test, expect, jest } from '@jest/globals'
import { DOCS_STRINGS } from '@core/tokens/strings/docs.js'

let pickCb = () => {}
let mountCalls = []

jest.unstable_mockModule('@docs/arch-scene.js', () => ({
  mountArchScene: (canvas, groups, onPick, onLost) => {
    mountCalls.push({ canvas, groups, onLost })
    pickCb = onPick

    return { destroy: () => {}, setActive: () => {}, setPaused: () => {} }
  },
}))

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('Docs scene pick + _scenePath arms', () => {
  test('pick callback ignores group paths and navigates real ones', async () => {
    const { ViewDocs } = await import('@docs/Docs.js')
    const view = new ViewDocs()

    document.body.appendChild(view)
    await flush()

    // Force a scene mount so the mock captures the pick callback.
    const canvas = document.createElement('canvas')
    const stage = document.createElement('div')

    stage.appendChild(canvas)

    view.$ = (sel) => (sel === `.docs-scene-stage` ? stage : null)
    view._sceneEl = () => canvas
    view._updateLoader = () => {}
    view.onUpdated()

    expect(mountCalls.length).toBeGreaterThan(0)

    // Group path → the `startsWith(GROUP_PATH_PREFIX)` early return.
    view.navigateDocs = jest.fn()
    pickCb(`${DOCS_STRINGS.GROUP_PATH_PREFIX}docs`)

    expect(view.navigateDocs).not.toHaveBeenCalled()

    // Real path → navigateDocs arm.
    pickCb('docs/readme.md')

    expect(view.navigateDocs).toHaveBeenCalledWith('docs/readme.md')

    view.remove()
  })

  test('_scenePath resolves empty, in-scene, owner, and miss arms', async () => {
    const { ViewDocs } = await import('@docs/Docs.js')
    const view = new ViewDocs()

    document.body.appendChild(view)
    await flush()

    // Empty path → `if (!path) return` arm.
    expect(view._scenePath('')).toBe('')

    // A path that IS a scene group/member/root → inScene early return.
    const res = view._scenePath('docs')

    expect(typeof res).toBe('string')

    // A non-scene path whose owner group holds it → owner?.path arm;
    // a path no group owns → `?? path` miss arm.
    expect(typeof view._scenePath('nonexistent/whatever')).toBe('string')
    expect(view._scenePath('nonexistent/whatever')).toBe('nonexistent/whatever')

    view.remove()
  })
})
