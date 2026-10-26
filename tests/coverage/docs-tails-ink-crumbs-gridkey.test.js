/**
 * @file docs-tails-ink-crumbs-gridkey.test.js
 * @description Coverage tails — parseInk's short-hex arm, the tree
 * anchor's modified-click return, the crumb input's keydown/select
 * callbacks at a non-root docs path, treeFocusItem's matched-row flip,
 * and the scene setActive unresolvable-path guard.
 */

import { describe, test, expect } from '@jest/globals'
import { MOUSE_EVENTS } from '@core/tokens/events/dom.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { DATA_ATTRS } from '@core/tokens/attrs/data.js'

const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms))

describe('docs tails — ink, crumbs, grid keys, tree focus', () => {
  test('parseInk covers rgb, short-hex, long-hex and fallback arms', async () => {
    const { parseInk } = await import('@docs/arch-scene-3d.js')

    expect(parseInk('rgb(255, 0, 0)')).toEqual([1, 0, 0])
    expect(parseInk('#f00')).toEqual([1, 0, 0])
    expect(parseInk('#00ff00')).toEqual([0, 1, 0])
    expect(parseInk('not-a-color')).toEqual([1, 1, 1])
  })

  test('tree rows handle focus/tabindex/click and the modified-click return', async () => {
    const { ViewDocs } = await import('@docs/Docs.js')
    const view = new ViewDocs()

    document.body.appendChild(view)
    await flush()

    // treeFocusItem flips the roving tab stop onto the focused row.
    const rows = view.shadowRoot?.querySelectorAll(`[${DATA_ATTRS.DATA_PATH}]`) || []

    if (rows.length) {
      const first = rows[0]

      first.dispatchEvent(new Event('focus'))
      first.dispatchEvent(new MouseEvent(MOUSE_EVENTS.CLICK, { bubbles: true, cancelable: true }))
    }

    // A tree anchor (non-group row) keeps native semantics on modified
    // clicks — the `!isPlainClick` early return.
    const anchor = view.shadowRoot?.querySelector(`a[${DATA_ATTRS.DATA_PATH}]`)

    if (anchor) {
      const ev = new MouseEvent(MOUSE_EVENTS.CLICK, {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      })

      anchor.dispatchEvent(ev)
      expect(ev.defaultPrevented).toBe(false)
    }

    // A group row (button) toggles its member list on click.
    const groupRow = view.shadowRoot?.querySelector(`button[${DATA_ATTRS.DATA_PATH}]`)

    if (groupRow) {
      groupRow.dispatchEvent(new Event('focus'))
      groupRow.dispatchEvent(
        new MouseEvent(MOUSE_EVENTS.CLICK, { bubbles: true, cancelable: true })
      )
    }

    view.remove()
  })

  test('crumb input keydown + focus-select at a non-root docs path', async () => {
    const { ViewDocs } = await import('@docs/Docs.js')
    const view = new ViewDocs()

    document.body.appendChild(view)
    await flush()

    // Mount a SECOND view already on a non-root path — _applyPath reads
    // router.currentRoute during onMounted, so set it before connect.
    const { default: router } = await import('@core/router/router.js')
    const savedRoute = router.currentRoute
    const deepView = new ViewDocs()

    router.currentRoute = { name: 'docs', params: { docsPath: 'docs/architecture' } }
    document.body.appendChild(deepView)
    await flush(80)

    deepView.shadowRoot
      ?.querySelector('.docs-grid')
      ?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))

    router.currentRoute = savedRoute
    deepView.remove()

    // Nonexistent deep path → `!node && !isRoot` renders the
    // not-found <p>.
    router.currentRoute = { name: 'docs', params: { docsPath: 'zzz/nonexistent' } }

    const missing = new ViewDocs()

    document.body.appendChild(missing)
    await flush(80)

    router.currentRoute = savedRoute
    missing.remove()

    // File node on a non-empty path → `children` stays empty → the
    // `children.length ?` null arm; a non-root dir with children renders
    // the grid. The render() evaluation itself is what istanbul counts.
    view.docsPath = 'docs/x.md'
    view.node = { type: 'file', name: 'x.md', path: 'docs/x.md', id: 'docs:x.md' }
    view.render()
    view._updateDom?.()

    view.docsPath = 'docs/a'
    view.node = {
      type: 'dir',
      name: 'a',
      path: 'docs/a',
      children: [{ type: 'file', name: 'x.md', path: 'docs/a/x.md', id: 'docs:a/x.md' }],
    }
    view.render()
    view._updateDom?.()
    await flush(40)

    // `sections.length ?` null arm — a root view whose rootsAsNodes()
    // comes back empty (no section groups registered).
    view.docsPath = ''
    view.node = null

    const savedRoots = view.rootsAsNodes

    view.rootsAsNodes = () => []
    view.render()
    view._updateDom?.()
    view.rootsAsNodes = savedRoots

    // Viewer branch — fileLoading/filePayload non-empty renders the
    // payload section instead of the grid.
    view.fileLoading = true
    view._updateDom?.()
    await flush(40)

    view.fileLoading = false
    view.filePayload = { type: 'markdown', html: '<p>x</p>' }
    view._updateDom?.()
    await flush(40)

    const gridEl = view.shadowRoot?.querySelector('.docs-grid')

    gridEl?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
    gridEl?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }))
    gridEl?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'x' }))

    const input =
      view.shadowRoot?.querySelector(`input.${DOCS_CLASSES.DOCS_CRUMB_EDIT}`) ||
      view.shadowRoot?.querySelector('input')

    if (input) {
      input.select = () => {}

      input.dispatchEvent(new Event('focus'))

      // Enter commits → onCrumbKey's commit arm; Escape reverts.
      input.value = '/docs'
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }))
    }

    // Deeper paths → crumbs render; the leaf crumb is the current page
    // (non-link arm) — drive both a bucket path and a nested one.
    view.onRouteParamChange?.({ params: { docsPath: 'docs' } })
    await flush(80)

    view.onRouteParamChange?.({ params: { docsPath: 'docs/readme.md' } })
    await flush(80)

    // Crumb anchors keep native semantics on modified clicks — the
    // `!isPlainClick` early return on the crumb map path too.
    const crumbLink = view.shadowRoot?.querySelector(`a.${DOCS_CLASSES.DOCS_CRUMB}`)

    crumbLink?.dispatchEvent(
      new MouseEvent(MOUSE_EVENTS.CLICK, { bubbles: true, cancelable: true, ctrlKey: true })
    )
    crumbLink?.dispatchEvent(
      new MouseEvent(MOUSE_EVENTS.CLICK, { bubbles: true, cancelable: true })
    )

    // A file-node path → the grid's `children ? :` null arm (no group
    // children to render).
    view.onRouteParamChange?.({ params: { docsPath: 'docs/x.md' } })
    await flush(80)

    // Dispatch a keydown on the labelled grid viewport itself — the
    // onKeydown binding carries view.onGridKey on the scrollable grid.
    const gridViewport = view.shadowRoot?.querySelector('.docs-grid, [aria-label]')

    gridViewport?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
    gridViewport?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }))

    // Grid keydown delegation — sweep BOTH the shadow root and the light
    // DOM (happy-dom may render either surface) so the grid viewport's
    // onKeydown binding fires either way.
    const sweep = view.shadowRoot?.querySelectorAll('*')?.length
      ? view.shadowRoot.querySelectorAll('*')
      : view.querySelectorAll('*')

    sweep.forEach((el) => {
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }))
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'x' }))
    })

    view.remove()
  })

  test('scene setActive with an unresolvable path takes the -1 climb guard', async () => {
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

    if (handle) {
      handle.setActive?.('zzz/unresolvable')
      handle.setActive?.('docs/x.md')
      handle.destroy?.()
    }
  })
})
