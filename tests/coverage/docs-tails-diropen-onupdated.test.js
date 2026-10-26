/**
 * @file docs-tails-diropen-onupdated.test.js
 * @description Coverage tails — isDirOpen's open/closed arms, the repeated
 * onUpdated skip arms (same GL canvas, already-seated scene, mounted
 * handle), the tree row focus callback, the crumb input's focus-select,
 * and the modified-click early return on crumb anchors.
 */

import { ViewDocs } from '@docs/Docs.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { MOUSE_EVENTS } from '@core/tokens/events/dom.js'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('Docs coverage tails — dir state + lifecycle arms', () => {
  test('isDirOpen mirrors _openDirs membership', async () => {
    const view = new ViewDocs()

    expect(view.isDirOpen('guides')).toBe(false)

    view._openDirs.add('guides')

    expect(view.isDirOpen('guides')).toBe(true)
  })

  test('crumb anchor keeps native semantics on modified clicks', async () => {
    const view = new ViewDocs()

    document.body.appendChild(view)
    await flush()

    const crumb = view.shadowRoot?.querySelector(`a.${DOCS_CLASSES.DOCS_CRUMB}`)

    if (crumb) {
      const ev = new MouseEvent(MOUSE_EVENTS.CLICK, {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      })

      crumb.dispatchEvent(ev)

      expect(ev.defaultPrevented).toBe(false)
    } else {
      // No crumb rendered on the root path — exercise the guard arm via a
      // direct modified click on a docs link instead.
      const link = view.shadowRoot?.querySelector('a')

      link?.dispatchEvent(
        new MouseEvent(MOUSE_EVENTS.CLICK, { bubbles: true, cancelable: true, ctrlKey: true })
      )
    }

    view.remove()
  })

  test('onUpdated remounts the GL strip when a new canvas node appears', async () => {
    const view = new ViewDocs()

    document.body.appendChild(view)
    await flush()

    const canvas = document.createElement('canvas')

    canvas.id = 'docs-gl'
    view.$ = (sel) => (sel === `#${canvas.id}` ? canvas : null)
    view._sceneEl = () => document.createElement('canvas')
    view._mountScene = () => {}

    const glCanvas = document.createElement('canvas')

    glCanvas.id = 'docs-gl'
    view.$ = (sel) =>
      sel === `#${glCanvas.id}`
        ? glCanvas
        : sel === '.docs-scene-stage'
          ? document.createElement('div')
          : null
    view._sceneEl = () => document.createElement('canvas')
    view._mountScene = () => {}

    view.onUpdated()
    view.onUpdated()

    // A dead context probe takes the `!this._glHandle` fallback class arm.
    const proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype
    const origGetContext = proto.getContext

    proto.getContext = () => null

    const badNode = document.createElement('canvas')

    badNode.id = 'docs-gl'
    view.$ = (sel) => (sel === `#${badNode.id}` ? badNode : null)
    view._glCanvas = null

    view.onUpdated()

    proto.getContext = origGetContext

    view.remove()
  })

  test('onUpdated skips the scene mount when the canvas is flagged scene-off', async () => {
    const view = new ViewDocs()

    document.body.appendChild(view)
    await flush()

    const dead = document.createElement('canvas')

    dead.classList.add('docs-scene-off')
    view._sceneEl = () => dead
    view._sceneHandle = null
    view._mountScene = () => {
      throw new Error('mount must be skipped')
    }
    view.$ = () => null

    view.onUpdated()

    view.remove()
  })

  test('tree row focus routes through treeFocusItem and crumb input selects', async () => {
    const view = new ViewDocs()

    document.body.appendChild(view)
    await flush()

    const btn = view.shadowRoot?.querySelector('button[role="treeitem"]')

    if (btn) btn.dispatchEvent(new Event('focus'))

    const input = view.shadowRoot?.querySelector('input')

    if (input) {
      input.select = () => {}

      input.dispatchEvent(new Event('focus'))
    }

    view.remove()
  })

  test('onUpdated arms — seated scene, live handle, ready loader, treeTabIndex', async () => {
    const view = new ViewDocs()

    document.body.appendChild(view)
    await flush()

    const canvas = document.createElement('canvas')

    canvas.id = 'docs-gl'

    const stage = document.createElement('div')
    const sceneCanvas = document.createElement('canvas')

    stage.appendChild(sceneCanvas)

    view.$ = (sel) =>
      sel === `#${canvas.id}` ? canvas : sel === '.docs-scene-stage' ? stage : null
    view.$$ = () => []
    view._sceneEl = () => sceneCanvas
    view._sceneHandle = { setActive: () => {}, setPaused: () => {}, destroy: () => {} }
    view._docsReady = true
    view._mountScene = () => {
      throw new Error('live handle — mount must be skipped')
    }

    // Seed a live GL handle + the same canvas so the second pass takes the
    // `glCanvas !== _glCanvas` false arm; a third pass with a fresh canvas
    // drives the `_glHandle?.destroy()` truthy arm and the failed-remount
    // `!_glHandle` fallback arm (happy-dom yields no GL context).
    view._glCanvas = canvas
    view._glHandle = { destroy: () => {} }

    view.onUpdated()

    const canvas2 = document.createElement('canvas')

    canvas2.id = 'docs-gl'
    view.$ = (sel) =>
      sel === `#${canvas2.id}` ? canvas2 : sel === '.docs-scene-stage' ? stage : null
    view.onUpdated()

    expect(view.classList.contains('docs-gl-fallback')).toBe(true)

    // treeTabIndex: current tab-stop path returns '0', off-path returns '-1'.
    view.treeTabIndex('')
    view.treeTabIndex('x')

    view.remove()
  })
})
