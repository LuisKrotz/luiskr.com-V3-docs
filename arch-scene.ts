/**
 * @file docs/arch-scene.ts
 * @description Interactive three.js visualization of the docs manifest —
 * the architecture/org structure rendered as a 3D radial tree: each
 * directory is a node on its depth ring, edges draw parent→child, nodes
 * pulse on a slow organic drift and click-to-pick navigates the portal.
 * Directory names ride on sprite labels that fade in as the camera zooms
 * closer, so the viewer can tell which ring/folder it is inside.
 *
 * WebGL context acquisition goes through `webglContext()` (the project
 * choke point) and is handed to three's WebGLRenderer, so the
 * `?debug=webGLMode:fallback` surface and pool hygiene stay authoritative.
 * All per-frame math lives on the GPU/three transforms — the rAF tick only
 * sets uniforms/rotation, per the compute-placement rule.
 *
 * Node-position batch math dispatches through `wasmPool` (the
 * DOCS_SCENE_LAYOUT worker op); when the pool is unavailable the identical
 * local formula runs on the main thread — the scene always mounts.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { webglAllowed, webglContext } from '@core/utils/canvas/webgl-mode.js'
import { hasWebGpu, webgpuWidgetsEnabled } from '@core/utils/gpu/webgpu-widget.js'
import { mountArchScene3d } from './arch-scene-3d.js'
import { wasmPool } from '@core/utils/wasm/wasm-pool.js'
import { WASM_ACTIONS } from '@core/tokens/data/wasm.js'
import { CACHE_STORAGE_KEYS } from '@core/tokens/data/storage.js'
import { TYPE_STRINGS } from '@core/tokens/strings/types.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import { DOCS_STRINGS, DOCS_UNITS } from '@core/tokens/strings/docs.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { THEME_CSS_PROPS } from '@core/tokens/css/theme.js'
import { parseCssColor } from '@core/utils/canvas/css-color.js'
import { kindFor } from './tree-icon.js'
import { NET_STRINGS } from '@core/tokens/strings/net.js'
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import {
  GL_EVENTS,
  MOUSE_EVENTS,
  ORBIT_EVENTS,
  POINTER_EVENTS,
  PRINT_EVENTS,
} from '@core/tokens/events/dom.js'
import { devWarn } from '@core/devlog.js'
import type { DocsNode } from './manifest.js'

/** Live scene resources — destroy() frees renderer + listeners. */
export interface ArchSceneHandle {
  destroy(): void
  /**
   * Highlights the node matching `path` — the current docs location.
   * Safe to call before the async graph build lands; the highlight
   * applies to whatever nodes exist and is re-applied when they arrive.
   * @param _path Manifest path of the active location ('' = portal root).
   */
  setActive(_path: string): void
  /**
   * Re-fits the renderer + camera to the canvas's current box — called
   * by the ResizeObserver on column↔dialog moves and any layout shift.
   */
  resize(): void
  /**
   * Stops/restarts the rAF loop — the host pauses while the map column
   * is display:none (≤1024) so no GPU frame or CPU wakeup is spent on
   * an invisible surface. Unpausing re-arms the loop; a resize() right
   * after re-fits whatever box the canvas re-seated into.
   * @param _paused True to stop scheduling, false to resume.
   */
  setPaused(_paused: boolean): void
}

/** A flattened manifest node with its ring depth and ring angle. */
export interface PlacedNode {
  node: DocsNode
  depth: number
  angle: number
  parent: number
}

/** A dir-name sprite with the depth it answers to (zoom-reveal bucket). */
interface LabelRef {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  depth: number
  /** Last written alpha — opacity writes and visibility flips are dirty-gated. */
  a: number
}

/**
 * three.js GLSL anchors the instanced-node materials patch — chunk-include
 * names are the stable seam inside three's generated programs.
 */
const GLSL_BEGIN_VERTEX = '#include <begin_vertex>'
const GLSL_COLOR_FRAGMENT = '#include <color_fragment>'

/**
 * Instanced-node shader contract — the ambient pulse and the
 * active-node scale run entirely in the vertex stage so the scene's
 * ~7k nodes cost two draw calls and ZERO per-frame CPU writes:
 *
 *   transformed *= (1 + sin(uTime·SPEED + gl_InstanceID·PHASE) · AMP)
 *                · (1 + aActive · (SCENE_ACTIVE_SCALE − 1))
 *
 * `aAlpha` carries the per-node opacity (base / ancestor / active),
 * `aActive` the 0/1 active flag — both are instanced attributes written
 * only when the highlight path changes, never per frame.
 */
/** Instanced-attribute names shared by the geometry buffers and the GLSL. */
const ATTR_A_ALPHA = DOCS_STRINGS.SCENE_ATTR_ALPHA
const ATTR_A_ACTIVE = DOCS_STRINGS.SCENE_ATTR_ACTIVE
const ATTR_A_OFFSET = DOCS_STRINGS.SCENE_ATTR_OFFSET
const ATTR_A_COLOR = DOCS_STRINGS.SCENE_ATTR_COLOR
const ATTR_A_PHASE = DOCS_STRINGS.SCENE_ATTR_PHASE
const ATTR_A_SPIN = DOCS_STRINGS.SCENE_ATTR_SPIN

/**
 * Wireframe-glyph shader contract — the procedural-directory reference's
 * per-node motion and per-kind ink run entirely in the vertex/fragment
 * stages so ~7k glyph instances cost one draw call per tier and ZERO
 * per-frame CPU writes:
 *
 *   p      = rotY(uTime·SPIN + aSpin) · position        — node self-yaw
 *   p     *= (1 + sin(uTime·PULSE + i·0.7)·AMP)         — ambient pulse
 *          · (1 + aActive·(SCENE_ACTIVE_SCALE − 1))     — active pop
 *   off    = aOffset + (0, sin(uTime·BOB + aPhase)·BAMP, 0)
 *   result = p + off                                   — bob + place
 *
 * `aColor` carries the file's icon-pack ink (dir accent for folders and
 * +N aggregates); `aAlpha`/`aActive` are the highlight-pass streams —
 * all instanced, written only when the graph or highlight changes.
 */
const glyphVertexPreamble =
  `uniform float uTime;\n` +
  `attribute vec3 ${ATTR_A_OFFSET};\n` +
  `attribute vec3 ${ATTR_A_COLOR};\n` +
  `attribute float ${ATTR_A_PHASE};\n` +
  `attribute float ${ATTR_A_SPIN};\n` +
  `attribute float ${ATTR_A_ALPHA};\n` +
  `attribute float ${ATTR_A_ACTIVE};\n` +
  `varying vec3 vColor;\nvarying float vAlpha;\n`

const glyphVertexTransform =
  `${GLSL_BEGIN_VERTEX}\n` +
  `float _sa = uTime * ${DOCS_UNITS.SCENE_NODE_SPIN} + ${ATTR_A_SPIN};\n` +
  `float _sc = cos(_sa), _ss = sin(_sa);\n` +
  `vec3 _p = vec3(transformed.x * _sc - transformed.z * _ss, transformed.y, transformed.x * _ss + transformed.z * _sc);\n` +
  `_p *= (1.0 + sin(uTime * ${DOCS_UNITS.SCENE_PULSE_SPEED} + float(gl_InstanceID) * 0.7) * ${DOCS_UNITS.SCENE_PULSE_AMP}) * (1.0 + ${ATTR_A_ACTIVE} * ${DOCS_UNITS.SCENE_ACTIVE_SCALE - 1.0});\n` +
  `vec3 _off = ${ATTR_A_OFFSET};\n` +
  `_off.y += sin(uTime * ${DOCS_UNITS.SCENE_BOB_SPEED} + ${ATTR_A_PHASE}) * ${DOCS_UNITS.SCENE_BOB_AMP};\n` +
  `transformed = _p + _off;\n` +
  `vColor = ${ATTR_A_COLOR};\n` +
  `vAlpha = ${ATTR_A_ALPHA};\n`

const glyphFragmentPreamble = 'varying vec3 vColor;\nvarying float vAlpha;\n'

const glyphFragmentInk = `${GLSL_COLOR_FRAGMENT}\ndiffuseColor.rgb = vColor;\ndiffuseColor.a *= vAlpha;\n`

/**
 * Edge shader contract — each endpoint vertex carries its node's bob
 * phase in `aPhase`, so the parent→child link endpoints ride the exact
 * same sine the glyph centers do and links stay glued while the
 * network floats. No per-frame CPU rewrites of edge buffers.
 */
const edgeVertexPreamble = `uniform float uTime;\nattribute float ${ATTR_A_PHASE};\n`

const edgeVertexBob =
  `${GLSL_BEGIN_VERTEX}\n` +
  `transformed = vec3(transformed.x, transformed.y + sin(uTime * ${DOCS_UNITS.SCENE_BOB_SPEED} + ${ATTR_A_PHASE}) * ${DOCS_UNITS.SCENE_BOB_AMP}, transformed.z);\n`

/**
 * Patches a node material so the pulse scale and per-instance alpha run
 * in-shader: `uTime` is the shared clock, `aAlpha`/`aActive` are the
 * instanced attribute streams the highlight pass rewrites on demand.
 */
const patchGlyphMaterial = (mat: THREE.LineBasicMaterial, clock: { value: number }): void => {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = clock

    shader.vertexShader =
      glyphVertexPreamble + shader.vertexShader.replace(GLSL_BEGIN_VERTEX, glyphVertexTransform)

    shader.fragmentShader =
      glyphFragmentPreamble + shader.fragmentShader.replace(GLSL_COLOR_FRAGMENT, glyphFragmentInk)
  }
}

/**
 * Patches the edge material with the shared clock so link endpoints
 * bob in phase with their node glyphs.
 */
const patchEdgeMaterial = (mat: THREE.LineBasicMaterial, clock: { value: number }): void => {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = clock

    shader.vertexShader =
      edgeVertexPreamble + shader.vertexShader.replace(GLSL_BEGIN_VERTEX, edgeVertexBob)
  }
}

/**
 * Subtree node count — the balloon-layout weight. Recursive per the
 * self-similar-traversal rule; each node's weight is computed once, at
 * the level that allocates its parent's sector.
 * @param node Manifest node whose subtree is weighed.
 * @returns Total nodes in the subtree, self included (min 1).
 */
const subtreeWeight = (node: DocsNode): number =>
  1 + (node.children?.reduce((sum, child) => sum + subtreeWeight(child), 0) ?? 0)

/**
 * Flattens the manifest tree into positioned node descriptors: depth sets
 * the ring radius, sibling order spreads the angle. Sectors split
 * proportionally to subtree weight (balloon-tree), not sibling count —
 * a 300-file branch gets the angular room its leaf count needs while a
 * single-file branch takes a thin slice; equal splits are what packed
 * dense subtrees into unreadable blobs. Recursive per the
 * self-similar-traversal rule.
 */
export const layoutNodes = (
  nodes: DocsNode[],
  depth = 0,
  from = 0,
  to = Math.PI * 2,
  parent = -1,
  acc: PlacedNode[] = []
): PlacedNode[] => {
  const weights = nodes.map(subtreeWeight)

  const total = Math.max(
    weights.reduce((sum, w) => sum + w, 0),
    1
  )

  let cursor = from

  nodes.forEach((node, i) => {
    const span = (to - from) * ((weights[i] as number) / total)

    const angle = cursor + span / 2

    const idx = acc.length

    acc.push({ node, depth, angle, parent })

    if (node.children?.length) {
      layoutNodes(node.children, depth + 1, cursor, cursor + span, idx, acc)
    }

    cursor += span
  })

  return acc
}

/**
 * Main-thread twin of the DOCS_SCENE_LAYOUT worker op — the batch
 * fallback for when the wasm pool is unavailable (tests, worker-less
 * environments). Ring radius grows with depth; y carries the depth band
 * plus a golden-angle hash of the node index — sin(i·φ) decorrelates
 * consecutive nodes so same-ring siblings scatter vertically instead of
 * welding into a flat disc of dots.
 * @param depths Ring depth per node.
 * @param angles Ring angle (radians) per node.
 * @returns Flat xyz triplets in node order.
 */
const layoutPositionsJs = (depths: number[], angles: number[]): Float32Array => {
  const xyz = new Float32Array(depths.length * 3)

  for (let i = 0; i < depths.length; i++) {
    const r = DOCS_UNITS.SCENE_BASE_RADIUS + depths[i] * DOCS_UNITS.SCENE_DEPTH_STEP

    xyz[i * 3] = Math.cos(angles[i]) * r
    xyz[i * 3 + 1] =
      ((depths[i] % 3) - 1) * DOCS_UNITS.SCENE_Y_STEP +
      Math.sin(i * DOCS_UNITS.SCENE_Y_HASH) * DOCS_UNITS.SCENE_Y_WAVE
    xyz[i * 3 + 2] = Math.sin(angles[i]) * r
  }

  return xyz
}

/**
 * Batch position compute — wasm worker first, local math on failure. The
 * worker replies with a transferable Float32Array; `structuredClone` of
 * the plain-object result also survives when transfer is unsupported.
 * @param placed Flattened tree nodes.
 * @returns xyz triplets, or null when nothing resolved.
 */
export const computePositions = async (placed: PlacedNode[]): Promise<Float32Array> => {
  const depths = placed.map((p) => p.depth)
  const angles = placed.map((p) => p.angle)

  // Worker replies carry the shape `{ id, type, results: { xyz } }` —
  // `results` is the worker-protocol envelope for every op.
  const res = (await wasmPool.dispatch(WASM_ACTIONS.DOCS_SCENE_LAYOUT, { depths, angles })) as {
    results?: { xyz?: ArrayLike<number> }
  } | null

  const xyz = res?.results?.xyz

  return xyz && xyz.length === depths.length * 3
    ? new Float32Array(xyz)
    : layoutPositionsJs(depths, angles)
}

/**
 * Wireframe folder glyph — the procedural-directory reference shape:
 * a front panel (top edge slightly lower, the open-mouth read), a
 * taller back panel, a tab on the back's top-left, and the depth
 * connectors that make it read as a 3D box from any orbit angle.
 * Pure vertex math — no textures, no imported geometry. Scaled to
 * SCENE_DIR_RADIUS. Exported: the scene3d arm ribbons the same verts.
 * @returns Flat xyz pairs — segment list for LINES drawing.
 */
export const dirWireVerts = (): Float32Array => {
  const s = DOCS_UNITS.SCENE_DIR_RADIUS
  const w = s
  const h = s * 0.75
  const d = s * 0.15
  const tabW = s * 0.6
  const tabH = s * 0.2

  const v: number[] = []
  const L = (a: number[], b: number[]): void => {
    v.push(a[0], a[1], a[2], b[0], b[1], b[2])
  }

  const fBL = [-w, -h, d]
  const fBR = [w, -h, d]
  const fTR = [w, h - s * 0.2, d]
  const fTL = [-w, h - s * 0.2, d]

  const bBL = [-w, -h, -d]
  const bBR = [w, -h, -d]
  const bTR = [w, h, -d]
  const bTL = [-w, h, -d]

  const tTL = [-w, h + tabH, -d]
  const tTR = [-w + tabW, h + tabH, -d]
  const tBR = [-w + tabW + s * 0.1, h, -d]

  // Front panel rectangle.
  L(fBL, fBR)
  L(fBR, fTR)
  L(fTR, fTL)
  L(fTL, fBL)
  // Back panel (bottom, right, left — the top edge is the tab's line).
  L(bBL, bBR)
  L(bBR, bTR)
  L(bBL, bTL)
  // Tab up and over.
  L(bTL, tTL)
  L(tTL, tTR)
  L(tTR, tBR)
  L(tBR, bTR)
  // Depth connectors front→back.
  L(fBL, bBL)
  L(fBR, bBR)
  L(fTR, bTR)
  L(fTL, bTL)

  return new Float32Array(v)
}

/**
 * Wireframe document glyph — folded-corner page outline + inner fold
 * diagonal + three text-rule lines (the reference file shape). Scaled
 * to SCENE_FILE_RADIUS·1.3 so leaf glyphs read smaller than folders
 * (the container/item size ratio of the reference). Exported: the
 * scene3d arm ribbons the same verts.
 * @returns Flat xyz pairs — segment list for LINES drawing.
 */
export const fileWireVerts = (): Float32Array => {
  const s = DOCS_UNITS.SCENE_FILE_RADIUS * 1.3
  const w = s * 0.7
  const h = s
  const c = s * 0.3

  const v: number[] = []
  const L = (a: number[], b: number[]): void => {
    v.push(a[0], a[1], a[2], b[0], b[1], b[2])
  }

  const bl = [-w, -h, 0]
  const br = [w, -h, 0]
  const tr1 = [w, h - c, 0]
  const tr2 = [w - c, h, 0]
  const tl = [-w, h, 0]
  const fold = [w - c, h - c, 0]

  // Page outline + fold diagonal.
  L(bl, br)
  L(br, tr1)
  L(tr1, tr2)
  L(tr2, tl)
  L(tl, bl)
  L(tr2, fold)
  L(fold, tr1)
  // Text-rule lines — the "contents" read.
  for (let i = 0; i < 3; i++) {
    const ly = -s * 0.2 - i * s * 0.3

    L([-w + s * 0.2, ly, 0], [w - s * 0.2, ly, 0])
  }

  return new Float32Array(v)
}

/**
 * Bounding radius of a wire segment list — the invisible pick-sphere
 * radius (wire glyphs have no triangle surface to raycast, so picking
 * runs against instanced spheres sized to the glyph's exact bound).
 * Exported: the scene3d arm sizes its JS-side pick spheres from the
 * same bound.
 * @param verts Flat xyz pairs.
 */
export const wireBound = (verts: Float32Array): number => {
  let m = 0

  for (let i = 0; i < verts.length; i += 3) {
    const r = Math.hypot(verts[i], verts[i + 1], verts[i + 2])

    if (r > m) m = r
  }

  return m
}

/**
 * Per-kind ink probe — the map colors file nodes with the EXACT ink
 * the treeview icon pack paints that extension's glyph, sampled off
 * `docs-tree-icon docs-tree-icon--<kind>` probe elements parked inside
 * the portal's shadow root (icon SCSS is shadow-scoped; probes must
 * live inside it for --icon-ink to resolve). `hidden` keeps the probe
 * invisible — custom properties still compute. Returns null entries
 * for unparseable/no-stylesheet environments (tests) — callers fall
 * back to the dir accent ink.
 * @param host  Element inside the .docs shadow tree (canvas's parent).
 * @param kinds Distinct icon kinds to sample.
 */
export const probeIconInks = (
  host: Element,
  kinds: readonly string[]
): Map<string, number[] | null> => {
  const out = new Map<string, number[] | null>()
  const probes: HTMLElement[] = []

  kinds.forEach((kind) => {
    const probe = document.createElement(HTML_TAGS.SPAN)

    probe.className = `${DOCS_CLASSES.DOCS_TREE_ICON} ${DOCS_CLASSES.DOCS_TREE_ICON}--${kind}`
    probe.hidden = true

    host.appendChild(probe)

    probes.push(probe)

    out.set(
      kind,
      parseCssColor(getComputedStyle(probe).getPropertyValue(DOCS_STRINGS.SCENE_ICON_INK_PROP))
    )
  })

  probes.forEach((p) => p.remove())

  return out
}

/**
 * Builds a dir-name sprite label — a 2d-canvas texture on a THREE.Sprite.
 * Returns null when 2d canvas is unavailable (happy-dom, exotic runtimes)
 * so the scene still mounts label-free.
 * @param name Folder name drawn on the label.
 * @param ink  Theme ink color resolved from the canvas' computed style.
 */
/**
 * Draws a dir-name label onto a fresh 2d canvas — shared by the
 * three.js sprite arm (CanvasTexture) and the scene3d arm
 * (createImageBitmap → texture upload). Returns null when 2d canvas
 * is unavailable (happy-dom, exotic runtimes) so the scene still
 * mounts label-free.
 * @param name Folder name drawn on the label.
 * @param ink  Theme ink color resolved from the canvas' computed style.
 */
export const makeLabelCanvas = (name: string, ink: string): HTMLCanvasElement | null => {
  const cnv = document.createElement(HTML_TAGS.CANVAS)

  const ctx = cnv.getContext('2d') as CanvasRenderingContext2D | null

  if (!ctx) return null

  cnv.width = DOCS_UNITS.LABEL_W
  cnv.height = DOCS_UNITS.LABEL_H

  ctx.font = `${DOCS_UNITS.LABEL_FONT_PX}px sans-serif`
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, DOCS_UNITS.LABEL_W / 2, DOCS_UNITS.LABEL_H / 2, DOCS_UNITS.LABEL_W - 8)

  return cnv
}

const makeLabel = (
  name: string,
  ink: string
): { sprite: THREE.Sprite; material: THREE.SpriteMaterial } | null => {
  if (!THREE.CanvasTexture || !THREE.Sprite) return null

  const cnv = makeLabelCanvas(name, ink)

  if (!cnv) return null

  const material = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cnv),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })

  const sprite = new THREE.Sprite(material)

  sprite.scale.set(DOCS_UNITS.LABEL_SCALE_X, DOCS_UNITS.LABEL_SCALE_Y, 1)

  return { sprite, material }
}

/** Persisted camera pose + rotation-off flag across scene remounts. */
export interface SceneCamState {
  /** camera.position xyz */
  p: [number, number, number]
  /** controls.target xyz */
  t: [number, number, number]
  /** true once the user has taken control — autoRotate stays off. */
  off: boolean
}

/**
 * Reads the session-persisted camera pose — null when storage is
 * unavailable (tests, privacy mode) or the payload is malformed.
 */
export const readCamState = (): SceneCamState | null => {
  try {
    if (typeof sessionStorage === TYPE_STRINGS.UNDEFINED) return null

    const raw = sessionStorage.getItem(CACHE_STORAGE_KEYS.DOCS_SCENE_STATE)

    if (!raw) return null

    const d = JSON.parse(raw) as Partial<SceneCamState>

    return d.p?.length === 3 && d.t?.length === 3
      ? { p: d.p as SceneCamState['p'], t: d.t as SceneCamState['t'], off: !!d.off }
      : null
  } catch {
    return null
  }
}

/**
 * Mounts the architecture scene on `canvas`.
 * @param canvas   Target canvas.
 * @param roots    Manifest root buckets (each becomes an inner-ring node).
 * @param onPick   Called with the manifest path when a node is picked.
 * @param onLost   Called once when the GL context dies mid-flight so the
 *                 host can hide/remount the scene — the portal keeps
 *                 working without WebGL.
 * @returns Scene handle, or null when WebGL is unavailable.
 */
/**
 * Collapses each dir's file leaves past SCENE_FILE_CAP into one
 * `+N` aggregate leaf — hundreds of per-file spheres fanning off a
 * single parent are the map's "comb" hairball; beyond a handful the
 * dots carry no nav value (the tree list owns per-file navigation).
 * The aggregate keeps the parent dir's path, so picking it navigates
 * to the dir and the highlight pass lights it whenever the dir (or
 * anything under it) is active. Subtree weights shrink accordingly,
 * which is what frees the angular room the dense branches needed.
 * Recursive per the self-similar-traversal rule; returns fresh nodes —
 * the manifest tree itself is never mutated.
 * @param node Dir whose children are capped.
 * @returns The same node with capped (copied) children.
 */
const capSceneLeaves = (node: DocsNode, depth = 1): DocsNode => {
  const kids = node.children

  if (!kids?.length) return node

  // The cap shrinks with depth — buckets can afford a handful of leaf
  // dots, but out at rings 4-5 the leaves are pure comb noise, so they
  // all collapse into the `+N` aggregate.
  const cap = Math.max(0, DOCS_UNITS.SCENE_FILE_CAP - depth * DOCS_UNITS.SCENE_FILE_CAP_STEP)

  const files = kids.filter((c) => c.type === 'file')

  const shown = new Set(files.slice(0, cap))

  const children = kids
    .filter((c) => c.type !== 'file' || shown.has(c))
    .map((c) => (c.type === 'file' ? c : capSceneLeaves(c, depth + 1)))

  const hidden = files.length - shown.size

  if (hidden > 0) {
    children.push({
      type: 'file',
      name: `${DOCS_STRINGS.AGGREGATE_MARK}${hidden}`,
      path: node.path,
      aggregate: true,
    })
  }

  return { ...node, children }
}

/**
 * The manifest buckets hang off a synthetic center node — the portal
 * root level IS the tree root, so the scene reads as one rooted graph
 * (center = "In-depth project docs", ring 1 = the four buckets, …).
 * Buckets are { root, label, children } — mapped to dir nodes here so
 * they carry a real path (pickable + highlightable) and a real label.
 * File leaves are capped per dir (capSceneLeaves) so giant coverage
 * dirs don't weld into combs. Shared by the three.js and scene3d arms.
 * @param roots Manifest root buckets.
 * @returns The flattened placed tree.
 */
export const placeRoots = (
  roots: Array<{ root: string; label: string; children: DocsNode[] }>
): PlacedNode[] =>
  layoutNodes([
    {
      type: 'dir',
      name: DOCS_STRINGS.TITLE,
      path: CHAR_STRINGS.EMPTY,
      children: roots.map((r) =>
        capSceneLeaves({
          type: 'dir' as const,
          name: r.label,
          path: r.root,
          children: r.children,
        })
      ),
    },
  ])

/** Camera-fit numbers for a placed tree — shared by both arms. */
export interface GraphFit {
  /** Outer ring radius of the deepest node. */
  graphR: number
  /** Eye distance that frames the whole graph with ~20% margin. */
  camDist: number
  /** Far plane — clears the opposite rim at this distance. */
  far: number
}

/**
 * Fit the camera to the real graph radius — a deep manifest (outer
 * rings past ~60 units) left the default pose sitting INSIDE the tree,
 * which rendered nodes as giant blobs instead of a legible radial
 * map. dist = r/sin(fov/2) with ~20% margin frames the whole graph.
 * @param placed The flattened placed tree.
 */
export const graphFit = (placed: readonly PlacedNode[]): GraphFit => {
  const maxDepth = placed.reduce((m, p) => Math.max(m, p.depth), 0)

  const graphR = DOCS_UNITS.SCENE_BASE_RADIUS + maxDepth * DOCS_UNITS.SCENE_DEPTH_STEP

  const camDist = graphR * DOCS_UNITS.SCENE_CAMERA_FIT

  // The far plane must clear the opposite rim of the graph at this
  // distance — the constructor's 400-unit cap clips deep manifests.
  return { graphR, camDist, far: camDist + graphR * 3 }
}

/**
 * The three.js/WebGL arm of the architecture scene — the original
 * renderer, kept as the synchronous fallback for every device without
 * WebGPU (and the `?debug=webGLMode:fallback` probe). Returns null when
 * no GL context can be acquired; the composite then reports `onLost`.
 * @param canvas   Target canvas.
 * @param roots    Manifest root buckets.
 * @param onPick   Called with the manifest path on a node pick.
 * @param onLost   Called when the WebGL context is lost mid-flight.
 * @returns The scene handle, or null when no GL context exists.
 */
export const mountArchSceneThree = (
  canvas: HTMLCanvasElement,
  roots: Array<{ root: string; label: string; children: DocsNode[] }>,
  onPick: (_path: string) => void,
  onLost?: () => void
): ArchSceneHandle | null => {
  // three's WebGLRenderer requires WebGL2 (r163+ dropped WebGL1) — probe
  // webgl2 first, then the plain webgl alias; a null either way means the
  // scene stays unmounted and the caller hides the section.
  const gl = webglContext(canvas, { antialias: true, alpha: true }, true)

  if (!gl) return null

  let renderer: THREE.WebGLRenderer

  try {
    renderer = new THREE.WebGLRenderer({ canvas, context: gl, alpha: true, antialias: true })
  } catch (err) {
    devWarn('docs arch-scene renderer failed', err)

    return null
  }

  const scene = new THREE.Scene()

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400)

  const placed = placeRoots(roots)

  const { graphR, camDist, far } = graphFit(placed)

  camera.position.set(0, camDist * DOCS_UNITS.SCENE_CAMERA_LIFT, camDist)

  camera.far = far

  camera.updateProjectionMatrix()

  const controls = new OrbitControls(camera, canvas)

  // Reduced-motion viewers never reach this scene — webglAllowed()
  // refuses the context upstream, so the map stays the static DOM
  // index for them rather than a half-gated canvas.
  controls.enableDamping = true
  controls.autoRotate = true
  controls.autoRotateSpeed = DOCS_UNITS.SCENE_ROTATE_SPEED

  // Restore the user's camera + rotation-off flag from sessionStorage —
  // once the scene has been steered it remembers the pose across docs
  // navigations (remounts) and stops the idle drift.
  const saved = readCamState()

  if (saved) {
    camera.position.set(saved.p[0], saved.p[1], saved.p[2])

    controls.target.set(saved.t[0], saved.t[1], saved.t[2])

    controls.autoRotate = !saved.off
  }

  // Intro settle: a fresh (unrestored) mount eases the whole graph in
  // from SCENE_INTRO_TURN radians — the "object swings into place" read
  // the portal opened with before ambient autorotate takes over. A
  // restored pose lands directly on the user's view instead.
  const introFrom = saved ? 0 : DOCS_UNITS.SCENE_INTRO_TURN

  /** Serializes camera pose + interaction flag into sessionStorage. */
  const saveCamState = () => {
    try {
      if (typeof sessionStorage === TYPE_STRINGS.UNDEFINED) return

      const state: SceneCamState = {
        p: [camera.position.x, camera.position.y, camera.position.z],
        t: [controls.target.x, controls.target.y, controls.target.z],
        off: !controls.autoRotate,
      }

      sessionStorage.setItem(CACHE_STORAGE_KEYS.DOCS_SCENE_STATE, JSON.stringify(state))
    } catch {
      /* quota/security errors — persistence is best-effort */
    }
  }

  /** Docs path currently highlighted — '' matches the portal-root node. */
  let activePath: string = CHAR_STRINGS.EMPTY

  /** Manifest path → placed world position + ring depth — buildGraph
   *  fills it so the map can glide the camera onto the active location. */
  const nodeTargets = new Map<string, { pos: THREE.Vector3; depth: number }>()

  /** Focus glide state — the orbit target eases toward the active
   *  node's position and the camera dollies to a depth-scaled distance,
   *  so picking a route re-centers the map on that location. */
  const focusNode = new THREE.Vector3(0, 0, 0)

  let focusDist = camDist

  let focusing = false

  /**
   * Arms the focus glide for a docs location — '' or an unknown path
   * falls back to the portal root at origin with the full-graph camera
   * distance; placed nodes aim at their position with a depth-scaled
   * dolly. Positions land async (worker) — buildGraph re-arms the focus
   * for whatever path is active when they arrive.
   */
  const startFocus = (path: string) => {
    const hit = path === CHAR_STRINGS.EMPTY ? undefined : nodeTargets.get(path)

    focusNode.set(hit?.pos.x ?? 0, hit?.pos.y ?? 0, hit?.pos.z ?? 0)

    focusDist =
      !hit || hit.depth === 0
        ? camDist
        : Math.min(camDist, DOCS_UNITS.SCENE_FOCUS_MIN + hit.depth * DOCS_UNITS.SCENE_FOCUS_STEP)

    focusing = true
  }

  // First user gesture kills the idle rotation for good; gesture end
  // persists the settled pose. 'start'/'end' are OrbitControls' own
  // event names (not DOM), tokenized in ORBIT_EVENTS. A gesture also
  // cancels an in-flight focus glide — input wins over the camera move.
  const onControlStart = () => {
    controls.autoRotate = false

    focusing = false

    saveCamState()
  }

  const onControlEnd = () => saveCamState()

  controls.addEventListener(ORBIT_EVENTS.START, onControlStart)
  controls.addEventListener(ORBIT_EVENTS.END, onControlEnd)

  // Theme ink for nodes/labels — read once from the canvas' computed
  // style (the stylesheet sets `color: var(--text-primary)` on it), so
  // the scene follows light/dark without a hardcoded color. `CanvasText`
  // is the system-color keyword fallback, never a channel literal.
  const ink = getComputedStyle(canvas).color || 'CanvasText'

  const inkColor = new THREE.Color(ink)

  scene.add(new THREE.AmbientLight(0xffffff, 1))

  // Depth fog — the reference's dark-slate depth cue, themed: the fog
  // color is the page's own --bg-primary, so the far rim dissolves into
  // whatever backdrop sits behind the transparent canvas in either
  // theme. Density scales with the manifest's real radius.
  const fogRgb = parseCssColor(
    getComputedStyle(canvas).getPropertyValue(THEME_CSS_PROPS.BG_PRIMARY)
  )

  if (fogRgb) {
    scene.fog = new THREE.FogExp2(
      new THREE.Color(fogRgb[0], fogRgb[1], fogRgb[2]),
      DOCS_UNITS.SCENE_FOG_DENSITY / graphR
    )
  }

  const labels: LabelRef[] = []

  /**
   * Node draw calls — the procedural-directory look: every directory
   * renders the wireframe folder glyph, every file the folded-page
   * glyph, each through ONE instanced LineSegments draw so the
   * multi-thousand-node graph costs two draw calls (plus the edge set
   * and revealed labels). Picking runs against invisible instanced
   * spheres — wire lines have no surface to raycast and three's line
   * raycast has no instancing path; the pick tier shares the highlight
   * attribute buffers with the glyph geometry.
   */
  let dirMesh: THREE.InstancedMesh | null = null

  let fileMesh: THREE.InstancedMesh | null = null

  /** The instanced wireframe glyph draws — disposed with the scene. */
  let dirGlyph: THREE.LineSegments | null = null

  let fileGlyph: THREE.LineSegments | null = null

  /** placed[] index per instance slot — a raycast instanceId resolves to a node. */
  const dirPlaced: number[] = []

  const filePlaced: number[] = []

  /** Mesh → its placed-index table, so a raycast hit maps back to a path. */
  const pickTables = new Map<THREE.Object3D, number[]>()

  /** Shared pulse clock — patched into both node materials' shaders. */
  const pulseTime = { value: 0 }

  /** Edge geometry + material — assigned inside buildGraph, disposed in destroy(). */
  let lineGeo: THREE.BufferGeometry | null = null

  let edgeMat: THREE.LineBasicMaterial | null = null

  let disposed = false

  /**
   * Rewrites one tier's instanced attributes for the active location:
   * the exact path match pops to SCENE_ACTIVE_OPACITY with the larger
   * pulse scale (aActive=1), and ancestor dirs on its branch lift to
   * SCENE_ANCESTOR_OPACITY so the route's lineage reads on the map.
   * Everything else keeps the faint backdrop alpha for its tier.
   */
  const writeActive = (
    mesh: THREE.InstancedMesh | null,
    idxs: number[],
    baseOpacity: number
  ): void => {
    if (!mesh) return

    const alpha = mesh.geometry.getAttribute(ATTR_A_ALPHA) as THREE.InstancedBufferAttribute
    const act = mesh.geometry.getAttribute(ATTR_A_ACTIVE) as THREE.InstancedBufferAttribute

    idxs.forEach((pi, k) => {
      const p = placed[pi].node.path

      const isActive = p === activePath

      const isAncestor =
        !isActive && p !== CHAR_STRINGS.EMPTY && activePath.startsWith(`${p}${CHAR_STRINGS.SLASH}`)

      alpha.setX(
        k,
        isActive
          ? DOCS_UNITS.SCENE_ACTIVE_OPACITY
          : isAncestor
            ? DOCS_UNITS.SCENE_ANCESTOR_OPACITY
            : baseOpacity
      )

      act.setX(k, isActive ? 1 : 0)
    })

    alpha.needsUpdate = true
    act.needsUpdate = true
  }

  const applyActive = () => {
    writeActive(dirMesh, dirPlaced, DOCS_UNITS.SCENE_DIR_OPACITY)
    writeActive(fileMesh, filePlaced, DOCS_UNITS.SCENE_FILE_OPACITY)
  }

  // Context loss mid-flight: stop the loop, tell the host to switch to
  // the non-GL presentation — `webglcontextrestored` on the canvas is the
  // recovery signal (the host remounts the whole scene on it).
  const onContextLost = () => {
    disposed = true

    onLost?.()
  }

  canvas.addEventListener(GL_EVENTS.WEBGL_CONTEXT_LOST, onContextLost)

  /**
   * Populates the scene once the (possibly worker-computed) positions
   * land — meshes, edges, then dir-name labels on top of dir nodes.
   */
  const buildGraph = (xyz: Float32Array) => {
    if (disposed) return

    const positions: THREE.Vector3[] = []

    // Partition nodes into the two instance tiers; labels still key off
    // the world position of their dir.
    placed.forEach(({ node, depth }, i) => {
      const pos = new THREE.Vector3(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2])

      // The synthetic portal root sits at the origin — its depth-0 ring
      // is a single node, so the ring position is meaningless.
      if (!depth) pos.set(0, 0, 0)

      positions.push(pos)

      // First write wins — the `+N` aggregate leaves share their parent
      // dir's path, and a leaf overwriting the dir's own target would
      // drag the focus glide one ring out off-center.
      if (!nodeTargets.has(node.path)) nodeTargets.set(node.path, { pos, depth })

      if (node.type !== 'file') {
        dirPlaced.push(i)
      } else {
        filePlaced.push(i)
      }
    })

    const m4 = new THREE.Matrix4()

    /**
     * Builds one instanced tier — the wireframe glyph as a single
     * instanced LineSegments draw (aOffset/aColor/aPhase/aSpin +
     * aAlpha/aActive drive the vertex shader) plus the invisible
     * instanced pick sphere. The pick geometry SHARES the alpha/active
     * attribute objects with the glyph geometry, so the highlight pass
     * keeps writing one buffer both visuals read.
     * @param verts       Wire segment list (flat xyz pairs).
     * @param baseOpacity Resting alpha for the tier.
     * @param idxs        placed[] indexes in this tier.
     * @param rgbOf       Per-node ink resolver (icon-pack palette).
     * @returns {glyph, pick} — draw object + pick mesh.
     */
    const buildTier = (
      verts: Float32Array,
      baseOpacity: number,
      idxs: number[],
      rgbOf: (_pi: number) => number[]
    ): { glyph: THREE.LineSegments; pick: THREE.InstancedMesh } => {
      const n = idxs.length
      const offs = new Float32Array(n * 3)
      const cols = new Float32Array(n * 3)
      const phases = new Float32Array(n)
      const spins = new Float32Array(n)
      const alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(baseOpacity), 1)
      const activeAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1)

      idxs.forEach((pi, k) => {
        const p = positions[pi]
        const rgb = rgbOf(pi)

        offs[k * 3] = p.x
        offs[k * 3 + 1] = p.y
        offs[k * 3 + 2] = p.z
        cols[k * 3] = rgb[0]
        cols[k * 3 + 1] = rgb[1]
        cols[k * 3 + 2] = rgb[2]

        // Golden-angle hashes — decorrelated bob phase + initial yaw
        // so neighboring glyphs never animate in lockstep.
        phases[k] = pi * DOCS_UNITS.SCENE_Y_HASH
        spins[k] = pi * DOCS_UNITS.SCENE_SPIN_HASH
      })

      const geo = new THREE.InstancedBufferGeometry()

      geo.instanceCount = n
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
      geo.setAttribute(ATTR_A_OFFSET, new THREE.InstancedBufferAttribute(offs, 3))
      geo.setAttribute(ATTR_A_COLOR, new THREE.InstancedBufferAttribute(cols, 3))
      geo.setAttribute(ATTR_A_PHASE, new THREE.InstancedBufferAttribute(phases, 1))
      geo.setAttribute(ATTR_A_SPIN, new THREE.InstancedBufferAttribute(spins, 1))
      geo.setAttribute(ATTR_A_ALPHA, alphaAttr)
      geo.setAttribute(ATTR_A_ACTIVE, activeAttr)

      const mat = new THREE.LineBasicMaterial({ transparent: true })

      patchGlyphMaterial(mat, pulseTime)

      const glyph = new THREE.LineSegments(geo, mat)

      // Instance positions live in aOffset — the geometry's own bound
      // is a single glyph at origin; culling on it would drop the tier.
      glyph.frustumCulled = false

      scene.add(glyph)

      // Invisible instanced pick spheres — wire lines carry no raycast
      // surface. Sharing alphaAttr/activeAttr keeps writeActive single-
      // buffer: the glyph shader sees the same writes the tests read
      // back off the pick geometry.
      const pickGeo = new THREE.SphereGeometry(wireBound(verts), 12, 12)

      pickGeo.setAttribute(ATTR_A_ALPHA, alphaAttr)
      pickGeo.setAttribute(ATTR_A_ACTIVE, activeAttr)

      const pick = new THREE.InstancedMesh(pickGeo, new THREE.MeshBasicMaterial(), n)

      pick.visible = false

      idxs.forEach((pi, k) => {
        m4.setPosition(positions[pi])

        pick.setMatrixAt(k, m4)
      })

      pick.instanceMatrix.needsUpdate = true

      scene.add(pick)

      pickTables.set(pick, idxs)

      return { glyph, pick }
    }

    const dirWire = dirWireVerts()
    const fileWire = fileWireVerts()

    // Per-kind palette — file nodes wear the treeview icon pack's own
    // ink (yellow .js, blue .ts, orange .html…) so the map reads with
    // the same color code as the file list. Probes resolve inside the
    // shadow root; missing styles fall back to the dir accent ink.
    const kinds = new Set<string>()

    placed.forEach(({ node }) => {
      if (node.type === 'file' && !node.aggregate) kinds.add(kindFor(node.name))
    })

    const kindInks = probeIconInks(canvas.parentElement ?? canvas, [...kinds])

    const accentRgb = parseCssColor(ink) ?? [1, 1, 1]

    const dirTier = buildTier(dirWire, DOCS_UNITS.SCENE_DIR_OPACITY, dirPlaced, () => accentRgb)

    dirMesh = dirTier.pick
    dirGlyph = dirTier.glyph

    const fileTier = buildTier(fileWire, DOCS_UNITS.SCENE_FILE_OPACITY, filePlaced, (pi) =>
      placed[pi].node.aggregate
        ? accentRgb
        : (kindInks.get(kindFor(placed[pi].node.name)) ?? accentRgb)
    )

    fileMesh = fileTier.pick
    fileGlyph = fileTier.glyph

    placed.forEach(({ node, depth }, i) => {
      if (node.type === 'file' || depth > DOCS_UNITS.SCENE_LABEL_MAX_DEPTH) return

      const label = makeLabel(node.name, ink)

      if (label) {
        label.sprite.position.copy(positions[i])

        label.sprite.position.y += DOCS_UNITS.LABEL_LIFT_Y

        // Labels start hidden — the reveal pass flips visibility when
        // the camera is close enough for the name to read.
        label.sprite.visible = false

        scene.add(label.sprite)

        labels.push({ ...label, depth, a: -1 })
      }
    })

    const lineVerts: number[] = []
    const linePhases: number[] = []

    placed.forEach(({ parent }, i) => {
      if (parent < 0) return

      lineVerts.push(
        positions[i].x,
        positions[i].y,
        positions[i].z,
        positions[parent].x,
        positions[parent].y,
        positions[parent].z
      )

      // Each endpoint carries its node's bob phase — the same hash the
      // glyph shader uses, so link ends ride the identical sine as the
      // wireframes they connect (the reference's per-frame link update,
      // but free on the GPU).
      linePhases.push(i * DOCS_UNITS.SCENE_Y_HASH, parent * DOCS_UNITS.SCENE_Y_HASH)
    })

    lineGeo = new THREE.BufferGeometry()

    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3))
    lineGeo.setAttribute(ATTR_A_PHASE, new THREE.Float32BufferAttribute(linePhases, 1))

    edgeMat = new THREE.LineBasicMaterial({
      color: inkColor,
      transparent: true,
      opacity: DOCS_UNITS.SCENE_LINE_OPACITY,
    })

    patchEdgeMaterial(edgeMat, pulseTime)

    scene.add(new THREE.LineSegments(lineGeo, edgeMat))

    // The highlight/focus may have been set while positions were in
    // flight — re-apply both now that the meshes + targets exist.
    applyActive()

    startFocus(activePath)
  }

  void computePositions(placed).then(buildGraph)

  const raycaster = new THREE.Raycaster()

  const pointer = new THREE.Vector2()

  // Tap slop — a drag or pinch shouldn't pick a node. pointerdown stores
  // the anchor; the click handler discards picks past the slop radius so
  // touch gestures stay gestures and taps stay taps.
  let downX = 0

  let downY = 0

  const onPointerDown = (e: PointerEvent) => {
    downX = e.clientX
    downY = e.clientY
  }

  /**
   * Resolves a raycast hit to a manifest path. Instanced hits carry
   * `instanceId` — it indexes the tier's placed table; a hit without an
   * instanceId (older three paths, test doubles) falls back to the
   * object userData contract the pre-instanced scene used.
   */
  const pathForHit = (hit?: THREE.Intersection): string | undefined => {
    if (!hit) return undefined

    const inst = hit.instanceId

    if (typeof inst !== 'number') return hit.object?.userData?.path as string | undefined

    const idxs = pickTables.get(hit.object)

    const pi = idxs?.[inst]

    return pi === undefined ? undefined : placed[pi].node.path
  }

  const onClick = (e: MouseEvent) => {
    if (
      Math.abs(e.clientX - downX) > DOCS_UNITS.TAP_SLOP_PX ||
      Math.abs(e.clientY - downY) > DOCS_UNITS.TAP_SLOP_PX
    ) {
      return
    }

    const rect = canvas.getBoundingClientRect()

    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )

    raycaster.setFromCamera(pointer, camera)

    const pickTargets = [dirMesh, fileMesh].filter((m): m is THREE.InstancedMesh => m !== null)

    const hit = raycaster.intersectObjects(pickTargets)[0]

    const path = pathForHit(hit)

    if (typeof path === TYPE_STRINGS.STRING && path) onPick(path)
  }

  canvas.addEventListener(MOUSE_EVENTS.CLICK, onClick)
  canvas.addEventListener(POINTER_EVENTS.POINTERDOWN, onPointerDown)

  const resize = () => {
    const w = canvas.clientWidth || 320

    const h = canvas.clientHeight || 240

    renderer.setSize(w, h, false)

    camera.aspect = w / h

    camera.updateProjectionMatrix()
  }

  /**
   * One frame: zoom-reveal label pass + renderer.render. Returns false
   * when the GPU/driver threw — the caller treats it exactly like a
   * context loss (the host rebuilds on restore).
   */
  const paintFrame = (): boolean => {
    try {
      const dist = controls.getDistance()

      labels.forEach((l) => {
        const reveal = Math.max(
          DOCS_UNITS.LABEL_REVEAL_MIN,
          DOCS_UNITS.LABEL_REVEAL_BASE - l.depth * DOCS_UNITS.LABEL_DEPTH_STEP
        )

        const a = Math.max(0, Math.min(1, (reveal - dist) / DOCS_UNITS.LABEL_FADE))

        if (a !== l.a) {
          l.material.opacity = a

          l.sprite.visible = a > 0

          l.a = a
        }
      })

      renderer.render(scene, camera)

      return true
    } catch (err) {
      // A crashed renderer/driver throw takes the same path as a real
      // context loss — mark dead, let the host recover.
      devWarn('docs arch-scene tick failed', err)

      onContextLost()

      return false
    }
  }

  /**
   * Print-capture answer — the print adapter dispatches `printcapture` on
   * every canvas before reading it; this scene clears its buffer each frame
   * (no preserveDrawingBuffer), so a toDataURL read mid-loop would return a
   * blank. Re-paint once, then hand the PNG back through event.detail.
   * @param e CustomEvent carrying { dataUrl } — written here on success.
   */
  const onPrintCapture = (e: Event) => {
    const detail = (e as CustomEvent<{ dataUrl?: string }>).detail

    if (paintFrame()) detail.dataUrl = canvas.toDataURL(NET_STRINGS.IMAGE_PNG)
  }

  canvas.addEventListener(PRINT_EVENTS.CAPTURE, onPrintCapture)

  resize()

  // The canvas re-seats between the map column and the zoom dialog —
  // its box changes on every move, so the observer re-fits renderer and
  // camera without the host needing to know where it lives. The work is
  // deferred to rAF: a synchronous renderer.setSize inside the RO
  // notification mutates an observed subtree mid-pass and trips the
  // "ResizeObserver loop completed with undelivered notifications"
  // window error. Guarded: environments without ResizeObserver (older
  // test DOMs) just keep the mount-time size.
  let resizeRaf = 0

  const ro =
    typeof ResizeObserver === TYPE_STRINGS.FUNCTION
      ? new ResizeObserver(() => {
          // Coalesce bursts (a move generates several entries) into one
          // deferred fit per frame — the flag doubles as the pending
          // handle for destroy.
          if (resizeRaf) return

          resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0

            resize()
          })
        })
      : null

  ro?.observe(canvas)

  let raf = 0

  /**
   * Host-driven pause — true while the map column is display:none. The
   * loop stops scheduling entirely (no rAF wakeup, no GPU frame); the
   * flag is also re-checked at tick entry so a pause that lands between
   * schedule and fire still dead-ends the frame.
   */
  let paused = false

  const t0 = performance.now()

  const tick = () => {
    // Context lost mid-flight → stop scheduling; the host owns remount.
    if (disposed || paused) return

    try {
      // Location focus — the orbit target glides onto the active node's
      // position and the camera dollies to the depth-scaled framing
      // distance. Scalar math on pooled fields only: the mock Vector3s
      // in tests carry no method surface and the frame loop stays
      // zero-allocation. The goal is re-based through the intro-settle
      // rotation (rotate about +Y by scene.rotation.y) so the glide
      // tracks the node even while the spin is still unwinding.
      if (focusing) {
        const cy = Math.cos(scene.rotation.y)

        const sy = Math.sin(scene.rotation.y)

        const gx = focusNode.x * cy + focusNode.z * sy

        const gz = focusNode.z * cy - focusNode.x * sy

        const gy = focusNode.y + DOCS_UNITS.SCENE_FOCUS_Y_BIAS

        const ox = camera.position.x - controls.target.x

        const oy = camera.position.y - controls.target.y

        const oz = camera.position.z - controls.target.z

        const len = Math.hypot(ox, oy, oz) || 1

        const k = DOCS_UNITS.SCENE_FOCUS_DAMP

        controls.target.x += (gx - controls.target.x) * k

        controls.target.y += (gy - controls.target.y) * k

        controls.target.z += (gz - controls.target.z) * k

        const nextLen = len + (focusDist - len) * k

        const s = nextLen / len

        camera.position.set(
          controls.target.x + ox * s,
          controls.target.y + oy * s,
          controls.target.z + oz * s
        )

        if (
          Math.hypot(gx - controls.target.x, gy - controls.target.y, gz - controls.target.z) <
            DOCS_UNITS.SCENE_FOCUS_EPS &&
          Math.abs(focusDist - nextLen) < DOCS_UNITS.SCENE_FOCUS_EPS
        ) {
          focusing = false
        }
      }

      controls.update()

      // Intro settle — easeOutCubic from SCENE_INTRO_TURN to 0; after the
      // window the expression evaluates to exactly 0, so the graph rests
      // still and controls.autoRotate owns the ambient drift.
      if (introFrom) {
        const k = Math.min(1, (performance.now() - t0) / DOCS_UNITS.SCENE_INTRO_MS)

        scene.rotation.y = introFrom * Math.pow(1 - k, 3)
      }

      // Slow node pulse — the breathing runs in the vertex shader off
      // the shared clock; the CPU only feeds it the time uniform.
      pulseTime.value = (performance.now() - t0) / 1000
    } catch (err) {
      devWarn('docs arch-scene tick failed', err)

      onContextLost()

      return
    }

    if (!paintFrame()) return

    raf = requestAnimationFrame(tick)
  }

  raf = requestAnimationFrame(tick)

  return {
    setActive(path: string) {
      activePath = path

      applyActive()

      startFocus(path)
    },

    resize,

    setPaused(next: boolean) {
      if (next === paused) return

      paused = next

      if (paused) {
        cancelAnimationFrame(raf)
      } else if (!disposed) {
        // Resume on a fresh size read — the canvas may have re-seated
        // into a different box while the loop was down.
        resize()

        raf = requestAnimationFrame(tick)
      }
    },

    destroy() {
      disposed = true

      ro?.disconnect()

      cancelAnimationFrame(raf)

      cancelAnimationFrame(resizeRaf)

      canvas.removeEventListener(MOUSE_EVENTS.CLICK, onClick)
      canvas.removeEventListener(POINTER_EVENTS.POINTERDOWN, onPointerDown)
      canvas.removeEventListener(GL_EVENTS.WEBGL_CONTEXT_LOST, onContextLost)
      canvas.removeEventListener(PRINT_EVENTS.CAPTURE, onPrintCapture)

      controls.removeEventListener(ORBIT_EVENTS.START, onControlStart)
      controls.removeEventListener(ORBIT_EVENTS.END, onControlEnd)

      controls.dispose()

      // InstancedMesh.dispose() releases the instance-matrix buffer; the
      // shared geometry (position + instanced attrs) and material follow.
      ;[dirMesh, fileMesh].forEach((m) => {
        if (!m) return

        m.geometry.dispose()

        ;(m.material as THREE.Material).dispose()

        m.dispose()
      })

      ;[dirGlyph, fileGlyph].forEach((g) => {
        if (!g) return

        g.geometry.dispose()

        ;(g.material as THREE.Material).dispose()
      })

      labels.forEach(({ material }) => {
        material.map?.dispose()

        material.dispose()
      })

      lineGeo?.dispose()

      edgeMat?.dispose()

      renderer.dispose()
    },
  }
}

/**
 * Dual-path mount — the scene3d (rust/WebGPU) engine takes the scene
 * on capable hardware and the three.js arm remains the fallback for
 * every other device, exactly like the widget migrations. Capability
 * order: no `webglAllowed()` (explicit debug fallback / GL block) or
 * no `navigator.gpu` → straight to the three path, which keeps its
 * synchronous null contract. With WebGPU present the wasm arm mounts
 * async; any failure resolves into the three arm inside the same
 * handle (or `onLost` when GL is also absent).
 * @param canvas   Target canvas.
 * @param roots    Manifest root buckets.
 * @param onPick   Called with the manifest path on a node pick.
 * @param onLost   Called once when no GPU path can mount — the host
 *                 hides the section (the three arm's own null return
 *                 already covered the no-WebGPU case).
 * @returns Scene handle, or null only when the synchronous three
 *          probe fails outright.
 */
export const mountArchScene = (
  canvas: HTMLCanvasElement,
  roots: Array<{ root: string; label: string; children: DocsNode[] }>,
  onPick: (_path: string) => void,
  onLost?: () => void
): ArchSceneHandle | null => {
  // The WebGPU arm honours the layer kill-switch — the unverified scene3d
  // path only mounts under `?debug=webgpuWidgets:active`; everywhere else
  // the proven three.js renderer stays authoritative (same rule the
  // widget layer enforces through mountWebGpuWidget).
  if (!webglAllowed() || !hasWebGpu() || !webgpuWidgetsEnabled()) {
    return mountArchSceneThree(canvas, roots, onPick, onLost)
  }

  /** Whichever arm is live — filled when the wasm mount resolves. */
  let inner: ArchSceneHandle | null = null

  /** setActive called before the arm resolves — replayed on mount. */
  let pendingPath: string = CHAR_STRINGS.EMPTY

  /** setPaused called before the arm resolves — replayed on mount. */
  let pendingPaused = false

  /** Teardown while the async mount is in flight. */
  let disposed = false

  /** True once the timeout arm already mounted three.js — a late scene3d
   *  resolution is torn down instead of double-mounting on one canvas. */
  let threeMounted = false

  /**
   * Deadline guard: scene3d mount chains adapter → device → wasm
   * artifact → surface configure — any stalled await leaves the canvas
   * blank forever. Past the bound, the three.js arm mounts on the same
   * canvas (a canvas bound 'webgpu' earlier by the attempt cannot hand
   * out webgl — mountScene3d only binds after device+artifact land, so
   * a timeout here means the canvas is still clean in practice; when it
   * isn't, the three probe resolves null and onLost hides the section).
   */
  const mountTimer = setTimeout(() => {
    threeMounted = true
    inner = mountArchSceneThree(canvas, roots, onPick, onLost)

    if (!inner) {
      onLost?.()

      return
    }

    inner.setActive(pendingPath)
    inner.setPaused(pendingPaused)
  }, DOCS_UNITS.SCENE3D_MOUNT_TIMEOUT)

  void mountArchScene3d(canvas, roots, onPick).then((h) => {
    clearTimeout(mountTimer)

    if (disposed || threeMounted) {
      h?.destroy()

      return
    }

    inner = h ?? mountArchSceneThree(canvas, roots, onPick, onLost)

    if (!inner) {
      // No WebGPU artifact AND no WebGL — the host hides the section.
      onLost?.()

      return
    }

    inner.setActive(pendingPath)
    inner.setPaused(pendingPaused)
  })

  return {
    setActive(path: string) {
      pendingPath = path

      inner?.setActive(path)
    },

    /** Delegates to whichever arm won the mount race (3d or three). */
    resize() {
      inner?.resize()
    },

    /**
     * Pause/unpause passthrough — a pause that lands before the async
     * arm resolves is replayed onto `inner` right after mount.
     */
    setPaused(next: boolean) {
      pendingPaused = next

      inner?.setPaused(next)
    },

    destroy() {
      disposed = true

      clearTimeout(mountTimer)
      inner?.destroy()
    },
  }
}
