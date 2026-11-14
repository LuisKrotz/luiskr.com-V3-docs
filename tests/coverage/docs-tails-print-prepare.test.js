/**
 * @file docs-tails-print-prepare.test.js
 * @description Coverage tails for ViewDocs._onPrintPrepare — the printprepare
 * answer that syncs the viewer's rendered DOM (mermaid SVGs, istanbul
 * tables) into the light-DOM reader mirror before the print walk. Covers
 * the no-article bail, the protected-source guard notice (exfiltration
 * guard), the empty-content bail, and the happy-path copy with canvas
 * stripping.
 */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals'
import { ViewDocs } from '@docs/Docs.js'
import { mount } from '@tests/fixtures/test-constants.js'
import router from '@core/router/router.js'
import { VIEW_TAGS } from '@core/tokens/elements/views.js'
import { ROUTE_PATHS } from '@core/tokens/routes/paths.js'
import { ROUTE_NAMES } from '@core/tokens/routes/names.js'
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { DOCS_SELECTORS } from '@core/tokens/selectors/docs.js'
import { READER_CLASSES } from '@core/tokens/classes/reader.js'
import { DATA_ATTRS } from '@core/tokens/attrs/data.js'
import { CLIPBOARD_EVENTS, PRINT_EVENTS } from '@core/tokens/events/dom.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'

/** Route-record factory for the docs portal — params.docsPath carries the sub-path. */
const docsRoute = (docsPath = '') => ({
  name: ROUTE_NAMES.DOCS,
  view: VIEW_TAGS.VIEW_DOCS,
  lang: 'en',
  path: `${ROUTE_PATHS.DOCS}${docsPath ? `/${docsPath}` : ''}`,
  meta: { docsRoute: true },
  params: { docsPath },
})

/** Dispatches the print-prepare event the view listens for — exercises the pre-print mirror build. */
const firePrepare = () => window.dispatchEvent(new window.Event(PRINT_EVENTS.PREPARE))

/** Builds a reader mirror with a sentinel child the assertions diff on. */
const mkArticle = () => {
  const article = document.createElement(HTML_TAGS.ARTICLE)

  article.className = READER_CLASSES.CONTENT
  article.appendChild(document.createElement(HTML_TAGS.SPAN))

  document.body.appendChild(article)

  return article
}

describe('Docs print-prepare tails', () => {
  let view
  let cleanup
  let origRoute

  const mountAt = async (docsPath) => {
    router.currentRoute = docsRoute(docsPath)

    view = new ViewDocs()
    cleanup = mount(view)

    await new Promise((r) => setTimeout(r, 0))
  }

  beforeEach(() => {
    origRoute = router.currentRoute
  })

  afterEach(() => {
    cleanup?.()

    router.currentRoute = origRoute

    document
      .querySelectorAll(`${HTML_TAGS.ARTICLE}.${READER_CLASSES.CONTENT}`)
      .forEach((a) => a.remove())
  })

  test('no reader mirror → the prepare answer bails untouched', async () => {
    await mountAt('docs/architecture/website.md')

    expect(() => firePrepare()).not.toThrow()
  })

  test('rendered payload DOM lands in the mirror, canvases stripped', async () => {
    await mountAt('docs/architecture/website.md')

    const article = mkArticle()
    const box = view.shadowRoot.querySelector(DOCS_SELECTORS.CONTENT)

    const block = document.createElement(HTML_TAGS.DIV)
    const svgHost = document.createElement(HTML_TAGS.DIV)
    const deadCanvas = document.createElement(HTML_TAGS.CANVAS)

    box.appendChild(block)
    box.appendChild(svgHost)
    box.appendChild(deadCanvas)

    firePrepare()

    // Sentinel replaced by the cloned payload; the canvas clone dropped.
    expect(article.querySelectorAll(HTML_TAGS.DIV).length).toBe(2)
    expect(article.querySelector(HTML_TAGS.SPAN)).toBeNull()
    expect(article.querySelector(HTML_TAGS.CANVAS)).toBeNull()
  })

  test('protected source view replaces the mirror with the guard notice', async () => {
    await mountAt('src/App.tsx')

    const article = mkArticle()

    firePrepare()

    // The payload never prints — the mirror carries only the localized
    // copy-guard notice so the sheet isn't a literal blank page.
    expect(article.childElementCount).toBe(1)
    expect(article.querySelector(HTML_TAGS.P)).not.toBeNull()
    expect(article.querySelector(HTML_TAGS.SPAN)).toBeNull()
    expect(article.textContent.trim().length).toBeGreaterThan(0)
  })

  test('non-file route without a content box leaves the mirror unprepared', async () => {
    await mountAt(CHAR_STRINGS.EMPTY)

    const article = mkArticle()

    firePrepare()

    // The unprepare-first pass clears any stale prepared state — an
    // unarmed bail leaves the mirror empty and unmarked so #app prints.
    expect(article.hasAttribute(DATA_ATTRS.PRINT_DOC)).toBe(false)
    expect(article.childElementCount).toBe(0)
  })

  test('dir route (id-less node) is unprotected — mirror stays unprepared', async () => {
    await mountAt('docs/architecture')

    const article = mkArticle()

    firePrepare()

    expect(article.hasAttribute(DATA_ATTRS.PRINT_DOC)).toBe(false)
    expect(article.childElementCount).toBe(0)
  })

  test('dev route without a prerendered mirror creates one, and afterprint removes it', async () => {
    await mountAt('docs/architecture/website.md')

    const box = view.shadowRoot.querySelector(DOCS_SELECTORS.CONTENT)

    box.appendChild(document.createElement(HTML_TAGS.DIV))

    // No <article.reader-content> in the light DOM — the dev path creates
    // the mirror on demand and flags it for removal on the unprepared pass.
    firePrepare()

    const mirror = document.querySelector(`${HTML_TAGS.ARTICLE}.${READER_CLASSES.CONTENT}`)

    expect(mirror).not.toBeNull()
    expect(mirror.hasAttribute(DATA_ATTRS.PRINT_DOC)).toBe(true)
    expect(mirror.querySelector(HTML_TAGS.DIV)).not.toBeNull()

    window.dispatchEvent(new window.Event(CLIPBOARD_EVENTS.AFTER_PRINT))

    // The created mirror leaves the DOM outright rather than parking empty.
    expect(document.querySelector(`${HTML_TAGS.ARTICLE}.${READER_CLASSES.CONTENT}`)).toBeNull()
  })
})
