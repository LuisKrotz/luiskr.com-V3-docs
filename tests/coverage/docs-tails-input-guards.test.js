/**
 * @file docs-tails-input-guards.test.js
 * @description Coverage tails for the docs portal's non-plain input guards —
 * modified clicks on tree rows, grid cards, breadcrumb links and in-payload
 * /docs anchors keep native <a href> semantics (early return, no
 * preventDefault, no router push); Space on a tree row reroutes keyboard
 * activation through the row's click handler.
 */
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { ViewDocs } from '@docs/Docs.js'
import { mount } from '@tests/fixtures/test-constants.js'
import router from '@core/router/router.js'
import { VIEW_TAGS } from '@core/tokens/elements/views.js'
import { ROUTE_PATHS } from '@core/tokens/routes/paths.js'
import { ROUTE_NAMES } from '@core/tokens/routes/names.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { DOCS_SELECTORS } from '@core/tokens/selectors/docs.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import { KEYBOARD_EVENTS, MOUSE_EVENTS } from '@core/tokens/events/dom.js'
import { KEYS } from '@core/tokens/primitives.js'

const docsRoute = (docsPath = '') => ({
  name: ROUTE_NAMES.DOCS,
  view: VIEW_TAGS.VIEW_DOCS,
  lang: 'en',
  path: `${ROUTE_PATHS.DOCS}${docsPath ? `/${docsPath}` : ''}`,
  meta: { docsRoute: true },
  params: { docsPath },
})

const ctrlClick = () =>
  new MouseEvent(MOUSE_EVENTS.CLICK, { bubbles: true, cancelable: true, ctrlKey: true })

describe('Docs input guards — non-plain activations keep native semantics', () => {
  let view
  let cleanup
  let pushSpy
  let origRoute
  let origFetch
  let pushed

  const flush = () => new Promise((r) => setTimeout(r, 0))

  beforeEach(() => {
    origRoute = router.currentRoute
    origFetch = globalThis.fetch
    pushed = []

    pushSpy = jest.spyOn(router, 'push').mockImplementation(async (p) => {
      pushed.push(p)

      const docsPath =
        p === ROUTE_PATHS.DOCS ? CHAR_STRINGS.EMPTY : p.slice(ROUTE_PATHS.DOCS.length + 1)

      view?.onRouteParamChange({ params: { docsPath } })
    })

    router.currentRoute = docsRoute()

    view = new ViewDocs()
    cleanup = mount(view)
  })

  afterEach(() => {
    cleanup?.()

    pushSpy.mockRestore()

    router.currentRoute = origRoute
    globalThis.fetch = origFetch
  })

  test('modified clicks on tree, grid and crumb anchors bail before preventDefault', async () => {
    const $ = (sel) => view.shadowRoot.querySelectorAll(sel)

    for (const anchor of [
      $(`.${DOCS_CLASSES.DOCS_TREE_ITEM}`)[0],
      $(`.${DOCS_CLASSES.DOCS_CARD}`)[0],
      $(`.${DOCS_CLASSES.DOCS_CRUMB}`)[0],
    ]) {
      const ev = ctrlClick()

      anchor.dispatchEvent(ev)

      expect(ev.defaultPrevented).toBe(false)
    }

    // The path crumb only renders once the viewer sits inside a dir.
    view.pickNode(view.rootsAsNodes()[0])
    await flush()

    const pathCrumb = $(`.${DOCS_CLASSES.DOCS_CRUMB}`)[1]

    expect(pathCrumb).toBeTruthy()

    pushSpy.mockClear()
    pushed.length = 0

    const ev = ctrlClick()

    pathCrumb.dispatchEvent(ev)

    expect(ev.defaultPrevented).toBe(false)
    expect(pushSpy).not.toHaveBeenCalled()
  })

  test('modified click on a painted payload /docs anchor passes through', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        name: 'website.md',
        path: 'docs/architecture/website.md',
        format: 'markdown',
        html: `<article><a href="${ROUTE_PATHS.DOCS}/docs/architecture">back</a></article>`,
        media: null,
        mtime: '2024-06-01T12:00:00.000Z',
      }),
    }))

    view.onRouteParamChange({ params: { docsPath: 'docs/architecture/website.md' } })
    await flush()
    await flush()

    const anchor = view.shadowRoot.querySelector(
      `${DOCS_SELECTORS.CONTENT} ${DOCS_SELECTORS.CONTENT_LINK}`
    )

    expect(anchor).toBeTruthy()

    const ev = ctrlClick()

    anchor.dispatchEvent(ev)

    expect(ev.defaultPrevented).toBe(false)
  })

  test('Space on a tree row reroutes keyboard activation to the row click', async () => {
    const item = view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS_TREE_ITEM}`)
    const clickSpy = jest.spyOn(item, 'click')

    const ev = new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, {
      key: KEYS.SPACE,
      bubbles: true,
      cancelable: true,
    })

    item.dispatchEvent(ev)

    expect(ev.defaultPrevented).toBe(true)
    expect(clickSpy).toHaveBeenCalled()

    clickSpy.mockRestore()
  })
})
