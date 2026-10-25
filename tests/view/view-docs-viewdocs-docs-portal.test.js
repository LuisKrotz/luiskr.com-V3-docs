/**
 * @file view-docs-viewdocs-docs-portal.test.js
 * @description Split from view-docs.test.js — covers the "ViewDocs — docs portal" describe.
 */
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { ViewDocs } from '@docs/Docs.js'
import { mount } from '@tests/fixtures/test-constants.js'
import router from '@core/router/router.js'
import { VIEW_TAGS } from '@core/tokens/elements/views.js'
import { ROUTE_PATHS } from '@core/tokens/routes/paths.js'
import { ROUTE_NAMES } from '@core/tokens/routes/names.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { DOCS_IDS } from '@core/tokens/ids/docs.js'
import { DOCS_STRINGS } from '@core/tokens/strings/docs.js'
import { DOCS_SELECTORS } from '@core/tokens/selectors/docs.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import { SCHEMA_STRINGS } from '@core/tokens/strings/schema.js'
import { DATA_ATTRS } from '@core/tokens/attrs/data.js'
import { CLIPBOARD_EVENTS, KEYBOARD_EVENTS, MOUSE_EVENTS } from '@core/tokens/events/dom.js'
import { KEYS } from '@core/tokens/primitives.js'
import { SOCIAL_URLS } from '@core/tokens/media/urls.js'

const makePayload = (over = {}) => ({
  name: 'website.md',
  path: 'docs/architecture/website.md',
  format: 'markdown',
  html: '<article><h1>Website</h1><p>rendered</p></article>',
  media: null,
  mtime: '2024-06-01T12:00:00.000Z',
  ...over,
})

const docsRoute = (docsPath = '') => ({
  name: ROUTE_NAMES.DOCS,
  view: VIEW_TAGS.VIEW_DOCS,
  lang: 'en',
  path: `${ROUTE_PATHS.DOCS}${docsPath ? `/${docsPath}` : ''}`,
  meta: { docsRoute: true },
  params: { docsPath },
})

describe('ViewDocs — docs portal', () => {
  let view
  let cleanup
  let pushSpy
  let origRoute
  let origFetch
  let origBeacon
  let pushed

  const flush = () => new Promise((r) => setTimeout(r, 0))

  beforeEach(() => {
    origRoute = router.currentRoute
    origFetch = globalThis.fetch
    pushed = []

    // happy-dom's navigator ships a working sendBeacon — the telemetry
    // transport prefers it over fetch, so pin a declining stub to keep
    // assertions on the fetch keepalive path.
    origBeacon = navigator.sendBeacon
    Object.defineProperty(navigator, 'sendBeacon', {
      value: () => false,
      configurable: true,
      writable: true,
    })

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
    Object.defineProperty(navigator, 'sendBeacon', {
      value: origBeacon,
      configurable: true,
      writable: true,
    })
  })

  test('registers as a custom element', () => {
    expect(customElements.get(VIEW_TAGS.VIEW_DOCS)).toBe(ViewDocs)
  })

  test('root render: title, stamp, tree, crumb input, grid, scene + legal footer', () => {
    const $ = (sel) => view.shadowRoot.querySelector(sel)

    expect($(`.${DOCS_CLASSES.DOCS_TITLE}`).textContent).toBe(DOCS_STRINGS.TITLE)
    expect($(`.${DOCS_CLASSES.DOCS_UPDATED}`).getAttribute('datetime')).toBe(
      '2024-06-01T12:00:00.000Z'
    )
    expect($(`.${DOCS_CLASSES.DOCS_TREE}`)).toBeTruthy()
    expect($(`.${DOCS_CLASSES.DOCS_CRUMB_EDIT}`)).toBeTruthy()
    expect($(`#${DOCS_IDS.GL}`)).toBeTruthy()
    expect($(`#${DOCS_IDS.SCENE}`)).toBeTruthy()
    // The portal grid sections the flat root buckets under four groups.
    expect($(`.${DOCS_CLASSES.DOCS_GRID}`).children.length).toBe(4)
    expect(view.shadowRoot.querySelector('legal-footer')).toBeFalsy()
  })

  test('all docs are linked: tree h2, card h3s + the streamed index nav', async () => {
    const $ = (sel) => view.shadowRoot.querySelector(sel)
    const $$ = (sel) => [...view.shadowRoot.querySelectorAll(sel)]

    // The index body streams in over idle slices — flush lets it land.
    await flush()

    // Tree landmark carries an sr-only h2.
    const treeHead = $(`.${DOCS_CLASSES.DOCS_NAV} h2`)

    expect(treeHead.textContent).toBe(DOCS_STRINGS.TREE_LABEL)

    // Every grid card is wrapped in a heading — on the grouped portal
    // root the group h3s own level 3, so cards emit h4s.
    const cardHeads = $$(`.${DOCS_CLASSES.DOCS_CARD_HEADING}`)

    expect(cardHeads.length).toBe(5)
    expect(cardHeads.every((hEl) => hEl.tagName === 'H4' && hEl.querySelector('a'))).toBe(true)

    // The complete index links every manifest node; only dirs carry
    // headings (the navigable map) — files mount as bare anchors.
    const index = $(`nav[aria-label="${DOCS_STRINGS.INDEX_LABEL}"]`)

    expect(index).toBeTruthy()
    expect(index.querySelector('h2').textContent).toBe(DOCS_STRINGS.INDEX_TITLE)

    // 4 group labels + 15 member/node links — all docs reachable.
    expect(index.querySelectorAll('a').length).toBe(15)

    const heads = [...index.querySelectorAll('h3, h4, h5, h6')]

    expect(heads.map((hEl) => hEl.textContent)).toEqual(
      expect.arrayContaining([
        DOCS_STRINGS.GROUP_DOCS_LABEL,
        DOCS_STRINGS.GROUP_ARCH_LABEL,
        DOCS_STRINGS.GROUP_SOURCE_LABEL,
        DOCS_STRINGS.GROUP_REPORTS_LABEL,
        'Quality Reports',
        'Source Code',
        'architecture',
        'sassdoc',
        'app',
        'sub',
      ])
    )

    // Group heads carry no link — sections are disclosure-only.
    const groupHeads = [...index.querySelectorAll('h3')]

    expect(groupHeads.every((hEl) => !hEl.querySelector('a'))).toBe(true)

    // Deep dirs sit one heading level under their parent (h5 → h6);
    // files are anchors under the preceding dir heading, not headings.
    const subHead = heads.find((hEl) => hEl.textContent === 'sub')

    expect(subHead.tagName).toBe('H6')

    const fileLink = [...index.querySelectorAll('a')].find((a) => a.textContent === 'website.md')

    expect(fileLink).toBeTruthy()
    expect(fileLink.closest('h3,h4,h5,h6')).toBeFalsy()
  })

  test('index links route through navigateDocs; modified clicks keep native semantics', async () => {
    // The index body streams in over idle slices — flush lets it land.
    await flush()

    const index = view.shadowRoot.querySelector(`nav[aria-label="${DOCS_STRINGS.INDEX_LABEL}"]`)

    const link = [...index.querySelectorAll('a')].find((a) => a.textContent === 'website.md')

    pushed.length = 0
    link.dispatchEvent(new MouseEvent(MOUSE_EVENTS.CLICK, { bubbles: true, cancelable: true }))

    expect(pushed).toContain('/docs/docs/architecture/website.md')

    // Ctrl-click is not a plain click — native new-tab semantics stay.
    pushed.length = 0
    link.dispatchEvent(
      new MouseEvent(MOUSE_EVENTS.CLICK, { bubbles: true, cancelable: true, ctrlKey: true })
    )

    expect(pushed.length).toBe(0)

    // Section-member links (the h4 bucket rows) route through the same
    // navigateDocs path.
    const bucketLink = [...index.querySelectorAll('h4 a')].find(
      (a) => a.textContent === 'Quality Reports'
    )

    pushed.length = 0
    bucketLink.dispatchEvent(
      new MouseEvent(MOUSE_EVENTS.CLICK, { bubbles: true, cancelable: true })
    )

    expect(pushed).toContain('/docs/reports')

    pushed.length = 0
    bucketLink.dispatchEvent(
      new MouseEvent(MOUSE_EVENTS.CLICK, { bubbles: true, cancelable: true, ctrlKey: true })
    )

    expect(pushed.length).toBe(0)

    // A docsPath with no manifest node falls back to the raw path as the
    // viewer heading.
    view.onRouteParamChange({ params: { docsPath: 'ghost/file.md' } })
    await flush()

    const viewerHead = view.shadowRoot.querySelector(
      `.${DOCS_CLASSES.DOCS_VIEWER_PATH}`
    )?.previousElementSibling

    expect(viewerHead.tagName).toBe('H2')
    expect(viewerHead.textContent).toBe('ghost/file.md')
  })

  test('root grid sections member cards under the four group headings', () => {
    const grid = view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS_GRID}`)
    const sections = [...grid.querySelectorAll(`.${DOCS_CLASSES.DOCS_GRID_GROUP}`)]

    // Four sections — Docs / Architecture / Source / Reports — each
    // labelled by a real h3 so heading maps enumerate the grouping.
    expect(sections.length).toBe(4)
    expect(
      [...grid.querySelectorAll(`.${DOCS_CLASSES.DOCS_GRID_GROUP_HEAD}`)].map(
        (hEl) => hEl.textContent
      )
    ).toEqual([
      DOCS_STRINGS.GROUP_DOCS_LABEL,
      DOCS_STRINGS.GROUP_ARCH_LABEL,
      DOCS_STRINGS.GROUP_SOURCE_LABEL,
      DOCS_STRINGS.GROUP_REPORTS_LABEL,
    ])
    expect(sections.every((s) => s.getAttribute('aria-label'))).toBe(true)

    const cards = grid.querySelectorAll(`.${DOCS_CLASSES.DOCS_CARD}`)

    // docs children minus architecture (2) + architecture (1) + src
    // root + reports root — the mock manifest's member surface.
    expect(cards.length).toBe(5)
    expect(cards[0].querySelector(`.${DOCS_CLASSES.DOCS_CARD_ART} svg`)).toBeTruthy()
  })

  test('GL strip falls back when canvas has no webgl context', () => {
    expect(view.classList.contains(DOCS_CLASSES.DOCS_GL_FALLBACK)).toBe(true)
  })

  test('scene canvas hidden via fallback class when webgl2 is unavailable', () => {
    const scene = view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS_SCENE}`)

    expect(scene.classList.contains(DOCS_CLASSES.DOCS_SCENE_OFF)).toBe(true)
  })

  test('pickNode on a dir expands it and navigates', async () => {
    // Source Code group → 'src' member — a real routed dir node.
    const srcRoot = view.rootsAsNodes()[2].children[0]

    view.pickNode(srcRoot)
    await flush()

    expect(pushed).toContain(`${ROUTE_PATHS.DOCS}/src`)
    expect(view.isDirOpen('src')).toBe(true)
    expect(view.node?.type).toBe('dir')
    expect(view.node?.name).toBe('Source Code')
  })

  test('section-group tree rows toggle disclosure without navigating', async () => {
    const items = [...view.shadowRoot.querySelectorAll(`.${DOCS_CLASSES.DOCS_TREE_ITEM}`)]
    const groupRows = items.filter((el) =>
      el.getAttribute(DATA_ATTRS.DATA_PATH)?.startsWith(DOCS_STRINGS.GROUP_PATH_PREFIX)
    )

    // Four section rows — disclosure-only buttons (role=treeitem), not
    // anchors: a section has no docs route to link to.
    expect(groupRows.length).toBe(4)
    expect(
      groupRows.every((el) => el.tagName === 'BUTTON' && el.getAttribute('role') === 'treeitem')
    ).toBe(true)
    expect(groupRows.every((el) => el.getAttribute('aria-expanded') === 'true')).toBe(true)

    pushed.length = 0
    groupRows[0].click()
    await flush()

    expect(pushed).toHaveLength(0)
    expect(view.isDirOpen(`${DOCS_STRINGS.GROUP_PATH_PREFIX}docs`)).toBe(false)

    // Re-query — the collapsed row re-renders with aria-expanded false.
    const collapsed = view.shadowRoot.querySelector(
      `.${DOCS_CLASSES.DOCS_TREE_ITEM}[${DATA_ATTRS.DATA_PATH}="${DOCS_STRINGS.GROUP_PATH_PREFIX}docs"]`
    )

    expect(collapsed.getAttribute('aria-expanded')).toBe('false')
  })

  test('routed member auto-opens its section row; Arrow-Left climbs to it', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, json: async () => null }))

    view.onRouteParamChange({ params: { docsPath: 'src/App.tsx' } })
    await flush()

    // 'src' sits under group/source — the section row opens with the route.
    expect(view.isDirOpen(`${DOCS_STRINGS.GROUP_PATH_PREFIX}source`)).toBe(true)

    const items = [...view.shadowRoot.querySelectorAll(`.${DOCS_CLASSES.DOCS_TREE_ITEM}`)]
    // A CLOSED member row — ← on an open dir collapses instead of climbing.
    const memberRow = items.find((el) => el.getAttribute(DATA_ATTRS.DATA_PATH) === 'reports')
    const groupRow = items.find(
      (el) => el.getAttribute(DATA_ATTRS.DATA_PATH) === `${DOCS_STRINGS.GROUP_PATH_PREFIX}reports`
    )
    const focusSpy = jest.spyOn(groupRow, 'focus')

    memberRow.dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, {
        key: KEYS.ARROW_LEFT,
        bubbles: true,
        cancelable: true,
      })
    )

    // 'reports' has no rendered path parent — the climb lands on its section row.
    expect(focusSpy).toHaveBeenCalled()

    focusSpy.mockRestore()
  })

  test('crumb input shows / at the portal root', () => {
    const input = view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS_CRUMB_EDIT}`)

    expect(input.value).toBe(CHAR_STRINGS.SLASH)
  })

  test('re-clicking an open tree dir collapses it; inside → back to parent', async () => {
    const rowFor = (path) =>
      [...view.shadowRoot.querySelectorAll(`.${DOCS_CLASSES.DOCS_TREE_ITEM}`)].find(
        (el) => el.getAttribute(DATA_ATTRS.DATA_PATH) === path
      )

    rowFor('src').click() // open + navigate into 'src'
    await flush()

    expect(view.isDirOpen('src')).toBe(true)
    expect(view.docsPath).toBe('src')

    rowFor('src').click() // re-click collapses — and leaves the folder
    await flush()

    expect(view.isDirOpen('src')).toBe(false)
    expect(pushed).toContain(ROUTE_PATHS.DOCS)
    expect(view.docsPath).toBe(CHAR_STRINGS.EMPTY)
  })

  test('re-clicking an open non-current dir collapses without navigating', async () => {
    const dir = view.rootsAsNodes()[0].children[0] // 'docs/sassdoc' member

    view.pickTreeNode(dir)
    await flush()

    expect(view.isDirOpen('docs/sassdoc')).toBe(true)

    pushed.length = 0

    // Open 'src' so the viewer sits outside the docs section —
    // collapsing it must not yank the page back.
    view.pickNode(view.rootsAsNodes()[2].children[0])
    await flush()

    view.pickTreeNode(dir)
    await flush()

    expect(view.isDirOpen('docs/sassdoc')).toBe(false)
    expect(view.docsPath).toBe('src')
  })

  test('a dir with index.html auto-opens the index (except under src)', async () => {
    view.onRouteParamChange({ params: { docsPath: 'docs/sassdoc' } })
    await flush()

    expect(pushed).toContain(`${ROUTE_PATHS.DOCS}/docs/sassdoc/index.html`)

    pushed.length = 0

    // The src root stays a browsable source tree — no index auto-open.
    view.onRouteParamChange({ params: { docsPath: 'src' } })
    await flush()

    expect(pushed.length).toBe(0)
    expect(view.node?.type).toBe('dir')
  })

  test('internal payload links reroute inside /docs; external links pass through', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () =>
        makePayload({
          html:
            '<article><p><span>plain</span><a>hrefless</a><a href="#frag">frag</a>' +
            '<a href="/docs/reports/axe-report.json">in</a>' +
            '<a href="https://example.com/x">out</a></p></article>',
        }),
    }))

    view.onRouteParamChange({ params: { docsPath: 'docs/architecture/website.md' } })
    await flush()
    await flush()

    const box = view.shadowRoot.querySelector(DOCS_SELECTORS.CONTENT)
    const [_frag, internal, external] = box.querySelectorAll(DOCS_SELECTORS.CONTENT_LINK)

    internal.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flush()

    expect(pushed).toContain(`${ROUTE_PATHS.DOCS}/reports/axe-report.json`)

    pushed.length = 0

    external.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(pushed.length).toBe(0)

    // Non-anchor target → closest() misses → early return.
    box
      .querySelector('span')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    // href-less anchor → `|| ''` + !href return.
    box
      .querySelector('a:not([href])')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    // Hash-only href → same-page fragment, left to the browser.
    _frag.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    // Non-Element event target (no closest) → optional chain falls to undefined.
    view._onContentLink({ target: {} })

    expect(pushed.length).toBe(0)
  })

  test('mermaid blocks render through the diagram engine', async () => {
    const { __diagramState } = await import('@core/utils/wasm/wasm-diagram.js')

    __diagramState.calls = 0

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () =>
        makePayload({ html: `<div class="${DOCS_CLASSES.DOCS_MERMAID}">flowchart TB</div>` }),
    }))

    view.onRouteParamChange({ params: { docsPath: 'docs/architecture/website.md' } })
    await flush()
    await flush()

    const block = view.shadowRoot.querySelector(DOCS_SELECTORS.MERMAID)

    expect(block.getAttribute('data-processed')).toBe('true')
    expect(__diagramState.calls).toBeGreaterThan(0)
  })

  test('coverage reports get istanbul keyboard nav on document keydown', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () =>
        makePayload({
          format: 'html',
          html: '<div class="coverage"><span class="cline-no">x</span><span class="cline-no">y</span></div>',
        }),
    }))

    const scrollCalls = []

    view.onRouteParamChange({ params: { docsPath: 'docs/README.md' } })
    await flush()
    await flush()

    view.shadowRoot
      .querySelectorAll('.cline-no')
      .forEach((el) => (el.scrollIntoView = () => scrollCalls.push(el.textContent)))

    document.dispatchEvent(new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: 'n' }))
    document.dispatchEvent(new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: 'n' }))
    document.dispatchEvent(new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: 'p' }))
    document.dispatchEvent(new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: 'x' }))
    // Modifier chords stay browser-owned — happy-dom ignores ctrlKey in
    // the init dict, so the flag lands via a patched own-property.
    const ctrl = new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: 'n' })

    Object.defineProperty(ctrl, 'ctrlKey', { value: true, configurable: true })

    document.dispatchEvent(ctrl)

    expect(scrollCalls).toEqual(['x', 'y', 'x'])
  })

  test('navigating into a dir renders its children in the grid', async () => {
    // Architecture section → 'docs/architecture' member (website.md only).
    view.pickNode(view.rootsAsNodes()[1].children[0])
    await flush()

    const cards = view.shadowRoot.querySelectorAll(`.${DOCS_CLASSES.DOCS_CARD}`)

    expect(cards.length).toBe(1)
  })

  test('navigating to a file fetches its payload and paints the viewer', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => makePayload() }))

    view.onRouteParamChange({ params: { docsPath: 'docs/architecture/website.md' } })
    await flush()
    await flush()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${DOCS_STRINGS.ASSET_BASE}docs/architecture/website.md${DOCS_STRINGS.ASSET_EXT}`
    )
    expect(view.filePayload?.html).toContain('Website')

    const content = view.shadowRoot.querySelector(DOCS_SELECTORS.CONTENT)

    expect(content.innerHTML).toContain('rendered')
    expect(view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS_VIEWER}`)).toBeTruthy()
  })

  test('src-root files get the protected class; docs files do not', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => makePayload({ format: 'code', path: 'src/App.tsx', name: 'App.tsx' }),
    }))

    view.onRouteParamChange({ params: { docsPath: 'src/App.tsx' } })
    await flush()
    await flush()

    const viewer = view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS_VIEWER}`)

    expect(viewer.classList.contains(DOCS_CLASSES.DOCS_PROTECTED)).toBe(true)
    expect(view.isProtectedView()).toBe(true)
  })

  test('html payloads render inline inside the viewer content', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () =>
        makePayload({ format: 'html', html: '<div class="docs-html"><p>report</p></div>' }),
    }))

    view.onRouteParamChange({ params: { docsPath: 'docs/architecture/website.md' } })
    await flush()
    await flush()

    const content = view.shadowRoot.querySelector(DOCS_SELECTORS.CONTENT)

    expect(content.querySelector('.docs-html')).toBeTruthy()
    expect(content.textContent).toContain('report')
  })

  test('media payloads render an <img>; oversized media shows the GitHub pointer', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () =>
        makePayload({ format: 'media', media: 'data:image/png;base64,x', html: null }),
    }))

    view.onRouteParamChange({ params: { docsPath: 'src/binary.png' } })
    await flush()
    await flush()

    const content = view.shadowRoot.querySelector(DOCS_SELECTORS.CONTENT)

    expect(content.querySelector('img')).toBeTruthy()

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => makePayload({ format: 'media', media: null, html: null }),
    }))

    view.onRouteParamChange({ params: { docsPath: 'src/binary.png' } })
    await flush()
    await flush()

    expect(view.shadowRoot.querySelector(DOCS_SELECTORS.CONTENT).textContent).toBe(
      DOCS_STRINGS.MEDIA_UNAVAILABLE
    )
  })

  test('failed payload fetch clears loading and leaves no viewer', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, json: async () => null }))

    view.onRouteParamChange({ params: { docsPath: 'docs/architecture/website.md' } })
    await flush()
    await flush()

    expect(view.fileLoading).toBe(false)
    expect(view.filePayload).toBe(null)
    expect(view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS_VIEWER}`)).toBeFalsy()
  })

  test('fetch throw lands on the same empty state', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('net down')
    })

    view.onRouteParamChange({ params: { docsPath: 'docs/architecture/website.md' } })
    await flush()
    await flush()

    expect(view.filePayload).toBe(null)
  })

  test('closeFile navigates to the parent folder', async () => {
    view.onRouteParamChange({ params: { docsPath: 'docs/architecture/website.md' } })

    view.closeFile()
    await flush()

    expect(pushed).toContain(`${ROUTE_PATHS.DOCS}/docs/architecture`)
  })

  test('closeFile on index.html climbs past the owning dir (two levels)', async () => {
    // The dir auto-opens its index — back from the file must land on the
    // grandparent, or the dir re-opens the same index and the button loops.
    view.onRouteParamChange({ params: { docsPath: 'docs/sassdoc/index.html' } })
    await flush()

    view.closeFile()
    await flush()

    expect(pushed).toContain(`${ROUTE_PATHS.DOCS}/docs`)
    expect(pushed).not.toContain(`${ROUTE_PATHS.DOCS}/docs/sassdoc`)

    // Under a source root index.html is a plain file — one level up.
    pushed.length = 0
    view.onRouteParamChange({ params: { docsPath: 'src/index.html' } })
    await flush()

    view.closeFile()
    await flush()

    expect(pushed).toContain(`${ROUTE_PATHS.DOCS}/src`)
  })

  test('closeFile before any path resolves climbs to the portal root', async () => {
    // node is null until a docsPath resolves — the optional chain must
    // short-circuit to a plain climb, not throw. Run synchronously after
    // mount so no store emission can re-apply a resolved route first.
    view.closeFile()
    await flush()

    expect(pushed).toContain(ROUTE_PATHS.DOCS)
  })

  test('editable breadcrumb: Enter commits the typed path, Escape restores', async () => {
    const input = view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS_CRUMB_EDIT}`)

    input.value = 'docs/architecture'
    input.blur = jest.fn()

    view.onCrumbKey({ key: KEYS.ENTER, target: input })
    await flush()

    expect(pushed).toContain(`${ROUTE_PATHS.DOCS}/docs/architecture`)
    expect(input.blur).toHaveBeenCalled()

    input.value = 'junk'

    view.onCrumbKey({ key: KEYS.ESCAPE, target: input })

    expect(input.value).toBe(`${CHAR_STRINGS.SLASH}${view.docsPath}`)
  })

  test('crumb buttons navigate to their path', async () => {
    view.onRouteParamChange({ params: { docsPath: 'docs/architecture/website.md' } })
    await flush()

    const crumbs = view.shadowRoot.querySelectorAll(`.${DOCS_CLASSES.DOCS_CRUMB}`)

    crumbs[1].click()
    await flush()

    expect(pushed).toContain(`${ROUTE_PATHS.DOCS}/docs`)
  })

  test('tree buttons expand + navigate; file buttons navigate', async () => {
    const srcRow = [...view.shadowRoot.querySelectorAll(`.${DOCS_CLASSES.DOCS_TREE_ITEM}`)].find(
      (el) => el.getAttribute(DATA_ATTRS.DATA_PATH) === 'src'
    )

    srcRow.click()
    await flush()

    expect(pushed.length).toBeGreaterThan(0)
  })

  test('grid card click navigates into the node', async () => {
    const card = [...view.shadowRoot.querySelectorAll(`.${DOCS_CLASSES.DOCS_CARD}`)].find(
      (el) => el.getAttribute(DATA_ATTRS.DATA_PATH) === 'src'
    )

    card.click()
    await flush()

    expect(pushed).toContain(`${ROUTE_PATHS.DOCS}/src`)
  })

  test('root crumb button returns to the portal root', async () => {
    view.onRouteParamChange({ params: { docsPath: 'docs/architecture' } })
    await flush()

    const crumbs = view.shadowRoot.querySelectorAll(`.${DOCS_CLASSES.DOCS_CRUMB}`)

    crumbs[0].click()
    await flush()

    expect(pushed).toContain(ROUTE_PATHS.DOCS)
    expect(view.docsPath).toBe('')
  })

  test('crumb input handles real keydown + focus events', async () => {
    const input = view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS_CRUMB_EDIT}`)

    input.value = 'reports'
    input.blur = jest.fn()
    input.select = jest.fn()

    input.dispatchEvent(new Event('focus', { bubbles: false }))
    expect(input.select).toHaveBeenCalled()

    input.dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ENTER, bubbles: true })
    )
    await flush()

    expect(pushed).toContain(`${ROUTE_PATHS.DOCS}/reports`)
  })

  test('viewer back button returns to the parent folder', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => makePayload() }))

    view.onRouteParamChange({ params: { docsPath: 'docs/architecture/website.md' } })
    await flush()
    await flush()

    const back = view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS_VIEWER_BACK}`)

    back.click()
    await flush()

    expect(pushed).toContain(`${ROUTE_PATHS.DOCS}/docs/architecture`)
  })

  test('pickNode on a file navigates without touching the open-set', () => {
    const file = { type: 'file', name: 'README.md', path: 'docs/README.md', id: 'docs:README.md' }

    view.pickNode(file)

    expect(view._openDirs.has('docs/README.md')).toBe(false)
  })

  test('onCrumbKey ignores keys that are neither Enter nor Escape', () => {
    const input = view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS_CRUMB_EDIT}`)

    input.value = 'typed'

    view.onCrumbKey({ key: 'x', target: input })

    expect(input.value).toBe('typed')
    expect(pushed.length).toBe(0)
  })

  test('a dir node without children renders the empty grid arm', async () => {
    view.docsPath = 'src/empty'
    view.node = { type: 'dir', name: 'empty', path: 'src/empty' }
    view._updateDom()

    expect(view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS_GRID}`)).toBeFalsy()
  })

  test('toast text resolves through the component dictionary', () => {
    expect(typeof view._toastText()).toBe('string')
    expect(view._toastText().length).toBeGreaterThan(0)
  })

  test('unresolvable path shows the not-found note', async () => {
    view.onRouteParamChange({ params: { docsPath: 'docs/never/there' } })
    await flush()

    expect(view.node).toBe(null)
    expect(view.shadowRoot.textContent).toContain(DOCS_STRINGS.NOT_FOUND_PATH)
  })

  test('navigating off a file clears the payload', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => makePayload() }))

    view.onRouteParamChange({ params: { docsPath: 'docs/architecture/website.md' } })
    await flush()
    await flush()

    view.onRouteParamChange({ params: { docsPath: 'docs' } })
    await flush()

    expect(view.filePayload).toBe(null)
    expect(view.fileLoading).toBe(false)
  })

  test('copy on an unprotected docs page is left alone', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => makePayload() }))

    view.onRouteParamChange({ params: { docsPath: 'docs/architecture/website.md' } })
    await flush()
    await flush()

    const calls = globalThis.fetch.mock.calls.length

    const e = new Event(CLIPBOARD_EVENTS.COPY, { bubbles: true, cancelable: true })

    e.clipboardData = { setData: jest.fn() }

    view.shadowRoot.dispatchEvent(e)

    expect(e.clipboardData.setData).not.toHaveBeenCalled()
    expect(globalThis.fetch.mock.calls.length).toBe(calls)
  })

  test('copy on a protected src page hijacks the clipboard to the GitHub URL + telemeters', async () => {
    const posted = []

    globalThis.fetch = jest.fn(async (url) => {
      posted.push(url)

      return {
        ok: true,
        json: async () => makePayload({ format: 'code', path: 'src/App.tsx', name: 'App.tsx' }),
      }
    })

    view.onRouteParamChange({ params: { docsPath: 'src/App.tsx' } })
    await flush()
    await flush()

    const e = new Event(CLIPBOARD_EVENTS.COPY, { bubbles: true, cancelable: true })

    e.clipboardData = { setData: jest.fn() }

    view.shadowRoot.dispatchEvent(e)

    expect(e.defaultPrevented).toBe(true)
    expect(e.clipboardData.setData).toHaveBeenCalledWith('text/plain', SOCIAL_URLS.GITHUB_REPO)

    const telemetry = posted.filter((u) => String(u).includes('copy-attempts'))

    expect(telemetry.length).toBe(1)
  })

  test('contextmenu on a protected page is blocked; selectstart + dragstart too', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => makePayload({ format: 'code', path: 'src/App.tsx' }),
    }))

    view.onRouteParamChange({ params: { docsPath: 'src/App.tsx' } })
    await flush()
    await flush()

    const menu = new Event('contextmenu', { bubbles: true, cancelable: true })

    view.shadowRoot.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true)

    const sel = new Event('selectstart', { bubbles: true, cancelable: true })

    view.shadowRoot.dispatchEvent(sel)
    expect(sel.defaultPrevented).toBe(true)

    const drag = new Event('dragstart', { bubbles: true, cancelable: true })

    view.shadowRoot.dispatchEvent(drag)
    expect(drag.defaultPrevented).toBe(true)
  })

  test('PrintScreen keyup on a protected page fires telemetry', async () => {
    const posted = []

    globalThis.fetch = jest.fn(async (url) => {
      posted.push(url)

      return { ok: true, json: async () => makePayload({ format: 'code' }) }
    })

    view.onRouteParamChange({ params: { docsPath: 'src/App.tsx' } })
    await flush()
    await flush()

    posted.length = 0

    document.dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYUP, { key: DOCS_STRINGS.KEY_PRINT_SCREEN })
    )

    const telemetry = posted.filter((u) => String(u).includes('copy-attempts'))

    expect(telemetry.length).toBe(1)
  })

  test('nav toggle flips the mobile nav-open class on the root', () => {
    const root = () => view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS}`)
    const toggle = view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS_NAV_TOGGLE}`)

    expect(root().classList.contains(DOCS_CLASSES.DOCS_NAV_OPEN)).toBe(false)

    toggle.click()

    expect(view.navOpen).toBe(true)
    expect(root().classList.contains(DOCS_CLASSES.DOCS_NAV_OPEN)).toBe(true)

    view.toggleNav()

    expect(view.navOpen).toBe(false)
    expect(root().classList.contains(DOCS_CLASSES.DOCS_NAV_OPEN)).toBe(false)
  })

  test('treeview arrow keys move focus and expand/collapse dirs in place', async () => {
    const items = () => [...view.shadowRoot.querySelectorAll(`.${DOCS_CLASSES.DOCS_TREE_ITEM}`)]
    const rowFor = (path) => items().find((el) => el.getAttribute(DATA_ATTRS.DATA_PATH) === path)

    const srcRow = rowFor('src') // closed dir under the Source section

    srcRow.focus()

    // → on a closed dir expands in place (no navigation).
    srcRow.dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ARROW_RIGHT, bubbles: true })
    )
    await flush()

    expect(view.isDirOpen('src')).toBe(true)
    expect(pushed.length).toBe(0)

    // Focus was restored to the expanded row after re-render.
    const reopened = rowFor('src')

    expect(reopened.getAttribute('aria-expanded')).toBe('true')

    // → on an open dir descends to the first child.
    reopened.dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ARROW_RIGHT, bubbles: true })
    )
    await flush()

    const firstChild = rowFor('src/App.tsx')

    expect(view.shadowRoot.activeElement).toBe(firstChild)

    // ↑ returns to the parent row.
    firstChild.dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ARROW_UP, bubbles: true })
    )
    await flush()

    expect(view.shadowRoot.activeElement).toBe(rowFor('src'))

    // ← on an open dir collapses it in place.
    rowFor('src').dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ARROW_LEFT, bubbles: true })
    )
    await flush()

    expect(view.isDirOpen('src')).toBe(false)
  })

  test('← on a child row focuses its parent dir', async () => {
    // pickNode expands 'docs/architecture' itself — route-apply only
    // opens ancestors, so the child row needs the dir open.
    view.pickNode(view.rootsAsNodes()[1].children[0])
    await flush()

    const items = () => [...view.shadowRoot.querySelectorAll(`.${DOCS_CLASSES.DOCS_TREE_ITEM}`)]
    const rowFor = (path) => items().find((el) => el.getAttribute(DATA_ATTRS.DATA_PATH) === path)

    // 'docs/architecture' renders open under the Architecture section —
    // its website.md child climbs to it on ←.
    rowFor('docs/architecture/website.md').dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ARROW_LEFT, bubbles: true })
    )
    await flush()

    expect(view.shadowRoot.activeElement).toBe(rowFor('docs/architecture'))
  })

  test('grid arrow keys rove between cards', async () => {
    const cards = () => view.shadowRoot.querySelectorAll(`.${DOCS_CLASSES.DOCS_CARD}`)

    cards()[0].dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ARROW_RIGHT, bubbles: true })
    )
    await flush()

    expect(view.shadowRoot.activeElement).toBe(cards()[1])
  })

  test('Escape backs out of an open file, then closes the nav panel', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => makePayload() }))

    view.onRouteParamChange({ params: { docsPath: 'docs/architecture/website.md' } })
    await flush()
    await flush()

    view.shadowRoot
      .querySelector(`.${DOCS_CLASSES.DOCS}`)
      .dispatchEvent(
        new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ESCAPE, bubbles: true })
      )
    await flush()

    expect(pushed).toContain(`${ROUTE_PATHS.DOCS}/docs/architecture`)

    view.navOpen = true
    view.filePayload = null

    view.onViewKey({ key: KEYS.ESCAPE })

    expect(view.navOpen).toBe(false)

    // Non-Escape keys are ignored.
    view.onViewKey({ key: KEYS.ENTER })

    expect(pushed.length).toBeGreaterThan(0)
  })

  test('re-clicking an open dir collapses it — inside subtree navigates to parent', async () => {
    const srcDir = view.rootsAsNodes()[2].children[0] // Source section → 'src'

    view.pickNode(srcDir) // open + land inside 'src'
    await flush()

    pushed.length = 0

    view.pickTreeNode(srcDir) // docsPath === node.path → parent nav

    expect(view.isDirOpen('src')).toBe(false)
    expect(pushed).toContain(ROUTE_PATHS.DOCS)
  })

  test('re-clicking an open dir from a nested path still collapses to parent', async () => {
    // Viewer sits INSIDE 'docs/architecture' (a nested file) — the dir is
    // an ancestor, so re-clicking it collapses to its parent segment.
    view.onRouteParamChange({ params: { docsPath: 'docs/architecture/website.md' } })
    await flush()
    await flush()

    pushed.length = 0

    const archDir = view.rootsAsNodes()[1].children[0] // Architecture → 'docs/architecture'

    view.pickTreeNode(archDir) // docsPath startsWith('docs/architecture/') → inside

    expect(view.isDirOpen('docs/architecture')).toBe(false)
    expect(pushed).toContain(`${ROUTE_PATHS.DOCS}/docs`)
  })

  test('re-clicking an open dir while outside it only re-renders (no nav)', async () => {
    view.onRouteParamChange({ params: { docsPath: 'reports/axe-report.json' } })
    await flush()
    await flush()

    view.toggleDir('docs/sassdoc') // open in place without navigating

    pushed.length = 0

    const sassdoc = view.rootsAsNodes()[0].children[0] // Docs section → 'docs/sassdoc'

    view.pickTreeNode(sassdoc)

    expect(view.isDirOpen('docs/sassdoc')).toBe(false)
    expect(pushed.length).toBe(0)
  })

  test('keydowns on the tree container (not a row) are ignored', () => {
    // The keydown listener lives on the <ul> — a keydown landing on the
    // list itself (not a treeitem row) must hit the idx<0 early return.
    const tree = view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS_TREE}`)

    tree.dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ARROW_DOWN, bubbles: true })
    )

    expect(view.shadowRoot.activeElement).not.toBe(tree)
  })

  test('↓ moves to the next tree row; non-arrow keys fall through untouched', async () => {
    const items = () => view.shadowRoot.querySelectorAll(`.${DOCS_CLASSES.DOCS_TREE_ITEM}`)

    items()[0].dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ARROW_DOWN, bubbles: true })
    )
    await flush()

    expect(view.shadowRoot.activeElement).toBe(items()[1])

    // Unrelated key → no branch matches, nothing moves.
    items()[1].dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ENTER, bubbles: true })
    )
    await flush()

    expect(view.shadowRoot.activeElement).toBe(items()[1])
  })

  test('Escape with nothing open is a silent no-op', () => {
    view.onViewKey({ key: KEYS.ESCAPE })

    expect(view.navOpen).toBe(false)
    expect(view.filePayload).toBe(null)
    expect(pushed.length).toBe(0)
  })

  test('→ on a file tree row focuses the next row', async () => {
    view.pickNode(view.rootsAsNodes()[2].children[0]) // open + navigate 'src'
    await flush()

    const items = () => view.shadowRoot.querySelectorAll(`.${DOCS_CLASSES.DOCS_TREE_ITEM}`)

    // Under the open 'src' dir the file rows carry no aria-expanded.
    const fileRow = [...items()].find((b) => !b.hasAttribute('aria-expanded'))

    fileRow.dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ARROW_RIGHT, bubbles: true })
    )
    await flush()

    expect(view.shadowRoot.activeElement).toBeTruthy()
  })

  test('grid keydown on non-card, Enter (delta 0) and ← (delta -1)', async () => {
    const grid = view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS_GRID}`)
    const cards = () => view.shadowRoot.querySelectorAll(`.${DOCS_CLASSES.DOCS_CARD}`)

    // Non-card target → early return.
    grid.dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ARROW_RIGHT, bubbles: true })
    )

    // Unrelated key → delta 0 → no move.
    cards()[0].dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ENTER, bubbles: true })
    )
    await flush()

    expect(view.shadowRoot.activeElement).not.toBe(cards()[1])

    // ← wraps to the previous card (index 1 → 0).
    cards()[1].dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ARROW_LEFT, bubbles: true })
    )
    await flush()

    expect(view.shadowRoot.activeElement).toBe(cards()[0])

    // ↓ steps forward like →.
    cards()[0].dispatchEvent(
      new KeyboardEvent(KEYBOARD_EVENTS.KEYDOWN, { key: KEYS.ARROW_DOWN, bubbles: true })
    )
    await flush()

    expect(view.shadowRoot.activeElement).toBe(cards()[1])
  })

  test('route param change and mount tolerate a missing docsPath param', () => {
    router.currentRoute = {
      path: ROUTE_PATHS.DOCS,
      meta: { docsRoute: true },
      params: {},
    }

    view.onMounted()

    expect(view.docsPath).toBe(CHAR_STRINGS.EMPTY)

    view.onRouteParamChange({ params: {} })

    expect(view.docsPath).toBe(CHAR_STRINGS.EMPTY)

    view.onRouteParamChange()

    expect(view.docsPath).toBe(CHAR_STRINGS.EMPTY)
  })

  test('unmounting disposes the copy guard — no telemetry after destroy', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => makePayload({ format: 'code' }),
    }))

    view.onRouteParamChange({ params: { docsPath: 'src/App.tsx' } })
    await flush()
    await flush()

    cleanup()
    cleanup = null

    const e = new Event(CLIPBOARD_EVENTS.COPY, { bubbles: true, cancelable: true })

    e.clipboardData = { setData: jest.fn() }

    view.shadowRoot.dispatchEvent(e)

    expect(e.clipboardData.setData).not.toHaveBeenCalled()
  })

  test('JSON-LD + title + microdata: CollectionPage at root, TechArticle on file open, graph survives destroy', async () => {
    const jsonLd = () => document.getElementById(SCHEMA_STRINGS.JSON_LD_SCRIPT_ID)
    const graph = () => JSON.parse(jsonLd().textContent)['@graph']

    // Portal root — CollectionPage, breadcrumb with just the docs crumb.
    expect(document.title).toContain(DOCS_STRINGS.TITLE)
    expect(graph()[1]['@type']).toBe('CollectionPage')
    expect(graph()[0].itemListElement).toHaveLength(1)
    expect(view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS}`).getAttribute('itemtype')).toBe(
      `${SCHEMA_STRINGS.SCHEMA_CONTEXT}/CollectionPage`
    )

    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => makePayload({ format: 'markdown' }),
    }))

    view.onRouteParamChange({ params: { docsPath: 'docs/README.md' } })
    await flush()
    await flush()

    expect(graph()[1]['@type']).toBe('TechArticle')
    expect(graph()[0].itemListElement.length).toBeGreaterThan(1)
    expect(view.shadowRoot.querySelector(`.${DOCS_CLASSES.DOCS}`).getAttribute('itemtype')).toBe(
      `${SCHEMA_STRINGS.SCHEMA_CONTEXT}/TechArticle`
    )
    expect(document.title).toContain('README.md')

    cleanup()
    cleanup = null

    // The nav pipeline emits the next route's graph BEFORE this view
    // disconnects, so teardown intentionally no longer clears the node —
    // destroying mid-graph must not wipe the incoming route's head data.
    expect(jsonLd()).toBeTruthy()
  })
})
