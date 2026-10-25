/**
 * @file render-index-tails.test.js
 * @description Coverage tail for docs render.tsx — the index-streaming
 * arms unreachable under the small shared manifest: the pumpIndex
 * continuation slice (needs > INDEX_CHUNK yielded rows), the
 * scheduleIndexSlice setTimeout fallback (no requestIdleCallback), and
 * the childless-dir recursion guard. Mocks `virtual:docs-manifest` with
 * a 400+ node fixture before the view module loads.
 */
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { encodeManifest } from '@build/docs/encode.mjs'
import { mount } from '@tests/fixtures/test-constants.js'
import { DOCS_STRINGS } from '@core/tokens/strings/docs.js'
import { DOCS_UNITS } from '@core/tokens/strings/docs.js'
import { ROUTE_PATHS } from '@core/tokens/routes/paths.js'
import { ROUTE_NAMES } from '@core/tokens/routes/names.js'
import { VIEW_TAGS } from '@core/tokens/elements/views.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import router from '@core/router/router.js'

/** INDEX_CHUNK+ rows so the first slice leaves a pending continuation. */
const FIXTURE = {
  generated: '2024-06-01T12:00:00.000Z',
  roots: [
    {
      root: 'docs',
      label: 'Documentation',
      kind: 'docs',
      children: [
        { type: 'dir', name: 'empty', path: 'docs/empty', children: [] },
        ...Array.from({ length: DOCS_UNITS.INDEX_CHUNK + 1 }, (_, i) => ({
          type: 'file',
          name: `doc-${i}.md`,
          path: `docs/doc-${i}.md`,
          id: `docs:doc-${i}.md`,
          format: 'markdown',
          size: 10,
          mtime: '2024-06-01T12:00:00.000Z',
          embedded: true,
        })),
      ],
    },
  ],
}

jest.unstable_mockModule('virtual:docs-manifest', () => ({
  default: encodeManifest(FIXTURE),
}))

const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms))

describe('docs index — streaming tails', () => {
  let view
  let cleanup
  let origRoute
  let pushSpy
  let origRic

  beforeEach(async () => {
    origRoute = router.currentRoute

    // No requestIdleCallback — scheduleIndexSlice takes the setTimeout arm.
    origRic = window.requestIdleCallback

    delete window.requestIdleCallback

    pushSpy = jest.spyOn(router, 'push').mockImplementation(async () => {})

    router.currentRoute = {
      name: ROUTE_NAMES.DOCS,
      view: VIEW_TAGS.VIEW_DOCS,
      lang: 'en',
      path: ROUTE_PATHS.DOCS,
      meta: { docsRoute: true },
      params: { docsPath: CHAR_STRINGS.EMPTY },
    }

    const { ViewDocs } = await import('@docs/Docs.js')

    view = new ViewDocs()
    cleanup = mount(view)
  })

  afterEach(() => {
    cleanup?.()
    pushSpy.mockRestore()
    router.currentRoute = origRoute

    if (origRic) window.requestIdleCallback = origRic
  })

  test('the index streams past one slice via the setTimeout fallback', async () => {
    const index = view.shadowRoot.querySelector(`nav[aria-label="${DOCS_STRINGS.INDEX_LABEL}"]`)

    expect(index).toBeTruthy()

    // The first idle slice landed synchronously inside the mount; more
    // rows than INDEX_CHUNK means the continuation arrow re-scheduled.
    await flush(60)

    const anchors = index.querySelectorAll('a')

    // 'empty' dir heading link + INDEX_CHUNK+1 file links — the docs
    // bucket itself flattened into the group row (not a link).
    expect(anchors.length).toBe(DOCS_UNITS.INDEX_CHUNK + 2)
  })

  test('index links are non-tabbable and non-anchor clicks never navigate', async () => {
    await flush(60)

    const index = view.shadowRoot.querySelector(`nav[aria-label="${DOCS_STRINGS.INDEX_LABEL}"]`)

    // tabindex="-1" keeps ~8k index anchors out of sequential focus order
    // while AT link/heading enumeration still sees them.
    const anchors = [...index.querySelectorAll('a')]

    expect(anchors.every((a) => a.tabIndex === -1)).toBe(true)

    // Clicking a non-anchor node inside the nav (the index title heading)
    // resolves no closest('a') → the delegated handler bails out.
    pushSpy.mockClear()
    index.querySelector('h2').dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(pushSpy).not.toHaveBeenCalled()
  })
})
