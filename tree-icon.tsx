/**
 * @file docs/tree-icon.tsx
 * @description Animated SVG row icons for the docs treeview — a real
 * icon pack, not a generic page + ext label.
 *
 * Folders draw an Ignition-style folder with PAPER SHEETS peeking out
 * of the mouth — the visible count of sheets scales with children
 * (capped by DOCS_UNITS.TREE_SHEET_CAP), the open state lifts the
 * stack and swings the front flap, and the name hash seeds per-folder
 * fan/phase so no two folders look alike.
 *
 * Files resolve a KIND (ext → kind map, plus name-driven arms for
 * tests/specs, licenses and config files) and draw that kind's own
 * silhouette: the TS/JS letterform tiles, JSON braces, the Sass
 * ribbon, the CSS shield, the HTML chevrons, the Markdown mark, the
 * image landscape, the vector pen, YAML lists, the config gear, the
 * padlock, the font 'A', the wasm hex, the test flask, the license
 * rosette, archives, terminals, film and audio — each inked by its
 * `--icon-ink` class and carrying one slow SMIL motion so the set is
 * alive without any per-frame JS.
 */

import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { DOCS_UNITS } from '@core/tokens/strings/docs.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import { h } from '@core/jsx.js'
import type { DocsNode } from './manifest.js'

/** SVG viewport box shared by every row icon (unit-agnostic square). */
const VIEW_BOX = '0 0 24 24'

/** Shared part classes — stroked ink / filled ink / on-tile detail. */
const L = DOCS_CLASSES.DOCS_ICON_LINE
const F = DOCS_CLASSES.DOCS_ICON_FILL
const O = DOCS_CLASSES.DOCS_ICON_ON

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

// ── Folders ──────────────────────────────────────────────────────────

/**
 * One paper sheet in the folder stack — a page rect peeking above the
 * back plate. Per-sheet x/lift fan-out is seeded by the folder's name
 * hash so every folder's papers sit differently.
 * @param seed Folder name hash.
 * @param i Sheet index in the stack (0 = lowest).
 * @param open Lifted pose while the folder is open.
 * @param top True for the stack's top sheet — it gets the bob motion.
 * @returns The sheet node.
 */
const paperSheet = (seed: number, i: number, open: boolean, top: boolean): SVGElement => {
  const tilt = ((seed >> (i * 3)) % 7) - 3

  const lift = open ? 1.9 : 0

  const x = 6.6 + i * 0.75 + tilt * 0.12

  const y = 5.1 - i * 0.62 - lift

  const w = 11 - i * 0.55

  const cx = x + w / 2

  return (
    <rect
      className={DOCS_CLASSES.DOCS_TREE_PAPER}
      x={x.toFixed(2)}
      y={y.toFixed(2)}
      width={w.toFixed(2)}
      height="8"
      rx="0.7"
      transform={`rotate(${tilt} ${cx.toFixed(1)} ${(y + 4).toFixed(1)})`}
    >
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
    </rect>
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
const FOLDER_BODY_CLOSED =
  'M3.4 19 L3.4 8.6 Q3.4 7.4 4.6 7.4 L9.2 7.4 L11.4 9.4 L19.4 9.4 Q20.6 9.4 20.6 10.6 L20.6 17.8 Q20.6 19 19.4 19 Z'

const FOLDER_BODY_OPEN =
  'M3.4 12.6 L3.4 8.6 Q3.4 7.4 4.6 7.4 L9.2 7.4 L11.4 9.4 L19.4 9.4 Q20.6 9.4 20.6 10.6 L20.6 12.6 Z'

const FOLDER_FACE_CLOSED = 'M3.4 19 L3.4 12.4 L20.6 12.4 L20.6 17.8 Q20.6 19 19.4 19 Z'

const FOLDER_FLAP_OPEN = 'M5 12.7 L19.6 12.7 L22.4 19.4 L1.6 19.4 Z'

/**
 * Directory glyph — back plate + tab, a stack of paper sheets whose
 * visible count equals min(children, TREE_SHEET_CAP), the front face
 * (closed) or a swung-forward flap (open). The flap plays a one-shot
 * swing on mount so the open transition reads as motion. The sheet
 * count IS the artwork: 0 sheets = empty, a full stack = a heavy
 * folder — no numeral badge.
 * @param node The directory manifest node.
 * @param open Whether the branch is expanded in the treeview.
 * @returns The SVG subtree.
 */
const folderIcon = (node: DocsNode, open: boolean): SVGElement => {
  const seed = hashName(node.name)

  const count = node.children?.length ?? 0

  const sheetCount = Math.min(count, DOCS_UNITS.TREE_SHEET_CAP)

  const papers = []

  for (let i = 0; i < sheetCount; i++) {
    papers.push(paperSheet(seed, i, open, i === sheetCount - 1))
  }

  return (
    <svg
      className={DOCS_CLASSES.DOCS_TREE_ICON}
      viewBox={VIEW_BOX}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      {papers}
      <path
        className={`${DOCS_CLASSES.DOCS_TREE_ICON}-body`}
        d={open ? FOLDER_BODY_OPEN : FOLDER_BODY_CLOSED}
      />
      {open ? (
        <path className={`${DOCS_CLASSES.DOCS_TREE_ICON}-flap`} d={FOLDER_FLAP_OPEN}>
          {/* One-shot swing — the flap drops forward from the mouth with
              a small overshoot so opening a folder reads as motion even
              though the open state re-renders the glyph. */}
          <animateTransform
            attributeName="transform"
            type="rotate"
            values="-72 12 12.7;6 12 12.7;0 12 12.7"
            keyTimes="0;0.72;1"
            dur="0.45s"
            repeatCount="1"
            fill="freeze"
          />
        </path>
      ) : (
        <path className={`${DOCS_CLASSES.DOCS_TREE_ICON}-face`} d={FOLDER_FACE_CLOSED} />
      )}
    </svg>
  ) as SVGElement
}

// ── File icon pack — one authored silhouette per kind ────────────────

/** Language tile (TS/JS) — filled rounded square + block letterforms. */
const tile = (letters: unknown[], seed: number): unknown[] => [
  <rect className={F} x="4.5" y="4.5" width="15" height="15" rx="2.6" />,
  <g>
    {letters}
    <animate
      attributeName="opacity"
      values="1;0.75;1"
      dur={`${(4 + (seed % 4)).toFixed(1)}s`}
      repeatCount="indefinite"
    />
  </g>,
]

/**
 * kind → SVG subtree painter. Each value draws that filetype's own
 * silhouette inside the shared 24×24 viewport; `seed` (name hash)
 * phases each glyph's SMIL motion so sibling rows don't animate in
 * lockstep.
 */
const KIND_ART: Record<string, (seed: number) => unknown[]> = {
  /** TypeScript — blue tile + block TS. */
  ts: (s) =>
    tile(
      [
        <path className={O} d="M6.9 9.1 h4.6 M9.2 9.1 v5.8" />,
        <path
          className={O}
          d="M16.4 9.6 c-1.7-1.3-4.4-.7-4.3 1.1 .1 2.1 4.3 1.3 4.2 3.5 -.1 1.8-2.7 2.1-4.5 1"
        />,
      ],
      s
    ),
  /** JavaScript — yellow tile + block JS (J hook + S). */
  js: (s) =>
    tile(
      [
        <path className={O} d="M9.6 9.1 v4.9 c0 1.2-.9 1.7-2.3 1.3" />,
        <path
          className={O}
          d="M16.4 9.6 c-1.7-1.3-4.4-.7-4.3 1.1 .1 2.1 4.3 1.3 4.2 3.5 -.1 1.8-2.7 2.1-4.5 1"
        />,
      ],
      s
    ),
  /** JSON — the braces breathing apart around a center dot. */
  json: (s) => [
    <path
      className={L}
      d="M9.6 6.5 c-1.3 0-2 .7-2 1.9 v1.6 c0 1-.6 1.6-1.7 1.6 1.1 0 1.7.6 1.7 1.6 v1.6 c0 1.2.7 1.9 2 1.9"
    >
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;-0.55 0;0 0"
        dur={`${(4 + (s % 5)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
    <path
      className={L}
      d="M14.4 6.5 c1.3 0 2 .7 2 1.9 v1.6 c0 1 .6 1.6 1.7 1.6 -1.1 0-1.7.6-1.7 1.6 v1.6 c0 1.2-.7 1.9-2 1.9"
    >
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;0.55 0;0 0"
        dur={`${(4 + (s % 5)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
    <circle className={F} cx="12" cy="12.2" r="0.9" />,
  ],
  /** Sass — the ribbon S with the underline swash, drawn live. */
  sass: (s) => [
    <path
      className={L}
      d="M16.6 6.2 C13.6 4.4 8.4 5.4 7.9 8.8 c-.5 3.2 4.6 3.9 4.6 6.8 0 2.5-3.6 3.3-6.2 1.7"
      strokeDasharray="30 30"
    >
      <animate
        attributeName="stroke-dashoffset"
        from="0"
        to="60"
        dur={`${(6 + (s % 6)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
    <path className={L} d="M5.5 12.2 C9 14.6 15.2 15 18.6 11.6" />,
  ],
  /** CSS — the shield silhouette + three bars (the 3-shelf mark). */
  css: () => [
    <path className={F} d="M5 4.5 h14 l-1.35 13.4 L12 19.6 6.35 17.9 Z" />,
    <g className={O}>
      <path d="M8.6 8 h6.8 M8.8 11.4 h5.6 M9 14.8 h4.4" />
      {sway(5, '1', '0.7')}
    </g>,
  ],
  /** HTML — the </> chevrons + center slash, breathing open/closed. */
  html: (s) => [
    <path className={L} d="M9 7.5 L5.2 12 L9 16.5">
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;-0.7 0;0 0"
        dur={`${(3.5 + (s % 4)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
    <path className={L} d="M15 7.5 L18.8 12 L15 16.5">
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;0.7 0;0 0"
        dur={`${(3.5 + (s % 4)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
    <path className={L} d="M13.5 6 L10.5 18" />,
  ],
  /** Markdown — the real mark: rounded frame + M + the ↓ arrow. */
  md: () => [
    <rect className={L} x="3.5" y="7" width="17" height="10" rx="1.6" />,
    <path className={L} d="M6.4 14.6 v-5 l2.4 3 2.4-3 v5" />,
    <path className={L} d="M15.6 9.6 v3.8 M14.2 12.2 l1.4 1.9 1.4-1.9" />,
  ],
  /** Raster image — frame + sun + mountain line; the sun radiates. */
  img: () => [
    <rect className={L} x="4" y="5.5" width="16" height="13" rx="1.6" />,
    <circle className={F} cx="9.3" cy="9.6" r="1.5">
      <animate attributeName="r" values="1.5;1.9;1.5" dur="4.5s" repeatCount="indefinite" />
    </circle>,
    <path className={L} d="M4.6 16.4 L9.9 11.4 L13.1 14.4 L15.7 12.4 L19.4 16.4" />,
  ],
  /** Vector file — pen nib, handle arms, node dots (the .svg mark). */
  vec: (s) => [
    <path className={L} d="M12 4.5 L14.8 9.8 L12 14.2 L9.2 9.8 Z" />,
    <path className={L} d="M12 14.2 v2.3" />,
    <path className={L} d="M6.2 12.4 h3.4 M14.4 12.4 h3.4" />,
    <circle className={L} cx="5.4" cy="12.4" r="1.2" />,
    <circle className={L} cx="18.6" cy="12.4" r="1.2" />,
    <circle className={F} cx="12" cy="18" r="1.15">
      {sway(3.6 + (s % 3), '1', '0.6')}
    </circle>,
  ],
  /** YAML — stacked key dashes; the value lines drift. */
  yml: (s) => [
    <path className={L} d="M5.5 7 h2.5 M10.5 7 h8" strokeDasharray="14 14">
      <animate
        attributeName="stroke-dashoffset"
        from="0"
        to="28"
        dur={`${(5 + (s % 4)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
    <path className={L} d="M5.5 12 h2.5 M10.5 12 h8" strokeDasharray="14 14">
      <animate
        attributeName="stroke-dashoffset"
        from="0"
        to="-28"
        dur={`${(6 + (s % 3)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
    <path className={L} d="M5.5 17 h2.5 M10.5 17 h8" strokeDasharray="14 14">
      <animate
        attributeName="stroke-dashoffset"
        from="0"
        to="28"
        dur={`${(7 + (s % 5)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
  ],
  /** Config — the gear, in a slow perpetual turn. */
  conf: () => [
    <g className={L}>
      <circle cx="12" cy="12" r="3.3" />
      <path d="M12 4.7 v2.6 M12 16.7 v2.6 M4.7 12 h2.6 M16.7 12 h2.6 M6.8 6.8 l1.8 1.8 M15.4 15.4 l1.8 1.8 M17.2 6.8 l-1.8 1.8 M8.6 15.4 l-1.8 1.8" />
      <animateTransform
        attributeName="transform"
        type="rotate"
        from="0 12 12"
        to="360 12 12"
        dur="26s"
        repeatCount="indefinite"
      />
    </g>,
  ],
  /** Lockfile — padlock, the shackle swaying gently. */
  lock: () => [
    <path className={L} d="M9.2 11 V8.6 a2.8 2.8 0 0 1 5.6 0 V11">
      <animateTransform
        attributeName="transform"
        type="rotate"
        values="-5 12 8.6;5 12 8.6;-5 12 8.6"
        dur="5.5s"
        repeatCount="indefinite"
      />
    </path>,
    <rect className={L} x="7" y="11" width="10" height="8.6" rx="1.8" />,
    <circle className={F} cx="12" cy="14.6" r="1.1" />,
    <path className={L} d="M12 15.7 v1.5" />,
  ],
  /** Font files — the 'A' letterform with baseline feet. */
  font: () => [
    <path className={L} d="M6.6 19 L12 5.2 L17.4 19" />,
    <path className={L} d="M8.9 14.4 h6.2" />,
    <path className={L} d="M5 19 h4 M15 19 h4" />,
  ],
  /** WASM — the hexagonal crate + inner diamond, slow spin. */
  wasm: () => [
    <g className={L}>
      <path d="M12 3.8 L19 7.9 V16.1 L12 20.2 L5 16.1 V7.9 Z" />
      <path d="M12 8.4 L15.1 12 L12 15.6 L8.9 12 Z" />
      <animateTransform
        attributeName="transform"
        type="rotate"
        from="0 12 12"
        to="360 12 12"
        dur="34s"
        repeatCount="indefinite"
      />
    </g>,
  ],
  /** Test/spec files — the flask with rising bubbles. */
  test: (s) => [
    <path
      className={L}
      d="M10 4.5 h4 M11 4.5 v4.9 L6.3 17.5 a1.7 1.7 0 0 0 1.5 2.5 h8.4 a1.7 1.7 0 0 0 1.5-2.5 L13 9.4 V4.5"
    />,
    <path className={L} d="M7.9 14.6 h8.2" />,
    <circle className={F} cx="10.4" cy="17.6" r="0.85">
      <animate
        attributeName="cy"
        values="17.6;15.4;17.6"
        dur={`${(3 + (s % 3)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </circle>,
    <circle className={F} cx="13.4" cy="17.2" r="0.65">
      <animate
        attributeName="cy"
        values="17.2;15.6;17.2"
        dur={`${(3.6 + (s % 2)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </circle>,
  ],
  /** License/notice — the rosette seal + ribbon tails. */
  cert: () => [
    <circle className={L} cx="12" cy="9.4" r="4.2">
      <animateTransform
        attributeName="transform"
        type="rotate"
        values="-9 12 9.4;9 12 9.4;-9 12 9.4"
        dur="6s"
        repeatCount="indefinite"
      />
    </circle>,
    <circle className={F} cx="12" cy="9.4" r="1.35" />,
    <path className={L} d="M9.7 12.8 L8.4 19.8 L12 18.2 L15.6 19.8 L14.3 12.8" />,
  ],
  /** Archives — the parcel: box, lid flap, carry handle. */
  archive: () => [
    <rect className={L} x="5" y="10" width="14" height="9.6" rx="1.2" />,
    <path className={L} d="M5 10 L8.3 6.4 h7.4 L19 10" />,
    <path className={L} d="M10.4 13.2 h3.2" />,
  ],
  /** Shell scripts — the terminal: prompt chevron + blinking cursor. */
  shell: (s) => [
    <rect className={L} x="3.5" y="5.5" width="17" height="13" rx="2" />,
    <path className={L} d="M7.4 9.4 l3.1 2.6 -3.1 2.6" />,
    <rect className={F} x="12.4" y="14.6" width="4.2" height="1.3">
      {sway(1.6 + (s % 20) / 20, '1', '0.15')}
    </rect>,
  ],
  /** Video — film frame, sprocket dashes, pulsing play head. */
  video: (s) => [
    <rect className={L} x="3.5" y="6" width="17" height="12" rx="2" />,
    <path className={L} d="M4.5 8.7 h15" strokeDasharray="1.6 2.6" />,
    <path className={L} d="M4.5 15.3 h15" strokeDasharray="1.6 2.6" />,
    <path className={F} d="M10.4 9.8 L15.2 12 L10.4 14.2 Z">
      {sway(2.6 + (s % 3), '1', '0.55')}
    </path>,
  ],
  /** Audio — the waveform bars, bobbing as one body. */
  audio: (s) => [
    <g className={L}>
      <path d="M6.5 10.5 v3 M9.4 8.5 v7 M12.3 6 v12 M15.2 8.5 v7 M18.1 10.5 v3" />
      <animateTransform
        attributeName="transform"
        type="translate"
        values="0 0;0 -0.9;0 0"
        dur={`${(2.4 + (s % 4) / 2).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </g>,
  ],
  /** Default document — the folded page with drifting text lines. */
  doc: (s) => [
    <path
      className={L}
      d="M6.5 3.5 L13.5 3.5 L18.5 8.5 L18.5 20.5 L6.5 20.5 Z M13.5 3.5 L13.5 8.5 L18.5 8.5"
    />,
    <path className={L} d="M9 12.4 h6 M9 15.2 h6 M9 18 h3.8" strokeDasharray="12 12">
      <animate
        attributeName="stroke-dashoffset"
        from="0"
        to="24"
        dur={`${(6 + (s % 5)).toFixed(1)}s`}
        repeatCount="indefinite"
      />
    </path>,
  ],
}

/** extension → icon kind (lower-cased lookup key). */
const EXT_KIND: Record<string, string> = {
  ts: 'ts',
  tsx: 'ts',
  mts: 'ts',
  cts: 'ts',
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  webmanifest: 'json',
  scss: 'sass',
  sass: 'sass',
  css: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  md: 'md',
  mdx: 'md',
  markdown: 'md',
  png: 'img',
  jpg: 'img',
  jpeg: 'img',
  gif: 'img',
  webp: 'img',
  avif: 'img',
  bmp: 'img',
  ico: 'img',
  tif: 'img',
  tiff: 'img',
  heic: 'img',
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
  gz: 'archive',
  br: 'archive',
  tar: 'archive',
  rar: 'archive',
  '7z': 'archive',
  bz2: 'archive',
  xz: 'archive',
  sh: 'shell',
  zsh: 'shell',
  bash: 'shell',
  fish: 'shell',
  ps1: 'shell',
  bat: 'shell',
  cmd: 'shell',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  avi: 'video',
  mkv: 'video',
  m4v: 'video',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  flac: 'audio',
  aac: 'audio',
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
 * The icon kind for a file name — test/spec compound names first,
 * then the extension map, then bare-name specials, then `doc`.
 * @param name File display name.
 * @returns A DOCS_ICON_KINDS value.
 */
const kindFor = (name: string): string => {
  const lower = name.toLowerCase()

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
 * File glyph — the kind's authored silhouette inside the shared
 * viewport, classed `docs-tree-icon--<kind>` so the SCSS inks it.
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
      {KIND_ART[kind](seed)}
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
