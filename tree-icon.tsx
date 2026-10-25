/**
 * @file docs/tree-icon.tsx
 * @description Animated SVG row icons for the docs treeview — a real
 * icon pack, not a generic page + ext label.
 *
 * Folders draw the reference pack's gold wireframe: a rounded body with
 * a raised tab plateau on the LEFT (the macOS/Windows silhouette); when
 * the node has children they show as dog-eared paper — closed folders
 * stack a sheaf of pages above the body's right top edge, open folders
 * fan differently-inked sheets out of the mouth (capped by
 * DOCS_UNITS.TREE_SHEET_CAP_*) while the front flap swings forward. The
 * name hash seeds per-folder tilt/phase so no two folders look alike.
 *
 * Files draw the classic document page (folded top-right corner) in the
 * kind's ink, then the kind's own glyph inside it: bold typewriter
 * wordmarks for the letterform kinds (JS/TS/GO/PHP/C++/C#/…), the atom
 * for JSX/TSX, the snake for Python, cog+padlock for env, the zipper
 * for archives, shield emblems for HTML/CSS, the optical disc for dmg,
 * the rosette seal for license files, the beamed note and waveform for
 * audio — every glyph carrying its own SMIL motion (typewriter pulses,
 * spins, steam rises, zipper pulls, waveform scrolls, stamped arrows,
 * blinking cursors). All motion is declarative SMIL — zero per-frame JS.
 */

import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { DOCS_STRINGS, DOCS_UNITS } from '@core/tokens/strings/docs.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import { h } from '@core/jsx.js'
import type { DocsNode } from './manifest.js'

/** SVG viewport box shared by every row icon (unit-agnostic square). */
const VIEW_BOX = '0 0 24 24'

/** Shared part classes — stroked ink / filled ink / secondary-ink /
 *  on-tile detail / wordmark text. */
const L = DOCS_CLASSES.DOCS_ICON_LINE
const F = DOCS_CLASSES.DOCS_ICON_FILL
const ALT = DOCS_CLASSES.DOCS_ICON_ALT
const TXT = DOCS_CLASSES.DOCS_ICON_TEXT

/** Page shell + fold classes — stroked page, filled flap. */
const PAGE = DOCS_CLASSES.DOCS_ICON_PAGE

/**
 * Deterministic 32-bit-ish name hash — walks the string with a rolling
 * multiply-add; the modulus lives in DOCS_UNITS so the spread stays
 * tuned. Seeds every per-node art variance (paper fan, SMIL phase).
 */
export const hashName = (name: string): number => {
  let h = 0

  for (let i = 0; i < name.length; i++) {
    h = (h * 33 + name.charCodeAt(i)) % DOCS_UNITS.FOLDER_HASH_MOD
  }

  return h
}

/** Seconds-per-revolution etc. — art pacing, not layout. */
const sway = (dur: number, a: string, b: string): SVGElement =>
  (
    <animate
      attributeName="opacity"
      values={`${a};${b};${a}`}
      dur={`${dur}s`}
      repeatCount="indefinite"
    />
  ) as SVGElement

// ── Motion helpers — every glyph carries at least one authored loop ────

/**
 * Typing/draw-in — the path strokes itself on over the first stretch of
 * the loop, holds, then wipes before the next cycle. `pathLength="30"`
 * normalizes every letterform to the same dash unit so staggered
 * `begin` offsets read as characters being typed.
 * @param d Path data.
 * @param at Begin offset in seconds (stagger).
 * @param dur Loop duration in seconds.
 * @param cls Part class (defaults to stroked ink).
 * @returns The animated path.
 */
const draw = (d: string, at: number, dur: number, cls = L): SVGElement =>
  (
    <path className={cls} d={d} pathLength="30" stroke-dasharray="30">
      <animate
        attributeName="stroke-dashoffset"
        values="30;0;0;30"
        keyTimes="0;0.22;0.88;1"
        dur={`${dur}s`}
        begin={`${at}s`}
        repeatCount="indefinite"
      />
    </path>
  ) as SVGElement

/** Centered slow spin — `dur` seconds per revolution about (cx,cy). */
const spin = (dur: number, cx = 12, cy = 14): SVGElement =>
  (
    <animateTransform
      attributeName="transform"
      type="rotate"
      from={`0 ${cx} ${cy}`}
      to={`360 ${cx} ${cy}`}
      dur={`${dur}s`}
      repeatCount="indefinite"
    />
  ) as SVGElement

/**
 * Solid cog ring path — `teeth` rectangular teeth stepping out from the
 * valley radius to the outer radius, the silhouette the reference pack
 * draws for Rust/env gears (a real gear, not a dashed circle).
 * @param cx Center x. @param cy Center y.
 * @param rOut Tooth-tip radius. @param rIn Valley radius.
 * @param teeth Tooth count. @returns SVG path data.
 */
const cogPath = (cx: number, cy: number, rOut: number, rIn: number, teeth: number): string => {
  const step = (Math.PI * 2) / teeth

  const half = step * 0.24

  const pts: string[] = []

  for (let i = 0; i < teeth; i++) {
    const a = i * step

    const p = (r: number, ang: number) =>
      `${(cx + Math.cos(ang) * r).toFixed(2)} ${(cy + Math.sin(ang) * r).toFixed(2)}`

    pts.push(p(rIn, a - half * 1.7), p(rOut, a - half), p(rOut, a + half), p(rIn, a + half * 1.7))
  }

  return `M${pts.join(' L')} Z`
}

/** Gentle rotate wiggle — ±deg° about (cx,cy), looping. */
const wiggle = (deg: number, dur: number, cx = 12, cy = 14): SVGElement =>
  (
    <animateTransform
      attributeName="transform"
      type="rotate"
      values={`${-deg} ${cx} ${cy};${deg} ${cx} ${cy};${-deg} ${cx} ${cy}`}
      dur={`${dur}s`}
      repeatCount="indefinite"
    />
  ) as SVGElement

/** Rising-and-fading loop — steam, status dots, uplink marks. */
const riseFade = (dy: number, dur: number, at: number): SVGElement[] => [
  (
    <animateTransform
      attributeName="transform"
      type="translate"
      values={`0 0;0 ${dy}`}
      dur={`${dur}s`}
      begin={`${at}s`}
      repeatCount="indefinite"
    />
  ) as SVGElement,
  (
    <animate
      attributeName="opacity"
      values="0;1;1;0"
      keyTimes="0;0.2;0.7;1"
      dur={`${dur}s`}
      begin={`${at}s`}
      repeatCount="indefinite"
    />
  ) as SVGElement,
]

/**
 * Bold typewriter wordmark — the reference pack's letterform icons
 * (JS/TS/GO/PHP/C++/C#/…) are set in a heavy geometric sans filling
 * ~60% of the content width. One tspan per character, each looping a
 * deep opacity wave staggered a beat apart — each letter dims hard to
 * a low floor and brightens back, so the pulse travels left→right
 * across the word (a typewriter carriage sweep, clearly readable at
 * icon size); `seed` negative-phases the loop so sibling rows never
 * ripple in lockstep.
 * Sizing is geometric — translate + a
 * non-uniform `scale()` gives the sheet's condensed-bold look; the
 * font itself (family/size/weight) lives on the `-icon-text` SCSS
 * rule, never inline.
 * @param text The letters to set.
 * @param seed Name-hash SMIL phase.
 * @param sx Horizontal scale — condenses the glyph run (viewBox units).
 * @param sy Vertical scale — glyph height multiplier.
 * @param cx Wordmark center x. @param cy Baseline y.
 * @param dur Loop seconds.
 * @returns The text node.
 */
const word = (
  text: string,
  seed: number,
  sx: number,
  sy = 1,
  cx = 12,
  cy = 15.6,
  dur = 6.5
): SVGElement =>
  (
    <text
      className={TXT}
      transform={`translate(${cx} ${cy}) scale(${sx.toFixed(2)} ${sy.toFixed(2)})`}
      text-anchor="middle"
    >
      {[...text].map((ch, i) => (
        <tspan>
          {ch}
          <animate
            attributeName="opacity"
            values="0.15;1;1;0.15"
            keyTimes="0;0.1;0.85;1"
            dur={`${(dur + (seed % 3) / 2).toFixed(2)}s`}
            begin={`${(i * 0.4 - (seed % 60) / 10).toFixed(2)}s`}
            repeatCount="indefinite"
          />
        </tspan>
      ))}
    </text>
  ) as SVGElement

// ── Folders ──────────────────────────────────────────────────────────

/**
 * One paper sheet in the folder stack, drawn in the reference pack's
 * two distinct poses. CLOSED folders only show the sheet's top edge —
 * a thin rounded-rect strip peeking above the body behind the tab,
 * stacked 0.65 units apart with no printed marks. OPEN folders fan
 * taller sheets out of the mouth, each inked a different tone
 * (DOCS_TREE_PAPER_TONES by stack index) and rotated around its base;
 * the front sheet (i = 0, painted last) carries the bob.
 * @param seed Folder name hash.
 * @param i Sheet index — 0 is the front sheet nearest the mouth.
 * @param open Fanned pose while the folder is open.
 * @param top True for the front sheet — it gets the bob motion.
 * @returns The sheet node.
 */
const fx = (v: number): string => v.toFixed(2)

/**
 * Page-top strip — the reference pack's paper sheet: the two top
 * corners are gently rounded; the bottom edge sits below the folder
 * rim where the opaque front flap occludes it, so the sheet reads as
 * a page standing inside the folder.
 * @param x Left edge. @param y Top edge. @param w Width.
 * @param bot Bottom edge — occluded by the front flap's opaque fill.
 * @returns SVG path data.
 */
const sheetShape = (x: number, y: number, w: number, bot: number): string =>
  `M${fx(x)} ${fx(bot)} L${fx(x)} ${fx(y + 0.7)} Q${fx(x)} ${fx(y)} ${fx(x + 0.7)} ${fx(y)} ` +
  `L${fx(x + w - 0.7)} ${fx(y)} Q${fx(x + w)} ${fx(y)} ${fx(x + w)} ${fx(y + 0.7)} L${fx(x + w)} ${fx(bot)} Z`

const paperSheet = (
  seed: number,
  i: number,
  open: boolean,
  top: boolean,
  count: number
): SVGElement => {
  const tilt = ((seed >> (i * 3)) % 7) - 3

  if (!open) {
    // Closed sheaf — the reference's nested page tops tucked BEHIND the
    // back plate: painted before it so its opaque fill hides everything
    // below the silhouette — only the stepped tops rise above the rim.
    // i = 0 is the front (lowest, widest) sheet; each higher sheet
    // steps up and narrows on the right — the tidy card stack.
    const y = 9.7 - i * 0.85

    const x = 6.8 + i * 0.3 + tilt * 0.12

    const w = 11.5 - i * 0.7

    return (
      <path className={DOCS_CLASSES.DOCS_TREE_PAPER} d={sheetShape(x, y, w, 13.2)}>
        {top ? (
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 0;0 -0.55;0 0"
            dur={`${(3.6 + (seed % 30) / 10).toFixed(1)}s`}
            repeatCount="indefinite"
          />
        ) : null}
      </path>
    ) as SVGElement
  }

  // Open fan — the reference's "Folder with Files (Open)": differently-
  // inked tall pages (DOCS_TREE_PAPER_TONES) fanning up-LEFT out of the
  // mouth. i = 0 is the front-right (nearest, shortest) sheet; each
  // card behind it steps up-left and leans a touch further. Pages are
  // narrow (w ≈ 4.6–5.1) so their edges stay distinct, and left edges
  // spread evenly between ~5 (tallest back page) and ~13 (front page)
  // so even a two-file folder reads as two separate pages, not a blob;
  // a lone sheet centres over the mouth.
  const spread = count > 1 ? Math.min(8 / (count - 1), 2.7) : 0

  const x = (count === 1 ? 10.5 : 13 - i * spread) + tilt * 0.15

  const y = 5.6 - i * 0.7

  const w = 4.6 + i * 0.15

  const fan = 1 - i * 1.6 + tilt * 0.3

  const tone = DOCS_CLASSES.DOCS_TREE_PAPER_TONES[i % DOCS_CLASSES.DOCS_TREE_PAPER_TONES.length]

  return (
    <g transform={`rotate(${fan.toFixed(1)} ${(x + w / 2).toFixed(1)} 13.6)`}>
      <path className={`${DOCS_CLASSES.DOCS_TREE_PAPER} ${tone}`} d={sheetShape(x, y, w, 13.8)} />
      {top ? (
        <animateTransform
          attributeName="transform"
          type="translate"
          additive="sum"
          values="0 0;0 -0.55;0 0"
          dur={`${(3.2 + (seed % 30) / 10).toFixed(1)}s`}
          repeatCount="indefinite"
        />
      ) : null}
    </g>
  ) as SVGElement
}

/**
 * macOS/Windows-style folder silhouette — the raised left tab and the
 * rounded body are what make the glyph read as a folder at row size.
 * Closed folders get a full body with the front-face seam; open folders
 * truncate the back plate at the mouth and swing the front flap
 * forward — a trapezoid whose bottom edge is wider than the top, the
 * perspective cue of a cover leaning toward the viewer.
 */
/**
 * Rim-light glint — the reference pack's traveling shine: a short bright
 * segment orbiting the icon's outer outline (a dash comet driven by
 * `stroke-dashoffset` along the normalized `pathLength`), seed-phased
 * so sibling icons never gleam in lockstep. Painted last so the light
 * lands ON the silhouette over every fill.
 * @param d The perimeter path the light travels.
 * @param seed Name hash — phases the loop period + start offset.
 * @returns The animated glint overlay path.
 */
const rimGlint = (d: string, seed: number): SVGElement =>
  (
    <path className={DOCS_CLASSES.DOCS_ICON_GLINT} d={d} pathLength="100" stroke-dasharray="7 93">
      <animate
        attributeName="stroke-dashoffset"
        values="0;-100"
        dur={`${(8 + (seed % 50) / 10).toFixed(1)}s`}
        begin={`${(-(seed % 80) / 10).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>
  ) as SVGElement

/**
 * Closed-folder BACK PLATE — the taller rear wall of the reference
 * pack's two-piece silhouette: the left side rises straight to the tab
 * plateau (~30% of the width), an angled shoulder slopes down-right to
 * the back top edge, and the right wall drops toward the seam. Its
 * lower half hides behind the front flap's opaque fill.
 */
const FOLDER_BACK =
  'M4.4 19.2 L4.4 8.7 Q4.4 7.7 5.4 7.7 L9.4 7.7 L11.8 10.4 L17.3 10.4 Q18.3 10.4 18.3 11.4 L18.3 19.2 Z'

/**
 * Closed-folder FRONT FLAP — the wide rounded panel overlapping the
 * back plate's lower half; its top edge is the full-width seam the
 * reference prints as the flap/body junction, and it juts past the
 * back wall on the right (the reference's little step). Opaque fill
 * tucks the paper sheets' bottoms away behind it.
 */
const FOLDER_FLAP =
  'M4.4 19.4 L4.4 13.5 Q4.4 12.5 5.4 12.5 L19.5 12.5 Q20.6 12.5 20.6 13.6 L20.6 18.3 Q20.6 19.4 19.5 19.4 Z'

/** Open folder's back plate — the same rear wall as the closed state,
 *  drawn only down to the mouth line: left wall, tab plateau, shoulder,
 *  and right top edge peek above the swung-forward flap. */
const FOLDER_BACK_OPEN =
  'M4.4 12.4 L4.4 8.7 Q4.4 7.7 5.4 7.7 L9.4 7.7 L11.8 10.4 L17.3 10.4 Q18.3 10.4 18.3 11.4 L18.3 12.4'

/** Open folder — the cover swung all the way forward: a trapezoid
 *  splayed wider at the bottom (the reference's lean-toward-the-viewer
 *  perspective) in front of the back plate's rim. */
const FOLDER_FLAP_OPEN = 'M5.2 12.4 L19.8 12.4 L22.3 19.4 L1.7 19.4 Z'

/**
 * Directory glyph — the reference pack's two-piece wireframe: the
 * closed folder is a tall back plate (left tab + shoulder) overlapped
 * by a wider opaque front flap; the open folder is the flap alone as a
 * forward-leaning trapezoid plus the back wall's left-corner stub.
 * Children show as paper drawn BETWEEN back wall and flap — closed
 * folders stack nested page tops rising above the back edge, open
 * folders fan colored sheets out of the mouth; counts cap at the
 * TREE_SHEET_CAP_* unit tokens and every sheet's fill is opaque so the
 * pile nests and the flap occludes it like the reference. The open
 * flap plays a one-shot swing on mount.
 * @param node The directory manifest node.
 * @param open Whether the branch is expanded in the treeview.
 * @returns The SVG subtree.
 */
const folderIcon = (node: DocsNode, open: boolean): SVGElement => {
  const seed = hashName(node.name)

  const count = node.children?.length ?? 0

  const sheetCount = Math.min(
    count,
    open ? DOCS_UNITS.TREE_SHEET_CAP_OPEN : DOCS_UNITS.TREE_SHEET_CAP_CLOSED
  )

  const papers = []

  // Back sheets paint first; the front sheet (i = 0) lands last in the
  // pile and carries the bob.
  for (let i = sheetCount - 1; i >= 0; i--) {
    papers.push(paperSheet(seed, i, open, i === 0, sheetCount))
  }

  return (
    <svg
      className={`${DOCS_CLASSES.DOCS_TREE_ICON} ${DOCS_CLASSES.DOCS_TREE_ICON}--${DOCS_CLASSES.DOCS_ICON_KINDS.FOLDER}`}
      viewBox={VIEW_BOX}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      {open
        ? [
            <path className={`${DOCS_CLASSES.DOCS_TREE_ICON}-body`} d={FOLDER_BACK_OPEN} />,
            ...papers,
            <path className={`${DOCS_CLASSES.DOCS_TREE_ICON}-flap`} d={FOLDER_FLAP_OPEN} />,
          ]
        : [
            ...papers,
            <path className={`${DOCS_CLASSES.DOCS_TREE_ICON}-body`} d={FOLDER_BACK} />,
            <path className={`${DOCS_CLASSES.DOCS_TREE_ICON}-body`} d={FOLDER_FLAP} />,
          ]}
    </svg>
  ) as SVGElement
}

// ── Shared file page — folded-corner silhouette + diagonal sheen ──────

/** Document page outline — the universal file shell (24 viewport),
 *  corners rounded like the reference pack's paper pages. */
const PAGE_BODY =
  'M5.6 19.5 L5.6 4.5 Q5.6 3.1 7 3.1 L13.7 3.1 L18.4 7.8 L18.4 19.5 Q18.4 20.9 17 20.9 L7 20.9 Q5.6 20.9 5.6 19.5 Z'

/** Fold seam — the top-left edge of the folded corner triangle. */
const PAGE_FOLD = 'M13.7 3.1 L13.7 7.8 L18.4 7.8'

/** Fold flap fill — the small triangle turned over the page corner. */
const PAGE_FOLD_FILL = 'M13.7 3.1 L13.7 7.8 L18.4 7.8 Z'

/**
 * kind → SVG subtree painter. Each value draws that filetype's own
 * glyph INSIDE the shared page silhouette (content zone ≈ x7–17.5,
 * y8.5–19); `seed` (name hash) phases each glyph's SMIL motion so
 * sibling rows never animate in lockstep.
 */
const KIND_ART: Record<string, (seed: number) => unknown[]> = {
  /** TypeScript — the bold TS wordmark plus a blinking block cursor
   *  riding its right edge (the editor caret pulse). */
  ts: (s) => [
    word('TS', s, 0.78),
    <rect className={F} x="15.9" y="11" width="1.7" height="5" stroke="none">
      {sway(0.9 + (s % 20) / 20, '1', '0')}
    </rect>,
  ],
  /** JavaScript — the bold JS wordmark plus a blinking underscore
   *  cursor parked at its baseline (the REPL prompt pulse). */
  js: (s) => [
    word('JS', s, 0.78),
    <path className={L} d="M15.8 17.6 h2.2">
      {sway(0.9 + (s % 20) / 20, '1', '0.05')}
    </path>,
  ],
  /** Python — the two-tone snake: blue upper lobe, yellow lower lobe
   *  (`-icon-alt` inks it from --icon-ink2), eye dots, gentle rock. */
  py: (s) => [
    <g>
      <path
        className={L}
        d="M8.6 10.4 c0-1.4 1.1-2.5 2.5-2.5 h1.8 c1.4 0 2.5 1.1 2.5 2.5 v1.8 h-4.4"
      />
      <path
        className={ALT}
        d="M15.4 17.6 c0 1.4-1.1 2.5-2.5 2.5 h-1.8 c-1.4 0-2.5-1.1-2.5-2.5 v-1.8 h4.4"
      />
      <circle className={F} cx="9.7" cy="9.3" r="0.55" stroke="none" />
      <circle className={F} cx="14.3" cy="18.7" r="0.55" stroke="none" />
      {wiggle(5, 4.5 + (s % 4))}
    </g>,
  ],
  /** JSX/TSX/React — the atom: three orbitals, each in its own
   *  precessing plane (different rates → the electron-orbit weave),
   *  nucleus pulsing in the middle. */
  atom: (s) => [
    <g className={L}>
      <ellipse cx="12" cy="14" rx="5.6" ry="2.1" />
      {spin(4.5 + (s % 3), 12, 14)}
    </g>,
    <g transform="rotate(60 12 14)">
      <g className={L}>
        <ellipse cx="12" cy="14" rx="5.6" ry="2.1" />
        {spin(6 + (s % 3), 12, 14)}
      </g>
    </g>,
    <g transform="rotate(120 12 14)">
      <g className={L}>
        <ellipse cx="12" cy="14" rx="5.6" ry="2.1" />
        {spin(7.5 + (s % 2), 12, 14)}
      </g>
    </g>,
    <circle className={F} cx="12" cy="14" r="1.05">
      <animate
        attributeName="r"
        values="1.05;1.45;1.05"
        dur={`${(3 + (s % 3)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </circle>,
  ],
  /** Rust — the serrated cog ring spinning around the bold R. */
  rs: (s) => [
    <g className={L}>
      <path d={cogPath(12, 14, 5.1, 4.3, 16)} />
      <circle cx="12" cy="14" r="3.5" />
      {spin(4.5 + (s % 2), 12, 14)}
    </g>,
    word('R', s, 0.85, 1, 12, 16.4),
  ],
  /** Go — the GO wordmark, speed lines streaming in from the left. */
  go: (s) => [
    draw('M5.5 11.9 h2', 0, 6 + (s % 3)),
    draw('M5.5 14.2 h2', 0.35, 6 + (s % 3)),
    draw('M5.5 16.5 h2', 0.7, 6 + (s % 3)),
    word('GO', s, 0.82, 1, 13.9),
  ],
  /** Java — the coffee cup filling the page: handle right, saucer
   *  line below, two steam wisps rising and fading above. */
  java: (s) => [
    <path className={L} d="M8.3 11.8 h7.5 l-.95 5 q-.3 1.3-1.5 1.3 h-2.6 q-1.2 0-1.5-1.3 z" />,
    <path className={L} d="M15.8 12.9 q2.7.2 2.7 1.8 t-2.7 1.8" />,
    <path className={L} d="M7.3 19.5 h9.8" />,
    <path className={L} d="M10.1 8.1 c-.95 1.05.95 1.5 0 2.55">
      {riseFade(-1.5, 2.6 + (s % 3) / 2, 0)}
    </path>,
    <path className={L} d="M13.4 8.1 c-.95 1.05.95 1.5 0 2.55">
      {riseFade(-1.5, 2.6 + (s % 2), 0.8)}
    </path>,
  ],
  /** C++ — the bold C++ wordmark with a twinkling increment tick —
   *  a small `+` spark flashing at the page's upper right. */
  cpp: (s) => [
    word('C++', s, 0.62),
    <path className={L} d="M15.9 9.7 h1.9 M16.85 8.75 v1.9">
      {sway(1.5 + (s % 20) / 20, '0.1', '1')}
    </path>,
  ],
  /** C# — the bold C# wordmark with a scan block sweeping back and
   *  forth on the underline track below it (a compile-progress beat). */
  cs: (s) => [
    word('C#', s, 0.8),
    <rect className={F} x="8" y="17.9" width="1.9" height="0.75" stroke="none">
      <animate
        attributeName="x"
        values="7.8;14.3;14.3;7.8"
        keyTimes="0;0.7;0.85;1"
        dur={`${(2.4 + (s % 20) / 20).toFixed(2)}s`}
        repeatCount="indefinite"
      />
    </rect>,
  ],
  /** PHP — the bold PHP wordmark flanked by the `<? … ?>` tag's angle
   *  brackets, breathing apart on a slow loop. */
  php: (s) => [
    word('PHP', s, 0.6),
    <path className={L} d="M7.9 11 L6.6 14 L7.9 17">
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;-0.6 0;0 0"
        dur={`${(3 + (s % 4)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
    <path className={L} d="M16.1 11 L17.4 14 L16.1 17">
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;0.6 0;0 0"
        dur={`${(3 + (s % 4)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
  ],
  /** Ruby — the faceted gem: flat crown, pointed pavilion, facet
   *  lines, and a twinkle at the top-right corner. */
  rb: (s) => [
    <path className={L} d="M8.5 9.7 h7 L17.5 12.4 12 18.7 6.5 12.4 Z" />,
    <path
      className={L}
      d="M8.5 9.7 L10.3 12.4 12 18.7 M15.5 9.7 L13.7 12.4 12 18.7 M6.5 12.4 h11"
    />,
    <path
      className={F}
      d="M16.9 8.5 l.5 1.2 1.2 .5 -1.2 .5 -.5 1.2 -.5-1.2 -1.2-.5 1.2-.5 z"
      stroke="none"
    >
      {sway(2.2 + (s % 3), '1', '0.15')}
    </path>,
  ],
  /** SQL/database — the stacked cylinder: top ellipse, two ring
   *  lines, body; a scan band sweeping down through it. */
  sql: (s) => [
    <path className={L} d="M8 10.6 a4 1.5 0 0 0 8 0 a4 1.5 0 0 0-8 0" />,
    <path
      className={L}
      d="M8 10.6 v5.8 a4 1.5 0 0 0 8 0 v-5.8 M8 13.2 a4 1.5 0 0 0 8 0 M8 15.6 a4 1.5 0 0 0 8 0"
    />,
    <rect className={F} x="8.4" y="11.9" width="7.2" height="0.75" stroke="none">
      <animate
        attributeName="y"
        values="11.9;15.2;11.9"
        dur={`${(4 + (s % 4)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </rect>,
  ],
  /** JSON — the curly-brace pair redrawing itself on a staggered loop
   *  while the `"key":value` colon blinks between them in alternating
   *  dots — the structured-data pulse. */
  json: (s) => [
    draw(
      'M10.8 8.8 c-1.6 0-2.4.8-2.4 2.2 v1.7 c0 1.2-.8 1.9-2 1.9 1.2 0 2 .7 2 1.9 v1.7 c0 1.4.8 2.2 2.4 2.2',
      0,
      6.5 + (s % 3)
    ),
    draw(
      'M13.2 8.8 c1.6 0 2.4.8 2.4 2.2 v1.7 c0 1.2.8 1.9 2 1.9 -1.2 0-2 .7-2 1.9 v1.7 c0 1.4-.8 2.2-2.4 2.2',
      0.5,
      6.5 + (s % 3)
    ),
    <circle className={F} cx="12" cy="12.6" r="0.62" stroke="none">
      {sway(2.4 + (s % 20) / 20, '1', '0.12')}
    </circle>,
    <circle className={F} cx="12" cy="15.4" r="0.62" stroke="none">
      {sway(2.4 + (s % 20) / 20, '0.12', '1')}
    </circle>,
  ],
  /** Sass — the ribbon S with the underline swash, drawn live. */
  sass: (s) => [
    <path
      className={L}
      d="M16.6 8.2 C13.6 6.4 8.4 7.4 7.9 10.8 c-.5 3.2 4.6 3.9 4.6 6.8 0 2.5-3.6 3.3-6.2 1.7"
      stroke-dasharray="30 30"
    >
      <animate
        attributeName="stroke-dashoffset"
        from="0"
        to="60"
        dur={`${(6 + (s % 6)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
    <path className={L} d="M5.5 14.2 C9 16.6 15.2 17 18.6 13.6" />,
  ],
  /** CSS — the shield emblem: tiny "CSS" wordmark above the shield's
   *  top band, the big "3" numeral inside it, and a single dot that
   *  cascades down the shield's left interior in discrete steps —
   *  the stylesheet's cascade made literal. */
  css: (s) => [
    word('CSS', s, 0.42, 0.42, 12, 9.9),
    <path className={L} d="M8.4 10.7 h7.2 l-.6 7.5 L12 19.3 9 18.2 Z" />,
    word('3', s, 0.9, 1.15, 12, 16.9),
    <circle className={F} cx="9.6" cy="11.9" r="0.55" stroke="none">
      <animate
        attributeName="cy"
        values="11.9;14;16.1"
        calcMode="discrete"
        dur={`${(1.8 + (s % 20) / 20).toFixed(2)}s`}
        repeatCount="indefinite"
      />
      <animate
        attributeName="opacity"
        values="1;0.75;0.4"
        calcMode="discrete"
        dur={`${(1.8 + (s % 20) / 20).toFixed(2)}s`}
        repeatCount="indefinite"
      />
    </circle>,
  ],
  /** HTML — the same shield emblem: tiny "HTML" wordmark above the
   *  top band, the big "5" numeral inside it, and a row of browser
   *  chrome dots blinking in sequence across the shield's top band. */
  html: (s) => [
    word('HTML', s, 0.38, 0.4, 12, 9.9),
    <path className={L} d="M8.4 10.7 h7.2 l-.6 7.5 L12 19.3 9 18.2 Z" />,
    word('5', s, 0.9, 1.15, 12, 16.9),
    <circle className={F} cx="9.3" cy="12" r="0.5" stroke="none">
      <animate
        attributeName="opacity"
        values="0.15;1;0.15"
        dur="2.1s"
        begin="0s"
        repeatCount="indefinite"
      />
    </circle>,
    <circle className={F} cx="10.8" cy="12" r="0.5" stroke="none">
      <animate
        attributeName="opacity"
        values="0.15;1;0.15"
        dur="2.1s"
        begin="0.4s"
        repeatCount="indefinite"
      />
    </circle>,
    <circle className={F} cx="12.3" cy="12" r="0.5" stroke="none">
      <animate
        attributeName="opacity"
        values="0.15;1;0.15"
        dur="2.1s"
        begin="0.8s"
        repeatCount="indefinite"
      />
    </circle>,
  ],
  /** XML — `<xml>`: breathing angle brackets around the wordmark. */
  xml: (s) => [
    <path className={L} d="M8.2 10.6 L6.4 13.4 L8.2 16.2">
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;-0.85 0;0 0"
        dur={`${(3.2 + (s % 4)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
    <path className={L} d="M15.8 10.6 L17.6 13.4 L15.8 16.2">
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;0.85 0;0 0"
        dur={`${(3.2 + (s % 4)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
    word('xml', s, 0.58, 0.82, 12, 15.3),
  ],
  /** Markdown — the bold M beside a down-arrow that plunges into place
   *  on a brisk stamp loop: raised, dropped, held, reset — the M↓ mark
   *  given a readable download beat. */
  md: (s) => [
    word('M', s, 1.05, 1, 10.1),
    <g className={L}>
      <path d="M15.7 10.2 v5.6 M14.2 14 l1.5 2 1.5-2" />
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 -1.6;0 0.9;0 0.9;0 -1.6"
        keyTimes="0;0.3;0.6;1"
        dur={`${(1.7 + (s % 20) / 20).toFixed(2)}s`}
        repeatCount="indefinite"
      />
    </g>,
  ],
  /** Raster image — frame + sun + mountain line; the sun radiates on
   *  a clear pulse. */
  img: () => [
    <rect className={L} x="6.8" y="9.6" width="10.4" height="8.6" rx="1.3" />,
    <circle className={F} cx="10.1" cy="12.2" r="1.2">
      <animate attributeName="r" values="1.2;1.75;1.2" dur="3.4s" repeatCount="indefinite" />
    </circle>,
    <path className={L} d="M7.3 16.2 L10.6 13 L12.9 15.2 L14.6 13.7 L16.8 16.2" />,
  ],
  /** Photo (jpg) — the same landscape frame but carrying the little
   *  camera glyph bottom-right: the lens iris contracts and opens on
   *  a loop, an aperture breathing (the sheet's jpg). */
  photo: (s) => [
    <rect className={L} x="6.8" y="9.6" width="10.4" height="8.6" rx="1.3" />,
    <path className={L} d="M7.3 16.2 L10.2 13.4 L12.2 15.2 L13.4 14.2" />,
    <g className={L}>
      <path d="M13.4 12.2 l.5-.9 h1.6 l.5.9" />
      <rect x="13.2" y="12.2" width="4" height="3" rx="0.7" />
      <circle cx="15.2" cy="13.7" r="0.9">
        <animate
          attributeName="r"
          values="0.9;0.45;0.9"
          dur={`${(2.2 + (s % 3)).toFixed(1)}s`}
          repeatCount="indefinite"
        />
      </circle>
    </g>,
  ],
  /** GIF — the rounded box on two little feet, the GIF wordmark
   *  strobing inside while a frame square hops left→right across the
   *  top of the box in discrete steps — cycling frames. */
  gif: (s) => [
    <rect className={L} x="6.8" y="10.1" width="10.4" height="7.5" rx="1.3" />,
    <path className={L} d="M9.3 19.8 v-1.6 M14.7 19.8 v-1.6" />,
    word('GIF', s, 0.5, 0.72, 12, 15.8),
    <rect className={F} x="8.2" y="11.3" width="1.3" height="1.3" stroke="none">
      <animate
        attributeName="x"
        values="8.2;11.3;14.4"
        calcMode="discrete"
        dur={`${(2.1 + (s % 20) / 20).toFixed(2)}s`}
        repeatCount="indefinite"
      />
    </rect>,
  ],
  /** Vector file — the pen-tool mark: anchor squares at the ends of a
   *  sagging bezier, handles wiggling wide, the nib hanging below
   *  center and bobbing as it inks the curve. */
  vec: (s) => [
    <path className={L} d="M7.8 10.3 C9.2 13.6 14.8 13.6 16.2 10.3" />,
    <g className={L}>
      <rect x="6.1" y="9.4" width="1.7" height="1.7" />
      <rect x="16.2" y="9.4" width="1.7" height="1.7" />
      <path d="M6.9 9.4 L5.7 8.1 M17.1 9.4 L18.3 8.1" />
      {wiggle(4.5, 4 + (s % 3), 12, 10.3)}
    </g>,
    <g className={L}>
      <path d="M12 13.6 L13.8 17.6 12 19.2 10.2 17.6 Z" />
      <path d="M12 15.4 v2.2" />
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;0 -0.7;0 0"
        dur={`${(2.8 + (s % 3)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </g>,
  ],
  /** YAML — the {YML} mark: breathing braces around the wordmark. */
  yml: (s) => [
    <path
      className={L}
      d="M8.6 9.4 q-1.7.1-1.7 1.7 v1.1 q-.1 1-1.2 1.1 1.1.1 1.2 1.1 v1.1 q0 1.6 1.7 1.7"
    >
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;-0.9 0;0 0"
        dur={`${(3.6 + (s % 4)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
    <path
      className={L}
      d="M15.4 9.4 q1.7.1 1.7 1.7 v1.1 q.1 1 1.2 1.1 -1.1.1-1.2 1.1 v1.1 q0 1.6-1.7 1.7"
    >
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;0.9 0;0 0"
        dur={`${(3.6 + (s % 4)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
    word('YML', s, 0.5, 0.8, 12, 15.1),
  ],
  /** Config/env — the toothed cog turning slowly, a small padlock
   *  guarding its bottom-right corner (the sheet's .env mark). */
  conf: (s) => [
    <g className={L}>
      <path d={cogPath(10.9, 13.1, 4.2, 3.2, 9)} />
      <circle cx="10.9" cy="13.1" r="1.6" />
      {spin(9 + (s % 3), 10.9, 13.1)}
    </g>,
    <path className={L} d="M15.7 16.6 v-1.1 a1.15 1.15 0 0 1 2.3 0 v1.1" />,
    <rect className={L} x="14.7" y="16.6" width="4.3" height="3.3" rx="0.7" />,
  ],
  /** Lockfile — padlock, the shackle swaying gently. */
  lock: () => [
    <path className={L} d="M9.9 12.4 v-2.1 a2.1 2.1 0 0 1 4.2 0 v2.1">
      <animateTransform
        attributeName="transform"
        type="rotate"
        values="-5 12 10.4;5 12 10.4;-5 12 10.4"
        dur="5.5s"
        repeatCount="indefinite"
      />
    </path>,
    <rect className={L} x="8.4" y="12.4" width="7.2" height="6.2" rx="1.4" />,
    <circle className={F} cx="12" cy="15.1" r="0.9" />,
    <path className={L} d="M12 16 v1.3" />,
  ],
  /** Font files — the large light 'A' (font-weight drops to 300 via
   *  the --font kind's -icon-text override in the SCSS) over a metrics
   *  baseline guide that draws itself on in a loop. */
  font: (s) => [word('A', s, 1.1, 1.55, 12, 18.6), draw('M7.4 19.8 h9.2', 0, 7 + (s % 3))],
  /** WASM — the hexagonal crate + inner diamond, slow spin. */
  wasm: () => [
    <g className={L}>
      <path d="M12 8.2 L16.9 11 V17 L12 19.8 L7.1 17 V11 Z" />
      <path d="M12 11.6 L14 14 L12 16.4 L10 14 Z" />
      {spin(12)}
    </g>,
  ],
  /** Test/spec files — the flask with rising bubbles. */
  test: (s) => [
    <path
      className={L}
      d="M10.4 9.2 h3.2 M11 9.2 v3.4 L8.6 16.9 a1.3 1.3 0 0 0 1.1 1.9 h4.6 a1.3 1.3 0 0 0 1.1-1.9 L13 12.6 V9.2"
    />,
    <path className={L} d="M9.3 15.2 h5.4" />,
    <circle className={F} cx="10.9" cy="17.5" r="0.7">
      <animate
        attributeName="cy"
        values="17.5;15.7;17.5"
        dur={`${(3 + (s % 3)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </circle>,
    <circle className={F} cx="13.2" cy="17.2" r="0.55">
      <animate
        attributeName="cy"
        values="17.2;15.9;17.2"
        dur={`${(3.6 + (s % 2)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </circle>,
  ],
  /** License/notice — the rosette seal + ribbon tails: a scalloped
   *  (dashed) outer ring rotating like a notary stamp, the medallion
   *  heart pulsing, and the ribbon tails swinging on a pendulum wiggle
   *  pivoted at the seal's center. */
  cert: (s) => [
    <g className={L}>
      <circle cx="12" cy="11.4" r="3.5" stroke-dasharray="1.5 1.05" />
      {spin(15 + (s % 5), 12, 11.4)}
    </g>,
    <circle className={L} cx="12" cy="11.4" r="2" />,
    <circle className={F} cx="12" cy="11.4" r="0.9" stroke="none">
      <animate
        attributeName="r"
        values="0.9;1.25;0.9"
        dur={`${(2.8 + (s % 3)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </circle>,
    <g className={L}>
      <path d="M10.2 14.1 L9.2 19.4 L12 18 L14.8 19.4 L13.8 14.1" />
      {wiggle(5, 4.2 + (s % 3), 12, 11.4)}
    </g>,
  ],
  /** Archives — the vertical zipper filling the page: two columns of
   *  interlocking teeth down the seam, the slider body + pull tab
   *  riding up and down on a loop. */
  archive: (s) => [
    <path className={L} d="M11.3 8.3 V19.7" stroke-dasharray="1.05 0.6" />,
    <path className={L} d="M12.7 9.1 V19.7" stroke-dasharray="1.05 0.6" />,
    <g className={L}>
      <rect x="10.7" y="13.2" width="2.6" height="3" rx="0.6" />
      <path d="M12 16.2 v1.6" />
      <rect x="11.3" y="17.6" width="1.4" height="1.6" rx="0.5" />
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;0 -4.8;0 -4.8;0 0"
        keyTimes="0;0.5;0.7;1"
        dur={`${(4.5 + (s % 4)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </g>,
  ],
  /** Shell scripts — the bare `>_` prompt: a chevron that draws on,
   *  the underscore cursor blinking beside it. */
  shell: (s) => [
    draw('M8 10.4 l4.4 3.5 -4.4 3.5', 0, 6.5 + (s % 3)),
    <path className={L} d="M13 17.2 h4.4">
      {sway(1.1 + (s % 20) / 20, '1', '0.1')}
    </path>,
  ],
  /** Executables — the little window frame: title bar, two chrome
   *  dots, the tiny "exec" wordmark inside and a blinking cursor. */
  exe: (s) => [
    <rect className={L} x="6.8" y="9" width="10.4" height="9.8" rx="1.4" />,
    <path className={L} d="M6.8 11.2 h10.4" />,
    <circle className={F} cx="8.3" cy="10.1" r="0.42" />,
    <circle className={F} cx="9.6" cy="10.1" r="0.42" />,
    word('exec', s, 0.48, 0.58, 11.9, 15.9),
    <rect className={F} x="15.5" y="15.4" width="1.3" height="1" stroke="none">
      {sway(1.1 + (s % 20) / 20, '1', '0.1')}
    </rect>,
  ],
  /** Disk images — a page-within-page: the small centered document
   *  outline carrying a slowly spinning optical disc on its face. */
  dmg: (s) => [
    <path className={L} d="M8.9 19.6 V9.4 h3.9 l2.1 2.1 v8.1 z" />,
    <path className={L} d="M12.8 9.4 v2.1 h2.1" />,
    <g className={L}>
      <circle cx="11.9" cy="15.4" r="2.9" stroke-dasharray="1.9 1.3" />
      <circle cx="11.9" cy="15.4" r="1.35" />
      <circle cx="11.9" cy="15.4" r="0.45" />
      {spin(5 + (s % 2), 11.9, 15.4)}
    </g>,
  ],
  /** Video/mp4 — the film frame with sprocket holes top and bottom,
   *  the pulsing play triangle inside, and a playhead scrubbing along
   *  the bottom edge then rewinding (the reference's mp4 mark). */
  video: (s) => [
    <rect className={L} x="6.8" y="9.4" width="10.4" height="9.6" rx="1.4" />,
    <path className={L} d="M7.6 11.6 h8.8" stroke-dasharray="1.1 1.9" />,
    <path className={L} d="M7.6 16.8 h8.8" stroke-dasharray="1.1 1.9" />,
    <path className={L} d="M10.4 12.4 L14.2 14.2 L10.4 16 Z">
      {sway(2.6 + (s % 3), '1', '0.55')}
    </path>,
    <rect className={F} x="7.4" y="17.7" width="1.5" height="0.6" stroke="none">
      <animate
        attributeName="x"
        values="7.4;15.2;15.2;7.4"
        keyTimes="0;0.7;0.85;1"
        dur={`${(3 + (s % 20) / 20).toFixed(2)}s`}
        repeatCount="indefinite"
      />
    </rect>,
  ],
  /** QuickTime/mov — the video camera: rounded body with the play
   *  triangle inside, a blinking REC dot at its top-left, and the lens
   *  horn trapezoid on the right. */
  cam: (s) => [
    <rect className={L} x="6.7" y="10.9" width="7.6" height="5.9" rx="1.3" />,
    <path className={L} d="M14.3 12.5 L17.5 10.6 v6.3 L14.3 15.2" />,
    <path className={F} d="M9.1 12.6 l3 1.45-3 1.45 z" stroke="none">
      {sway(2.2 + (s % 20) / 20, '1', '0.5')}
    </path>,
    <circle className={F} cx="8.4" cy="12.2" r="0.5" stroke="none">
      {sway(1.05 + (s % 20) / 20, '1', '0.05')}
    </circle>,
  ],
  /** Audio — a single continuous waveform (zigzag spikes, tall in
   *  the middle) drawn as a dashed line scrolling along itself. */
  audio: (s) => [
    <path
      className={L}
      d="M6.7 14.3 h1.1 l.9-2.3.9 5.2.95-8.9.9 7.7.9-4.7.85 2.7 h1.45"
      stroke-dasharray="2.2 1.4"
    >
      <animate
        attributeName="stroke-dashoffset"
        values="0;-3.6"
        dur={`${(1.6 + (s % 4) / 4).toFixed(2)}s`}
        repeatCount="indefinite"
      />
    </path>,
  ],
  /** Music files — the double beamed eighth-note (two heads, two
   *  stems, one beam) bobbing on the beat (mp3/m4a/flac/aac). */
  note: (s) => [
    <g className={L}>
      <ellipse cx="8.7" cy="16.3" rx="1.3" ry="1.05" />
      <ellipse cx="14.9" cy="15.5" rx="1.3" ry="1.05" />
      <path d="M10 16.3 V9.1 M16.2 15.5 V8.5" />
      <path className={F} d="M10 9.1 L16.2 8.5 v1.6 L10 10.7 Z" stroke="none" />
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;0 -1.3;0 0"
        dur={`${(2.2 + (s % 3)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </g>,
  ],
  /** Webpage (index.html) — the browser window: chrome bar, traffic
   *  dots, and the page's content lines typing on row by row like a
   *  loading render pass. */
  web: (s) => [
    <rect className={L} x="6.6" y="8.8" width="10.8" height="9.4" rx="1.3" />,
    <path className={L} d="M6.6 11 h10.8" />,
    <circle className={F} cx="8.2" cy="9.9" r="0.42" />,
    <circle className={F} cx="9.6" cy="9.9" r="0.42" />,
    draw('M8.2 13 h6.4', 0, 7 + (s % 3)),
    draw('M8.2 15 h4.4', 0.5, 7 + (s % 3)),
    draw('M8.2 16.9 h5.4', 1, 7 + (s % 3)),
  ],
  /** Plain text — six lines of varying length typing on row by row. */
  txt: () => [
    draw('M7.4 9.4 h9.2', 0, 10),
    draw('M7.4 11.3 h6.8', 0.5, 10),
    draw('M7.4 13.2 h9.2', 1, 10),
    draw('M7.4 15.1 h5.4', 1.5, 10),
    draw('M7.4 17 h9.2', 2, 10),
    draw('M7.4 18.9 h4.6', 2.5, 10),
  ],
  /** PDF — the Acrobat loop ribbon drawing itself on: the knot curls
   *  around its own waist before the tail sweeps out. */
  pdf: (s) => [
    <path
      className={L}
      d="M12.6 8.1 c2 1.2 2.9 3.9 1.9 6.2 -.8 1.8-2.7 2.9-4.7 2.5 -2-.4-3.2-2.4-2.5-4.4 .7-1.9 3-2.8 5-2.1 1.5.5 2.4 1.9 2.3 3.5 -.1 1.8-1.6 3.2-3.4 3.4"
      pathLength="30"
      stroke-dasharray="30"
    >
      <animate
        attributeName="stroke-dashoffset"
        values="30;0;0;30"
        keyTimes="0;0.3;0.85;1"
        dur={`${(8 + (s % 4)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
  ],
  /** Word docs — the W box with the three text lines beside it typing
   *  themselves on row by row. */
  docx: (s) => [
    <rect className={L} x="7.2" y="10.8" width="5.4" height="6.6" rx="0.8" />,
    word('W', s, 0.72, 0.8, 9.9, 15.6),
    draw('M14 11.9 h3.1', 0, 8 + (s % 3)),
    draw('M14 14.1 h3.1', 0.5, 8 + (s % 3)),
    draw('M14 16.3 h2.3', 1, 8 + (s % 3)),
  ],
  /** Spreadsheets — the X box with the 2×2 cell grid beside it and a
   *  selection square marching through the quadrants in discrete hops
   *  (a cell cursor roaming the sheet). */
  xlsx: (s) => [
    <rect className={L} x="7.2" y="10.8" width="5.4" height="6.6" rx="0.8" />,
    word('X', s, 0.72, 0.8, 9.9, 15.6),
    <path className={L} d="M14.1 11.3 h3.4 v6.2 h-3.4 z M14.1 14.4 h3.4 M15.8 11.3 v6.2" />,
    <rect className={F} x="14.4" y="11.9" width="1.1" height="1.1" stroke="none">
      <animate
        attributeName="x"
        values="14.4;16.1;16.1;14.4"
        calcMode="discrete"
        dur={`${(2.4 + (s % 20) / 20).toFixed(2)}s`}
        repeatCount="indefinite"
      />
      <animate
        attributeName="y"
        values="11.9;11.9;15;15"
        calcMode="discrete"
        dur={`${(2.4 + (s % 20) / 20).toFixed(2)}s`}
        repeatCount="indefinite"
      />
    </rect>,
  ],
  /** Presentations — the P box with the little pie chart beside it,
   *  the wedge sweeping around the circle like a chart redrawing. */
  ppt: (s) => [
    <rect className={L} x="7.2" y="10.8" width="5.4" height="6.6" rx="0.8" />,
    word('P', s, 0.72, 0.8, 9.9, 15.6),
    <circle className={L} cx="15.7" cy="14.1" r="2.3" />,
    <g className={F}>
      <path d="M15.7 14.1 V11.8 a2.3 2.3 0 0 1 2.3 2.3 z" stroke="none" />
      {spin(6 + (s % 3), 15.7, 14.1)}
    </g>,
  ],
  /** CSV — the `{;}` mark: braces breathing wide around a
   *  semicolon-ish dot pair that flickers alternating (the sheet's
   *  dotted-braces csv glyph). */
  csv: (s) => [
    <path className={L} d="M9.1 10.4 q-1.6.3-1.6 1.9 v.9 q0 1-1 1.1 t1 1.1 v.9 q0 1.6 1.6 1.9">
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;-0.7 0;0 0"
        dur={`${(3.4 + (s % 3)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
    <path className={L} d="M14.9 10.4 q1.6.3 1.6 1.9 v.9 q0 1 1 1.1 t-1 1.1 v.9 q0 1.6-1.6 1.9">
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;0.7 0;0 0"
        dur={`${(3.4 + (s % 3)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
    <circle className={F} cx="12.1" cy="12.7" r="0.58" stroke="none">
      {sway(2.2 + (s % 20) / 20, '1', '0.2')}
    </circle>,
    <circle className={F} cx="12.1" cy="15.4" r="0.58" stroke="none">
      {sway(2.2 + (s % 20) / 20, '0.2', '1')}
    </circle>,
    <path className={L} d="M12.4 15.8 l-.6 1" />,
  ],
  /** Packed tarballs — the square crate box carrying a smaller
   *  version of the zip seam inside it. */
  crate: (s) => [
    <rect className={L} x="7.6" y="9.4" width="8.8" height="9.2" rx="1" />,
    <path className={L} d="M11.4 10.4 V17.5" stroke-dasharray="0.75 0.5" />,
    <path className={L} d="M12.6 11 V17.5" stroke-dasharray="0.75 0.5" />,
    <g className={L}>
      <rect x="11.2" y="13.8" width="1.6" height="2" rx="0.4" />
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;0 -2.2;0 -2.2;0 0"
        keyTimes="0;0.5;0.7;1"
        dur={`${(4 + (s % 4)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </g>,
  ],
  /** Default document — page lines typing themselves on. */
  doc: () => [
    draw('M7.6 10 h8.8', 0, 9.5),
    draw('M7.6 12.6 h8.8', 0.55, 9.5),
    draw('M7.6 15.2 h8.8', 1.1, 9.5),
    draw('M7.6 17.8 h5.2', 1.65, 9.5),
  ],
}

/** extension → icon kind (lower-cased lookup key). */
const EXT_KIND: Record<string, string> = {
  ts: 'ts',
  mts: 'ts',
  cts: 'ts',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  py: 'py',
  pyc: 'py',
  pyw: 'py',
  tsx: 'atom',
  jsx: 'atom',
  rs: 'rs',
  go: 'go',
  java: 'java',
  class: 'java',
  jar: 'java',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cxxm: 'cpp',
  c: 'cpp',
  h: 'cpp',
  cs: 'cs',
  php: 'php',
  phtml: 'php',
  rb: 'rb',
  sql: 'sql',
  db: 'sql',
  sqlite: 'sql',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  map: 'json',
  webmanifest: 'json',
  scss: 'sass',
  sass: 'sass',
  css: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  xsl: 'xml',
  plist: 'xml',
  md: 'md',
  mdx: 'md',
  markdown: 'md',
  png: 'img',
  jpg: 'photo',
  jpeg: 'photo',
  webp: 'img',
  avif: 'img',
  bmp: 'img',
  ico: 'img',
  tif: 'img',
  tiff: 'img',
  heic: 'img',
  gif: 'gif',
  svg: 'vec',
  yml: 'yml',
  yaml: 'yml',
  toml: 'conf',
  ini: 'conf',
  env: 'conf',
  cfg: 'conf',
  conf: 'conf',
  properties: 'conf',
  lock: 'lock',
  woff: 'font',
  woff2: 'font',
  ttf: 'font',
  otf: 'font',
  eot: 'font',
  wasm: 'wasm',
  zip: 'archive',
  gz: 'crate',
  br: 'archive',
  tar: 'crate',
  rar: 'archive',
  '7z': 'archive',
  bz2: 'crate',
  xz: 'crate',
  tgz: 'crate',
  tbz2: 'crate',
  zst: 'crate',
  sh: 'shell',
  zsh: 'shell',
  bash: 'shell',
  fish: 'shell',
  ps1: 'shell',
  bat: 'shell',
  cmd: 'shell',
  exe: 'exe',
  msi: 'exe',
  app: 'exe',
  dmg: 'dmg',
  iso: 'dmg',
  mp4: 'video',
  webm: 'video',
  avi: 'video',
  mkv: 'video',
  m4v: 'video',
  mov: 'cam',
  qt: 'cam',
  mp3: 'note',
  m4a: 'note',
  flac: 'note',
  aac: 'note',
  wav: 'audio',
  ogg: 'audio',
  mid: 'note',
  midi: 'note',
  txt: 'txt',
  log: 'txt',
  pdf: 'pdf',
  doc: 'docx',
  docx: 'docx',
  odt: 'docx',
  rtf: 'docx',
  xls: 'xlsx',
  xlsx: 'xlsx',
  ods: 'xlsx',
  ppt: 'ppt',
  pptx: 'ppt',
  odp: 'ppt',
  csv: 'csv',
  tsv: 'csv',
}

/** Bare names (no usable extension) that map to authored kinds. */
const NAME_KIND: Record<string, string> = {
  license: 'cert',
  licence: 'cert',
  copying: 'cert',
  notice: 'cert',
  patents: 'cert',
  makefile: 'conf',
  dockerfile: 'conf',
  changelog: 'md',
  readme: 'md',
}

/**
 * The icon kind for a file name — index pages first (webpage glyph),
 * test/spec compound names, then the extension map, then bare-name
 * specials, then `doc`.
 * @param name File display name.
 * @returns A DOCS_ICON_KINDS value.
 */
export const kindFor = (name: string): string => {
  const lower = name.toLowerCase()

  if (lower === DOCS_STRINGS.INDEX_FILE) return DOCS_CLASSES.DOCS_ICON_KINDS.WEB

  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(lower)) return DOCS_CLASSES.DOCS_ICON_KINDS.TEST

  const bare = lower.split(CHAR_STRINGS.DOT)[0] || CHAR_STRINGS.EMPTY

  if (Object.hasOwn(NAME_KIND, bare)) return NAME_KIND[bare]

  const ext = lower.includes(CHAR_STRINGS.DOT)
    ? lower.split(CHAR_STRINGS.DOT).pop() || CHAR_STRINGS.EMPTY
    : CHAR_STRINGS.EMPTY

  if (Object.hasOwn(EXT_KIND, ext)) return EXT_KIND[ext]

  return DOCS_CLASSES.DOCS_ICON_KINDS.DOC
}

/**
 * File glyph — the shared page silhouette (hairline outline + folded
 * corner) with the kind's authored glyph inside, classed
 * `docs-tree-icon--<kind>` so the SCSS inks it.
 * @param name File display name.
 * @returns The SVG subtree.
 */
const fileIcon = (name: string): SVGElement => {
  const kind = kindFor(name)

  const seed = hashName(kind + name.length)

  return (
    <svg
      className={`${DOCS_CLASSES.DOCS_TREE_ICON} ${DOCS_CLASSES.DOCS_TREE_ICON}--${kind}`}
      viewBox={VIEW_BOX}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <path className={PAGE} d={PAGE_BODY} />
      <path className={`${PAGE}-fold`} d={PAGE_FOLD} />
      <path className={`${PAGE}-flap`} d={PAGE_FOLD_FILL} />
      {KIND_ART[kind](seed)}
      {rimGlint(PAGE_BODY, seed)}
    </svg>
  ) as SVGElement
}

/**
 * The row icon for one manifest node — directories get the stateful
 * paper-stack folder, files the kind-keyed pack glyph.
 * @param node The manifest node the row renders.
 * @param open Whether a directory row is expanded (file rows ignore it).
 * @returns The SVG subtree.
 */
export const treeIcon = (node: DocsNode, open: boolean): SVGElement =>
  node.type === 'dir' ? folderIcon(node, open) : fileIcon(node.name)
