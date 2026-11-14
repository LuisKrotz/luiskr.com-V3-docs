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
import { DATA_ATTRS } from '@core/tokens/attrs/data.js'
import { THEME_CSS_PROPS } from '@core/tokens/css/theme.js'
import { ATTR_VALUES } from '@core/tokens/attrs/values.js'
import { ARIA_ATTRS } from '@core/tokens/attrs/aria.js'
import { ML } from '@core/tokens/data/ml.js'
import { devWarn } from '@core/devlog.js'
import { renderDiagram } from '@core/utils/wasm/wasm-diagram.js'
import { runMlModel } from '@core/utils/ml/ort-engine.js'

/** Default font size when the computed style is unparsable. */
const FONT_SIZE_FALLBACK = 14

/**
 * Aspect ratio (w/h) at which a print diagram earns the rotated slot —
 * anything wider reads better quarter-turned to full page height than
 * shrunk to the portrait content width.
 */
const PRINT_ROTATE_RATIO = 1.15

/**
 * Cheap source scanners feeding the diagram-cost model — counts of each
 * structural feature, not a parse (the wasm engine still does that).
 */
const EDGE_RE = /-->>|->>|-->|-.->|--x/g
/** Node-shape opener — any `[`, `(`, or `{` begins a node declaration. */
const NODE_RE = /[[({]/g
/** Nested subgraph keyword — bumps the bracket-depth heuristic. */
const NEST_RE = /\bsubgraph\b/g
/** Self-edge — `A -> A` adds visual noise the layout already implies. */
const SELF_RE = /(\b\w+)\s*[-.]+>{1,2}\s*\1\b/g

/** Counts regex matches without allocating a match array. */
const countMatches = (re: RegExp, source: string): number => {
  re.lastIndex = 0

  let n = 0

  while (re.exec(source)) n++

  return n
}

/**
 * Scores a diagram's predicted render+layout cost through the ONNX
 * `diagram-cost` model (wasm EP — the slug is in ML_WASM_EP_MODELS so
 * the session never issues GPU pipeline-compile IPCs while the docs
 * scene compiles its own shaders). When the predicted
 * cost clears DIAGRAM_DEFER_MS the caller yields one task turn before
 * rendering so a large graph can't long-task the docs view between
 * blocks. A null score (no runtime/model) means render immediately —
 * the same behavior as before the model existed.
 * @param source Raw mermaid source for the block.
 * @returns Predicted cost in ms, or null when ML is unavailable.
 */
const predictDiagramCost = async (source: string): Promise<number | null> => {
  const out = await runMlModel(ML.MODEL_DIAGRAM, {
    [ML.IN_FEATURES]: {
      data: new Float32Array([
        countMatches(NODE_RE, source) / ML.DIAGRAM_NORM_NODES,
        countMatches(EDGE_RE, source) / ML.DIAGRAM_NORM_EDGES,
        countMatches(NEST_RE, source) / ML.DIAGRAM_NORM_NEST,
        countMatches(SELF_RE, source) / ML.DIAGRAM_NORM_SELF,
      ]),
      dims: [1, ML.DIAGRAM_FEATURE_DIM],
    },
  })

  return out?.[ML.OUT_COST]?.[0] ?? null
}

/** Yields one macrotask turn — cheap cooperative scheduling point. */
const yieldTask = (): Promise<void> => new Promise((r) => setTimeout(r))

/**
 * Reads the live theme custom properties + computed type into the
 * engine's theme JSON — the diagram inherits the project's
 * ink/surface/accent tokens instead of shipping a palette.
 *
 * The style is sampled from a mermaid block inside the docs shadow
 * root, NOT documentElement: the docs page never sets a font on `html`,
 * so the root's computed `fontFamily` is the UA default (serif) while
 * the block inherits `.docs`'s `var(--font-primary)` and the rendered
 * content's real size.
 * @param style Computed style of a `.docs-mermaid` block.
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

  blocks.forEach((block, i) => {
    // Stash the source BEFORE the loader wipes textContent — the print
    // mirror re-renders from this attr with the paper theme no matter
    // which render state (pending/processing/done) the block is in.
    block.setAttribute(DATA_ATTRS.DOCS_MERMAID_SRC, sources[i])

    block.textContent = ''

    const loader = document.createElement('div')

    loader.className = DOCS_CLASSES.DOCS_MERMAID_LOADING

    loader.setAttribute(ARIA_ATTRS.ROLE, ARIA_ATTRS.ROLE_STATUS)

    loader.textContent = DOCS_STRINGS.MERMAID_LOADING

    block.appendChild(loader)
  })

  const theme = themeJson(getComputedStyle(blocks[0]))

  // Per-block render — the engine returns one `<svg>` string per source;
  // it lands via innerHTML exactly where mermaid's output used to. The
  // diagram-cost model (WebNN/GPU/wasm) predicts each render's ms — a
  // projected long-task diagram yields one turn first so the docs view
  // stays interactive between blocks.
  for (const [i, block] of blocks.entries()) {
    try {
      const cost = await predictDiagramCost(sources[i])

      if (cost != null && cost > ML.DIAGRAM_DEFER_MS) await yieldTask()

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

/**
 * Paper-palette theme JSON for `render_diagram` — the print mirror's
 * diagrams must read as press ink on paper, not the screen's
 * dark-on-dark scheme: foreground and lines go `--print-ink`, node
 * fills go `--print-paper`, and the accent stays the project accent
 * so colored highlights survive in grayscale-optional output. Colors
 * resolve from `documentElement` (the print vars are root-level token
 * declarations, resolvable outside print media).
 * @param style Computed style of the block — carries the doc's font.
 * @returns JSON string for the wasm theme argument.
 */
const printThemeJson = (style: CSSStyleDeclaration): string => {
  const root = getComputedStyle(document.documentElement)

  const v = (name: string): string => root.getPropertyValue(name).trim()

  return JSON.stringify({
    font: style.fontFamily || 'sans-serif',
    fontSize: parseFloat(style.fontSize) || FONT_SIZE_FALLBACK,
    fg: v(THEME_CSS_PROPS.PRINT_INK),
    bg: v(THEME_CSS_PROPS.PRINT_PAPER),
    line: v(THEME_CSS_PROPS.PRINT_INK),
    accent: v(THEME_CSS_PROPS.PRINT_INK),
    surface: v(THEME_CSS_PROPS.PRINT_PAPER),
  })
}

/**
 * Re-renders every `.docs-mermaid` block inside the print mirror with
 * the paper theme — the mirror clone carries either the screen-palette
 * SVG (processed blocks, source stashed in `data-mermaid-src`) or the
 * raw source text (a print fired mid-render), and neither belongs on
 * paper as-is. Blocks whose source can't render keep whatever they
 * cloned — the escaped source text still reads as documentation.
 * @param container The `article.reader-content` mirror (or clone) to
 *   upgrade in place.
 */
export const renderMermaidBlocksForPrint = async (container: HTMLElement): Promise<void> => {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>(DOCS_SELECTORS.MERMAID))

  const jobs = blocks.map(async (block) => {
    const source =
      block.getAttribute(DATA_ATTRS.DOCS_MERMAID_SRC) ?? block.textContent ?? ATTR_VALUES.EMPTY

    if (!source.trim()) return

    try {
      block.innerHTML = await renderDiagram(source, printThemeJson(getComputedStyle(block)))

      // Wider-than-portrait diagrams claim the rotated full-page slot —
      // stamped here, painted by the print sheet's quarter-turn rule.
      const svg = block.querySelector('svg')
      const vb = svg?.getAttribute('viewBox')?.trim().split(/\s+/)

      const wide =
        vb && vb.length === 4 && Number(vb[2]) > 0 && Number(vb[3]) > 0
          ? Number(vb[2]) / Number(vb[3]) > PRINT_ROTATE_RATIO
          : false

      if (wide) block.setAttribute(DATA_ATTRS.PRINT_ROTATE, ATTR_VALUES.EMPTY)
      else block.removeAttribute(DATA_ATTRS.PRINT_ROTATE)
    } catch (err) {
      devWarn('docs print mermaid block failed', err)
    }
  })

  await Promise.allSettled(jobs)
}
