/**
 * @file mermaid.test.js
 * @description Coverage tails for docs/mermaid.ts — lazy wasm diagram
 * engine load, per-block render, processed blocks skipped, themed
 * render input, and the failure path degrading to plain source.
 */

import { describe, test, expect } from '@jest/globals'
import { renderMermaidBlocks } from '@docs/mermaid.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { __diagramState } from '@core/utils/wasm/wasm-diagram.js'

describe('docs mermaid', () => {
  test('no mermaid blocks → engine never loads', async () => {
    const box = document.createElement('div')

    box.innerHTML = '<p>no diagrams</p>'

    const callsBefore = __diagramState.calls

    await renderMermaidBlocks(box)

    expect(__diagramState.calls).toBe(callsBefore)
  })

  test('renders blocks with project theme vars; processed blocks skip', async () => {
    const box = document.createElement('div')

    box.innerHTML =
      `<div class="${DOCS_CLASSES.DOCS_MERMAID}">flowchart TB</div>` +
      `<div class="${DOCS_CLASSES.DOCS_MERMAID}" data-processed="true">done</div>`

    await renderMermaidBlocks(box)

    const blocks = box.querySelectorAll(`.${DOCS_CLASSES.DOCS_MERMAID}`)
    const theme = JSON.parse(__diagramState.lastTheme)

    expect(blocks[0].getAttribute('data-processed')).toBe('true')
    expect(blocks[1].innerHTML).toBe('done')
    expect(theme.fg).toBeDefined()
    expect(theme.bg).toBeDefined()
    expect(__diagramState.lastSource).toContain('flowchart')
  })

  test('an engine failure leaves the source text in place', async () => {
    const box = document.createElement('div')

    box.innerHTML = `<div class="${DOCS_CLASSES.DOCS_MERMAID}">bad syntax [[</div>`
    __diagramState.failNext = true

    await renderMermaidBlocks(box)

    expect(box.textContent).toContain('bad syntax')
  })

  test('unparsable computed font falls back to engine defaults', async () => {
    const box = document.createElement('div')

    box.innerHTML = `<div class="${DOCS_CLASSES.DOCS_MERMAID}">flowchart TB</div>`

    const realGetComputedStyle = window.getComputedStyle

    window.getComputedStyle = () => ({
      getPropertyValue: () => ' ',
      fontFamily: '',
      fontSize: 'bogus',
    })

    try {
      await renderMermaidBlocks(box)
    } finally {
      window.getComputedStyle = realGetComputedStyle
    }

    const theme = JSON.parse(__diagramState.lastTheme)

    expect(theme.font).toBe('sans-serif')
    expect(theme.fontSize).toBe(14)
  })
})
