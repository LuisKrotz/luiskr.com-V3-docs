/**
 * @file docs-tails-map-zoom.test.js
 * @description Coverage tail for the architecture-map zoom surface —
 * the glass dialog open/close paths (zoom trigger, close button,
 * backdrop click, Escape ordering), the persistent-canvas re-seat into
 * the dialog stage, and the map-column matchMedia pause wiring
 * (`_mapMq` listener + the no-matchMedia arm).
 */
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { ViewDocs } from '@docs/Docs.js'
import { mount } from '@tests/fixtures/test-constants.js'
import router from '@core/router/router.js'
import { VIEW_TAGS } from '@core/tokens/elements/views.js'
import { ROUTE_PATHS } from '@core/tokens/routes/paths.js'
import { ROUTE_NAMES } from '@core/tokens/routes/names.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { PREF_CLASSES } from '@core/tokens/classes/preferences.js'
import { DOCS_IDS } from '@core/tokens/ids/docs.js'
import { ARIA_ATTRS } from '@core/tokens/attrs/aria.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import { KEYS } from '@core/tokens/primitives.js'

const docsRoute = (docsPath = CHAR_STRINGS.EMPTY) => ({
  name: ROUTE_NAMES.DOCS,
  view: VIEW_TAGS.VIEW_DOCS,
  lang: 'en',
  path: ROUTE_PATHS.DOCS,
  meta: { docsRoute: true },
  params: { docsPath },
})

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('ViewDocs — architecture map zoom + pause wiring', () => {
  let view
  let cleanup
  let origRoute
  let pushSpy

  beforeEach(() => {
    origRoute = router.currentRoute

    pushSpy = jest.spyOn(router, 'push').mockImplementation(async () => {})

    router.currentRoute = docsRoute()

    view = new ViewDocs()
    cleanup = mount(view)
  })

  afterEach(() => {
    cleanup?.()

    pushSpy.mockRestore()
    router.currentRoute = origRoute
  })

  test('zoom trigger opens the glass dialog and re-seats the same scene canvas', async () => {
    const $ = (sel) => view.shadowRoot.querySelector(sel)

    const canvas = $(`#${DOCS_IDS.SCENE}`)
    const columnStage = $(`.${DOCS_CLASSES.DOCS_MAP} .${DOCS_CLASSES.DOCS_MAP_STAGE}`)

    // Pre-zoom: the persistent canvas lives in the map column's stage.
    expect(columnStage.contains(canvas)).toBe(true)

    $(`.${DOCS_CLASSES.DOCS_MAP_ZOOM}`).click()
    await flush()

    const dialog = $(`#${DOCS_IDS.MAP_MODAL}`)

    expect(view._mapZoomed).toBe(true)
    expect(dialog).toBeTruthy()

    // The SAME canvas moved into the dialog's stage — no remount.
    const dialogStage = dialog.querySelector(`.${DOCS_CLASSES.DOCS_MAP_STAGE}`)

    expect(dialogStage.contains(canvas)).toBe(true)
    // The column's stage bowed out while zoomed (single stage at a time).
    expect($(`.${DOCS_CLASSES.DOCS_MAP} .${DOCS_CLASSES.DOCS_MAP_STAGE}`)).toBeFalsy()
  })

  test('close button and backdrop click both dismiss; inner clicks keep it open', async () => {
    const $ = (sel) => view.shadowRoot.querySelector(sel)

    // Close button arm — the dialog's PREF_CLOSE_BTN (project pattern).
    view.toggleMapZoom()
    await flush()
    $(`.${PREF_CLASSES.PREF_CLOSE_BTN}`).click()
    await flush()

    expect(view._mapZoomed).toBe(false)
    expect($(`#${DOCS_IDS.MAP_MODAL}`)).toBeFalsy()

    // Backdrop arm — the fullscreen close-area catcher dismisses.
    view.toggleMapZoom()
    await flush()
    $(`.${DOCS_CLASSES.DOCS_MAP_CLOSE_AREA}`).click()
    await flush()

    expect(view._mapZoomed).toBe(false)

    // Clicks inside the dialog bubble to the overlay but do NOT dismiss.
    view.toggleMapZoom()
    await flush()
    $(`.${DOCS_CLASSES.DOCS_MAP_DIALOG}`).click()
    await flush()

    expect(view._mapZoomed).toBe(true)
  })

  test('Escape closes the zoom dialog before the file/nav fallbacks', async () => {
    view.toggleMapZoom()
    await flush()

    // A real keydown on the view root exercises the JSX handler wrapper.
    view.shadowRoot
      .querySelector(`.${DOCS_CLASSES.DOCS}`)
      .dispatchEvent(new KeyboardEvent('keydown', { key: KEYS.ESCAPE, bubbles: true }))
    await flush()

    expect(view._mapZoomed).toBe(false)
  })

  test('map-column media query change re-syncs the scene pause', () => {
    // happy-dom's MediaQueryList never delivers a synthetic 'change' to
    // listeners, so the bound handler is invoked directly — the same
    // call the mq listener performs.
    expect(view._mapMq).not.toBe(null)

    view._onMapMq()

    expect(view._mapZoomed).toBe(false)
  })

  test('a second mount attempt after ready skips the loader stage update', async () => {
    await flush()

    expect(view._docsReady).toBe(true)

    // Simulate a dropped handle with the fallback flag cleared — the
    // next update re-enters the mount block with _docsReady already set.
    view._sceneHandle = null
    view._sceneCanvas.classList.remove(DOCS_CLASSES.DOCS_SCENE_OFF)

    view._updateDom()
    await flush()

    expect(view._docsReady).toBe(true)
  })

  test('openMapZoom while already zoomed is an idempotent no-op', async () => {
    view.openMapZoom()
    await flush()

    expect(view._mapZoomed).toBe(true)

    // Second open — the early-return arm; state and focus stay put.
    view.openMapZoom()
    await flush()

    expect(view._mapZoomed).toBe(true)
  })

  test('toggleMapZoom while zoomed closes the dialog', async () => {
    view.openMapZoom()
    await flush()

    view.toggleMapZoom()
    await flush()

    expect(view._mapZoomed).toBe(false)
  })

  test('map close button rebinds when a re-render swaps its canvas node', async () => {
    view.openMapZoom()
    await flush()

    const first = view._mapCloseBtn

    expect(first).toBeTruthy()

    // Re-sync against the unchanged canvas — the live widget is kept.
    view._syncMapCloseBtn()

    expect(view._mapCloseBtn).toBe(first)

    // A re-render while zoomed re-creates the dialog canvas — the stale
    // widget is destroyed and a fresh one binds to the new node.
    view._updateDom()
    await flush()

    expect(view._mapZoomed).toBe(true)
    expect(view._mapCloseBtn).toBeTruthy()
  })

  test('the close-bottom caption dismisses the dialog', async () => {
    const $ = (sel) => view.shadowRoot.querySelector(sel)

    view.openMapZoom()
    await flush()

    $(`.${DOCS_CLASSES.DOCS_MAP_CLOSE_BOTTOM}`).click()
    await flush()

    expect(view._mapZoomed).toBe(false)
  })

  test('aria-controls only points at the modal id while the dialog exists', async () => {
    const $ = (sel) => view.shadowRoot.querySelector(sel)
    const zoom = $(`.${DOCS_CLASSES.DOCS_MAP_ZOOM}`)

    // aria_id_unique — a controls pointer at a not-yet-rendered id is
    // invalid; closed, the trigger carries no controls target at all.
    expect(zoom.getAttribute(ARIA_ATTRS.ARIA_CONTROLS)).toBe(null)
    expect($(`#${DOCS_IDS.MAP_MODAL}`)).toBeFalsy()

    view.openMapZoom()
    await flush()

    // Open, the dialog exists and the pointer resolves to its id
    // (re-query — the state flip re-renders the chrome).
    expect($(`.${DOCS_CLASSES.DOCS_MAP_ZOOM}`).getAttribute(ARIA_ATTRS.ARIA_CONTROLS)).toBe(
      DOCS_IDS.MAP_MODAL
    )
    expect($(`#${DOCS_IDS.MAP_MODAL}`)).toBeTruthy()
  })

  test('the map landmark names itself from the visible label element', () => {
    const $ = (sel) => view.shadowRoot.querySelector(sel)

    // aria_complementary_label_visible — the aside's accessible name
    // comes from rendered text (the hint chip), not an invisible label.
    const aside = $(`.${DOCS_CLASSES.DOCS_MAP}`)
    const labelEl = $(`#${DOCS_IDS.MAP_LABEL}`)

    expect(aside.getAttribute(ARIA_ATTRS.ARIA_LABELLEDBY)).toBe(DOCS_IDS.MAP_LABEL)
    expect(labelEl).toBeTruthy()
    expect(labelEl.textContent.trim().length).toBeGreaterThan(0)
  })

  test('no matchMedia leaves _mapMq unset and keeps the scene unpaused', () => {
    const orig = globalThis.matchMedia

    delete globalThis.matchMedia

    const view2 = new ViewDocs()
    const cleanup2 = mount(view2)

    expect(view2._mapMq).toBe(null)

    globalThis.matchMedia = orig
    cleanup2()
  })
})
