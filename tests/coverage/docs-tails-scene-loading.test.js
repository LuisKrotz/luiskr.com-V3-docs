/**
 * @file docs-tails-scene-loading.test.js
 * @description Coverage tails for the map-stage loading veil — the
 * veil's render gate in both stage hosts, the onReady dismissal
 * (flag off + opacity → remove), the onLost/sync-failure dismissal,
 * and the context-restore re-arm (`_sceneLoading` flip → _updateDom
 * reproduces the veil). `@docs/arch-scene.js` is module-mocked so the
 * mount callbacks are captured without a real GPU.
 */

import { describe, test, expect, jest } from '@jest/globals'
import { mount } from '@tests/fixtures/test-constants.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { DOCS_SELECTORS } from '@core/tokens/selectors/docs.js'
import { DOCS_IDS } from '@core/tokens/ids/docs.js'
import { DOCS_STRINGS } from '@core/tokens/strings/docs.js'
import { GL_EVENTS } from '@core/tokens/events/dom.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import { ANIMATION_DURATIONS } from '@core/tokens/motion/animation.js'

let readyCb = null
let lostCb = null
let mountReturn = null

jest.unstable_mockModule('@docs/arch-scene.js', () => ({
  mountArchScene: (canvas, groups, onPick, onLost, onReady) => {
    lostCb = onLost
    readyCb = onReady

    return mountReturn
  },
}))

const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms))

const liveHandle = () => ({
  destroy: jest.fn(),
  setActive: jest.fn(),
  setPaused: jest.fn(),
  resize: jest.fn(),
})

const veilOf = (view) => view.shadowRoot.querySelector(DOCS_SELECTORS.MAP_LOADING)

describe('ViewDocs — map-stage loading veil', () => {
  test('veil renders while the graph builds; onReady fades + removes it', async () => {
    mountReturn = liveHandle()

    const { ViewDocs } = await import('@docs/Docs.js')
    const view = new ViewDocs()

    const cleanup = mount(view)

    await flush()

    // Building state — the veil sits inside the column stage and the
    // flag drives the render gate on both stage hosts.
    expect(veilOf(view)).toBeTruthy()
    expect(view._sceneLoading).toBe(true)
    expect(veilOf(view).textContent).toContain(DOCS_STRINGS.MAP_LOADING)

    // The zoom dialog's stage emits the same veil while still loading —
    // the re-render re-creates the node, so the live veil is re-queried.
    view.openMapZoom()
    await flush()

    const dialog = view.shadowRoot.querySelector(`#${DOCS_IDS.MAP_MODAL}`)

    const veil = dialog.querySelector(DOCS_SELECTORS.MAP_LOADING)

    expect(veil).toBeTruthy()

    readyCb()

    expect(view._sceneLoading).toBe(false)
    expect(veil.style.opacity).toBe(CHAR_STRINGS.ZERO)

    await flush(ANIMATION_DURATIONS.LOADER_FADE_MS + 20)

    expect(veilOf(view)).toBeFalsy()

    // Second dismissal on an absent veil takes the `!veil` early return.
    view._dismissSceneLoading()

    cleanup()
  })

  test('onLost parks the canvas and dismisses the veil', async () => {
    mountReturn = liveHandle()

    const { ViewDocs } = await import('@docs/Docs.js')
    const view = new ViewDocs()

    const cleanup = mount(view)

    await flush()

    const canvas = view.shadowRoot.querySelector(`#${DOCS_IDS.SCENE}`)

    lostCb()

    expect(view._sceneLoading).toBe(false)
    expect(canvas.classList.contains(DOCS_CLASSES.DOCS_SCENE_OFF)).toBe(true)

    cleanup()
  })

  test('a synchronous null mount drops the veil without a callback', async () => {
    mountReturn = null

    const { ViewDocs } = await import('@docs/Docs.js')
    const view = new ViewDocs()

    const cleanup = mount(view)

    await flush()

    expect(view._sceneLoading).toBe(false)
    expect(veilOf(view).style.opacity).toBe(CHAR_STRINGS.ZERO)

    await flush(ANIMATION_DURATIONS.LOADER_FADE_MS + 20)

    expect(veilOf(view)).toBeFalsy()

    cleanup()
  })

  test('context restore re-arms the veil via _updateDom', async () => {
    mountReturn = liveHandle()

    const { ViewDocs } = await import('@docs/Docs.js')
    const view = new ViewDocs()

    const cleanup = mount(view)

    await flush()

    // Settle the first build — veil gone, flag off.
    readyCb()
    await flush()

    const canvas = view.shadowRoot.querySelector(`#${DOCS_IDS.SCENE}`)

    canvas.classList.add(DOCS_CLASSES.DOCS_SCENE_OFF)
    canvas.dispatchEvent(new Event(GL_EVENTS.WEBGL_CONTEXT_RESTORED))
    await flush()

    // The remount flipped the flag back on and the re-render reproduced
    // the veil inside the stage.
    expect(view._sceneLoading).toBe(true)
    expect(veilOf(view)).toBeTruthy()

    readyCb()
    await flush()

    expect(view._sceneLoading).toBe(false)

    cleanup()
  })
})
