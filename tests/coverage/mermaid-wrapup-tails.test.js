/**
 * @file mermaid-wrapup-tails.test.js
 * @description Wrap-up coverage tails for docs/mermaid.ts — the
 *   renderMermaidBlocksForPrint mirror pass the screen-render tails
 *   never reach: the paper-theme JSON build (both computed-font
 *   fallback arms), the `src attr ?? textContent ?? EMPTY` source
 *   chain, the empty-source early return, the viewBox ratio gate
 *   (every `&&` operand, both cond arms, and the rotate set/remove
 *   arms), and the engine-failure catch that keeps the cloned source.
 */

import { describe, test, expect, afterEach } from '@jest/globals'
import { renderMermaidBlocksForPrint } from '@docs/mermaid.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { DATA_ATTRS } from '@core/tokens/attrs/data.js'
import { ATTR_VALUES } from '@core/tokens/attrs/values.js'
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { LOG_LEVELS } from '@core/tokens/data/log.js'
import { __diagramState } from '@core/utils/wasm/wasm-diagram.js'
import { getDevLog, clearDevLog } from '@core/devlog.js'

/** The `viewBox` attribute name — one-off fixture vocabulary the fake svg stubs key on. */
const ATTR_VIEWBOX = 'viewBox'

/** A wide viewBox — w/h 2.0 clears the 1.15 rotate ratio, stamping the rotated slot. */
const VIEWBOX_WIDE = '0 0 200 100'

/** A tall viewBox — w/h 0.5 stays portrait; the else arm strips a stale rotate stamp. */
const VIEWBOX_TALL = '0 0 100 200'

/** Computed-style fixture values for the paper-theme font arms. */
const STUB_STYLE = {
  FONT: 'Stub Serif',
  SIZE: '18px',
  VAR: ' ink ',
}

/** Builds a `.docs-mermaid` mirror clone — `src` seats the stashed-source attr. */
const mkBlock = (src) => {
  const block = document.createElement(HTML_TAGS.DIV)

  block.className = DOCS_CLASSES.DOCS_MERMAID

  if (src !== undefined) block.setAttribute(DATA_ATTRS.DOCS_MERMAID_SRC, src)

  return block
}

/** Forces a clone's post-render `querySelector('svg')` to a fake svg carrying `viewBox`. */
const stubSvg = (block, viewBox) => {
  block.querySelector = () => ({
    getAttribute: (name) => (name === ATTR_VIEWBOX ? viewBox : null),
  })
}

/** Wraps blocks in a detached mirror container — the pass's `container` argument. */
const mkBox = (...blocks) => {
  const box = document.createElement(HTML_TAGS.DIV)

  for (const block of blocks) box.appendChild(block)

  return box
}

describe('docs mermaid print-mirror tails', () => {
  afterEach(() => {
    __diagramState.failNext = false
  })

  test('re-renders clones in the paper theme — the ?? source chain, viewBox gate, and rotate stamp matrix', async () => {
    const wide = mkBlock('flowchart TB')
    const tall = mkBlock('flowchart LR')
    const bare = mkBlock()
    const emptyText = mkBlock()
    const nullText = mkBlock()

    // Rotated-slot arm — a wide viewBox clears PRINT_ROTATE_RATIO.
    stubSvg(wide, VIEWBOX_WIDE)

    // Portrait arm — a stale stamp from an earlier seat gets removed.
    tall.setAttribute(DATA_ATTRS.PRINT_ROTATE, ATTR_VALUES.EMPTY)
    stubSvg(tall, VIEWBOX_TALL)

    // No src attr → the `?? textContent` arm; the mock svg carries no
    // viewBox so `vb` lands falsy and the else arm runs too.
    bare.textContent = 'sequenceDiagram'

    // Whitespace-only source bails before the engine call.
    emptyText.textContent = ' '

    // A null textContent (non-element clone edge) reaches `?? EMPTY`.
    Object.defineProperty(nullText, 'textContent', { get: () => null, configurable: true })

    const callsBefore = __diagramState.calls

    await renderMermaidBlocksForPrint(mkBox(wide, tall, bare, emptyText, nullText))

    // Exactly the three source-bearing clones hit the engine.
    expect(__diagramState.calls).toBe(callsBefore + 3)
    expect(wide.hasAttribute(DATA_ATTRS.PRINT_ROTATE)).toBe(true)
    expect(tall.hasAttribute(DATA_ATTRS.PRINT_ROTATE)).toBe(false)
    expect(bare.hasAttribute(DATA_ATTRS.PRINT_ROTATE)).toBe(false)
    expect(emptyText.childElementCount).toBe(0)
    expect(nullText.childElementCount).toBe(0)

    // Happy-dom reports no font → the paper theme took both `||` fallbacks.
    const theme = JSON.parse(__diagramState.lastTheme)

    expect(theme.font.length).toBeGreaterThan(0)
    expect(theme.fontSize).toBe(14)
  })

  test('a styled clone feeds its computed font to the paper theme', async () => {
    const realGetComputedStyle = window.getComputedStyle

    window.getComputedStyle = () => ({
      getPropertyValue: () => STUB_STYLE.VAR,
      fontFamily: STUB_STYLE.FONT,
      fontSize: STUB_STYLE.SIZE,
    })

    try {
      await renderMermaidBlocksForPrint(mkBox(mkBlock('flowchart TB')))
    } finally {
      window.getComputedStyle = realGetComputedStyle
    }

    const theme = JSON.parse(__diagramState.lastTheme)

    expect(theme.font).toBe(STUB_STYLE.FONT)
    expect(theme.fontSize).toBe(18)
    expect(theme.fg).toBe(STUB_STYLE.VAR.trim())
  })

  test('a failing engine keeps the clone untouched and warns through devlog', async () => {
    clearDevLog()
    __diagramState.failNext = true

    const block = mkBlock('bad syntax [[')

    await renderMermaidBlocksForPrint(mkBox(block))

    // The render rejected before innerHTML landed — the clone survives.
    expect(block.innerHTML).toBe(ATTR_VALUES.EMPTY)
    expect(getDevLog().some((e) => e.level === LOG_LEVELS.WARN)).toBe(true)
  })
})
