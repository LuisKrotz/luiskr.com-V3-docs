/**
 * @file docs/tree-icon.tsx
 * @description Animated SVG row icons for the docs treeview — the
 * project-browser contract: directories draw an animated folder glyph
 * with a closed/open state plus a child-count badge and stacked-sheet
 * lines sized by how many entries sit inside; files draw a page glyph
 * keyed by EXTENSION (every extension gets its own deterministic
 * artwork — the ext tag inside the page plus a name-hash-independent
 * drifting thread — so all `.md` look alike and distinct from `.json`).
 * All strokes ride `currentColor`/`--sf`-style theme vars — no palette
 * literals; animation is declarative SMIL so no per-frame JS runs.
 */

import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import { h } from '@core/jsx.js'
import { hashName } from './folder-svg.js'
import type { DocsNode } from './manifest.js'

/** SVG viewport box shared by every row icon (unit-agnostic square). */
const VIEW_BOX = '0 0 24 24'

/**
 * One animated "paper" line inside a folder glyph — a dash-drifting
 * stroke whose phase comes from the name hash, so stacked sheets don't
 * pulse in lockstep. The sheet COUNT is the visible part of the
 * item-amount contract; this animates it.
 * @param seed Name hash — deterministic per folder.
 * @param idx Sheet index — staggers phase/duration.
 * @param y Baseline y of the sheet line.
 * @returns The animated <line> node.
 */
const sheet = (seed: number, idx: number, y: number): SVGElement => {
  const x1 = 7 + ((seed >> (idx * 2)) % 3)

  const x2 = 17 - ((seed >> (idx * 2 + 1)) % 3)

  const dur = (4 + ((seed >> (idx * 3)) % 5)).toFixed(1)

  return (
    <line
      className={DOCS_CLASSES.DOCS_FOLDER_THREAD}
      x1={x1}
      y1={y}
      x2={x2}
      y2={y}
      strokeDasharray="3 6"
    >
      <animate
        attributeName="stroke-dashoffset"
        from="0"
        to="18"
        dur={`${dur}s`}
        repeatCount="indefinite"
      />
    </line>
  ) as SVGElement
}

/**
 * Directory glyph — the Ignition-style folder: a back plate + tab when
 * closed, a gaped back plate + sheared front flap when open. Sheets
 * inside the mouth scale with children.length (capped) and a corner
 * badge carries the exact count, so fullness reads at a glance.
 * @param node The directory manifest node.
 * @param open Whether the branch is expanded in the treeview.
 * @returns The SVG subtree.
 */
const folderIcon = (node: DocsNode, open: boolean): SVGElement => {
  const seed = hashName(node.name)

  const count = node.children?.length ?? 0

  // Up to four sheet lines stand in for "amount inside"; the badge keeps
  // the exact figure for larger folders.
  const sheetCount = Math.min(count, 4)

  const sheets = []

  for (let i = 0; i < sheetCount; i++) sheets.push(sheet(seed, i, 12.4 + i * 1.6))

  return (
    <svg
      className={DOCS_CLASSES.DOCS_TREE_ICON}
      viewBox={VIEW_BOX}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Back plate + tab — open state ends the plate at the mouth so the
          sheared front flap reads as a folder swung open. */}
      {open ? (
        <path
          className={`${DOCS_CLASSES.DOCS_TREE_ICON}-body`}
          d="M3 6.5 Q3 5.5 4 5.5 L9.4 5.5 L11.4 7.5 L20 7.5 Q21 7.5 21 8.5 L21 10.5 L3 10.5 Z"
        />
      ) : (
        <path
          className={`${DOCS_CLASSES.DOCS_TREE_ICON}-body`}
          d="M3 6.5 Q3 5.5 4 5.5 L9.4 5.5 L11.4 7.5 L20 7.5 Q21 7.5 21 8.5 L21 18.5 Q21 19.5 20 19.5 L4 19.5 Q3 19.5 3 18.5 Z"
        />
      )}
      {open ? (
        <path
          className={`${DOCS_CLASSES.DOCS_TREE_ICON}-flap`}
          d="M3 19.5 L5.6 11.8 L22.4 11.8 L20 19.5 Z"
        />
      ) : null}
      {sheets}
      {count > 0 ? (
        <g className={DOCS_CLASSES.DOCS_TREE_COUNT}>
          <circle cx="18.5" cy="18.5" r="4.1" />
          <text x="18.5" y="20.6" textAnchor="middle">
            {count}
          </text>
        </g>
      ) : null}
    </svg>
  ) as SVGElement
}

/**
 * File glyph — a page with a folded corner, the extension tag inside
 * (uppercased, 4-glyph cap) and a thread whose dash/phase come from the
 * EXTENSION hash, so identical extensions share one deterministic
 * artwork and every extension reads as its own icon.
 * @param name File display name (the extension splits off the last dot).
 * @returns The SVG subtree.
 */
const fileIcon = (name: string): SVGElement => {
  const ext = name.includes(CHAR_STRINGS.DOT)
    ? name.split(CHAR_STRINGS.DOT).pop() || CHAR_STRINGS.EMPTY
    : CHAR_STRINGS.EMPTY

  const seed = hashName(ext || name)

  const y = 8.5 + (seed % 3)

  const c1y = 6 + (seed % 5)

  const c2y = 11 + (seed % 4)

  const dash = 20 + (seed % 40)

  const dur = (5 + (seed % 9)).toFixed(1)

  const d1 = `M8 ${y.toFixed(1)} C 10 ${c1y.toFixed(1)} 14 ${c2y.toFixed(1)} 16 ${y.toFixed(1)}`

  const d2 = `M8 ${(y + 1.2).toFixed(1)} C 10 ${c2y.toFixed(1)} 14 ${c1y.toFixed(1)} 16 ${(y - 1.2).toFixed(1)}`

  return (
    <svg
      className={DOCS_CLASSES.DOCS_TREE_ICON}
      viewBox={VIEW_BOX}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        className={`${DOCS_CLASSES.DOCS_TREE_ICON}-body`}
        d="M6.5 3.5 L13.5 3.5 L18.5 8.5 L18.5 20.5 L6.5 20.5 Z M13.5 3.5 L13.5 8.5 L18.5 8.5"
      />
      <path className={DOCS_CLASSES.DOCS_FOLDER_THREAD} d={d1} strokeDasharray={`${dash} ${dash}`}>
        <animate
          attributeName="d"
          values={`${d1};${d2};${d1}`}
          dur={`${dur}s`}
          repeatCount="indefinite"
        />
      </path>
      {ext ? (
        <text
          className={`${DOCS_CLASSES.DOCS_TREE_ICON}-ext`}
          x="12.5"
          y="18.4"
          textAnchor="middle"
        >
          {ext.slice(0, 4).toUpperCase()}
        </text>
      ) : null}
    </svg>
  ) as SVGElement
}

/**
 * The row icon for one manifest node — directories get the stateful
 * folder glyph, files the extension-keyed page glyph.
 * @param node The manifest node the row renders.
 * @param open Whether a directory row is expanded (file rows ignore it).
 * @returns The SVG subtree.
 */
export const treeIcon = (node: DocsNode, open: boolean): SVGElement =>
  node.type === 'dir' ? folderIcon(node, open) : fileIcon(node.name)
