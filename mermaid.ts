/**
 * @file docs/mermaid.ts
 * @description Diagram rendering for docs payloads — markdown
 * ```mermaid fences land in the viewer as `.docs-mermaid` divs carrying
 * the escaped diagram source; this module runs the LOCAL `rust/diagram`
 * wasm engine (loaded through core/utils/wasm/wasm-diagram.ts), skins
 * each render with the project's live theme tokens (computed-style
 * reads, so light/dark + the turquoise accent follow the active
 * palette), and swaps each block's text for a real SVG.
 *
 * The npm `mermaid` package is gone — the wasm artifact implements the
 * corpus's two diagram families (flowchart, sequenceDiagram) in ~130KB
 * instead of ~1MB of JS. The load is lazy so it only pays when a doc
 * actually contains a diagram. Failures degrade to the plain source
 * block — never a broken page (the engine throws on unsupported
 * diagram types, which lands in the same restore path).
 */

import { DOCS_SELECTORS } from '@core/tokens/selectors/docs.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { DOCS_STRINGS } from '@core/tokens/strings/docs.js'
import { THEME_CSS_PROPS } from '@core/tokens/css/theme.js'
import { ARIA_ATTRS } from '@core/tokens/attrs/aria.js'
import { devWarn } from '@core/devlog.js'
import { renderDiagram } from '@core/utils/wasm/wasm-diagram.js'

/** Default font size when the computed style is unparsable. */
const FONT_SIZE_FALLBACK = 14

/**
 * Reads the live theme custom properties + computed type into the
 * engine's theme JSON — the diagram inherits the project's
 * ink/surface/accent tokens instead of shipping a palette.
 * @param style Computed style of the docs root (carries the theme vars).
 * @returns JSON string for `render_diagram`'s `Theme::from_json`.
 */
const themeJson = (style: CSSStyleDeclaration): string => {
  const v = (name: string): string => style.getPropertyValue(name).trim()

  return JSON.stringify({
    font: style.fontFamily || 'sans-serif',
    fontSize: parseFloat(style.fontSize) || FONT_SIZE_FALLBACK,
    fg: v(THEME_CSS_PROPS.TEXT_PRIMARY),
    bg: v(THEME_CSS_PROPS.BG_SECONDARY),
    line: v(THEME_CSS_PROPS.COLOR_ACCENT),
    accent: v(THEME_CSS_PROPS.COLOR_ACCENT),
    surface: v(THEME_CSS_PROPS.BG_PRIMARY),
  })
}

/**
 * Renders every unprocessed `.docs-mermaid` block inside `container`
 * into an inline SVG diagram. Safe to call repeatedly — processed
 * nodes are marked (`data-processed`), so later payloads don't
 * re-render earlier diagrams.
 * @param container The docs-content box holding rendered payload HTML.
 */
export const renderMermaidBlocks = async (container: HTMLElement): Promise<void> => {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>(DOCS_SELECTORS.MERMAID)).filter(
    (b) => !b.hasAttribute('data-processed')
  )

  if (!blocks.length) return

  // Swap each block's raw diagram source for an in-place skeleton while
  // the wasm artifact downloads and each diagram renders — the user
  // sees "Rendering diagram…" instead of a code dump. On any failure the
  // original source is restored so the file still reads as documentation.
  const sources = blocks.map((b) => String(b.textContent))

  const restore = (i: number) => {
    blocks[i].textContent = sources[i]
  }

  blocks.forEach((block) => {
    block.textContent = ''

    const loader = document.createElement('div')

    loader.className = DOCS_CLASSES.DOCS_MERMAID_LOADING

    loader.setAttribute(ARIA_ATTRS.ROLE, ARIA_ATTRS.ROLE_STATUS)

    loader.textContent = DOCS_STRINGS.MERMAID_LOADING

    block.appendChild(loader)
  })

  const theme = themeJson(getComputedStyle(document.documentElement))

  // Per-block render — the engine returns one `<svg>` string per source;
  // it lands via innerHTML exactly where mermaid's output used to.
  for (const [i, block] of blocks.entries()) {
    try {
      block.innerHTML = await renderDiagram(sources[i], theme)
      block.setAttribute('data-processed', 'true')
    } catch (err) {
      // A malformed/unsupported diagram keeps its escaped source text —
      // the file still reads as documentation.
      restore(i)

      devWarn('docs mermaid block failed', err)
    }
  }
}
