/**
 * @file docs/arch-scene.ts
 * @description Interactive three.js visualization of the docs manifest —
 * the architecture/org structure rendered as a 3D radial tree: each
 * directory is a node on its depth ring, edges draw parent→child, glyph
 * cards billboard to face the camera (no autorotate, no per-node spin —
 * the map only moves when the viewer drags it), nodes pulse/bob on a
 * slow organic drift and click-to-pick navigates the portal.
 * Directory names ride on sprite labels that reveal at a fraction of
 * the full-graph camera distance, so names stay readable from the
 * overview framing inward.
 *
 * WebGL context acquisition goes through `webglContext()` (the project
 * choke point) and is handed to three's WebGLRenderer, so the
 * `?debug=webGLMode:fallback` surface and pool hygiene stay authoritative.
 * All per-frame math lives on the GPU/three transforms — the rAF tick only
 * feeds the shared time uniform, per the compute-placement rule.
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

/** A flattened manifest node with its depth, sibling slot and parent. */
export interface PlacedNode {
  node: DocsNode
  depth: number
  angle: number
  parent: number
  /** Index among this node's siblings (0-based) — the Fibonacci slot. */
  sib: number
  /** Sibling count sharing the same parent — sizes the sphere fan. */
  sibCount: number
}

/** A dir-name sprite with the depth it answers to (zoom-reveal bucket). */
interface LabelRef {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  depth: number
  /** Last written alpha — opacity writes and visibility flips are dirty-gated. */
  a: number
}

/** One rendered node tier — the solid fill, the seam strokes that keep
 *  the icon's form legible, and the invisible pick spheres. */
interface GlyphTier {
  fill: THREE.Mesh
  seam: THREE.LineSegments
  pick: THREE.InstancedMesh
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
const ATTR_A_SCALE = DOCS_STRINGS.SCENE_ATTR_SCALE

/**
 * Filled-glyph shader contract — the per-node placement and per-kind
 * ink run entirely in the vertex/fragment stages so ~7k glyph instances
 * cost one draw call per tier and ZERO per-frame CPU writes:
 *
 *   p      = camRight·x + camUp·y + camBack·z               — billboard:
 *            local card axes ride the camera's world axes (viewMatrix
 *            rows), so every icon faces the viewer and never spins
 *   p     *= aScale                                        — orbit-proportional glyph
 *   p     *= (1 + sin(uTime·PULSE + i·0.7)·AMP)            — ambient pulse
 *          · (1 + aActive·(SCENE_ACTIVE_SCALE − 1))        — active pop
 *   off    = aOffset + (0, sin(uTime·BOB + aPhase)·BAMP, 0)
 *   result = p + off                                      — bob + place
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
  `attribute float ${ATTR_A_ALPHA};\n` +
  `attribute float ${ATTR_A_ACTIVE};\n` +
  `attribute float ${ATTR_A_SCALE};\n` +
  `varying vec3 vColor;\nvarying float vAlpha;\n`

const glyphVertexTransform =
  `${GLSL_BEGIN_VERTEX}\n` +
  // The tier meshes sit unrotated at the scene root, so local space IS
  // world space: rebuilding the card on the camera basis billboards it.
  `vec3 _rt = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);\n` +
  `vec3 _up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);\n` +
  `vec3 _fw = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);\n` +
  `vec3 _p = _rt * transformed.x + _up * transformed.y + _fw * transformed.z;\n` +
  `_p *= ${ATTR_A_SCALE};\n` +
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
const patchGlyphMaterial = (mat: THREE.Material, clock: { value: number }): void => {
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

    acc.push({ node, depth, angle, parent, sib: i, sibCount: nodes.length })

    if (node.children?.length) {
      layoutNodes(node.children, depth + 1, cursor, cursor + span, idx, acc)
    }

    cursor += span
  })

  return acc
}

/**
 * Subtree-extent cluster packing — the hairball fix. The orbit radius at
 * which node `i`'s children fan around it must clear the whole bounding
 * sphere of the FATTEST child subtree, not just a sibling-count chord:
 * two siblings MIN_SEP apart each carrying a descendant cloud of radius
 * `ext` need their centers ≥ 2·ext + MIN_SEP units apart or the clouds
 * interpenetrate and weld into the glued mess the old sep-only radii
 * produced.
 *
 * Runs as a bottom-up pass (reverse `placed` order — `layoutNodes`
 * always emits parents before children, so reversed iteration resolves
 * every child before its parent):
 *
 *   ext[i]     = leaf  → glyph radius
 *              = inner → cluster[i] + max(ext over children)
 *   cluster[i] = max(
 *     SCENE_MIN_ORBIT,                                  // lone-child floor
 *     (2·maxChildExt + MIN_SEP) / (2·sin(π/kids)),      // sibling clear
 *     glyphRadius(i) + maxChildExt + MIN_SEP            // glyph clears cloud
 *   )
 *
 * The sibling-clear term is the ring bound `chord = 2R·sin(π/n)` solved
 * for R — conservative for the Fibonacci sphere (whose uniform spread
 * beats the ring's worst-case chord), and `ext[0]` ends up the exact
 * bounding radius of the whole graph for the camera fit.
 * @param parents  Parent index per node (-1 = root).
 * @param dirs     1 for directory nodes, 0 for file leaves.
 * @returns `{ cluster, ext }` — child-orbit radius and subtree bounding
 *          radius per node.
 */
const clusterRadii = (parents: number[]): { cluster: Float64Array } => {
  const n = parents.length
  const kids = new Int32Array(n)
  const cluster = new Float64Array(n)

  for (let i = 0; i < n; i++) {
    const p = parents[i] as number

    if (p >= 0) kids[p]++
  }

  // Forward pass — parents precede children in placed order, so a
  // node's own cluster can inherit the orbit it sits on:
  //
  //   cluster(i) = max(
  //     SCENE_MIN_ORBIT,                             // lone-child floor
  //     cluster(parent) · SCENE_CHILD_SCALE,       // reference shrink
  //     (2·GLYPH_MAX + MIN_SEP) / (2·sin(π/kids))  // sibling clear
  //   )
  //
  // The sibling-clear term is the ring bound `chord = 2R·sin(π/k)`
  // solved for R — conservative for the Fibonacci sphere (whose uniform
  // spread beats the ring's worst-case chord). It sizes orbits for the
  // LARGEST glyph (SCENE_GLYPH_MAX), so rendered siblings always keep
  // ≥MIN_SEP clear space between glyph faces. Unlike subtree-extent
  // packing this is a single forward pass: sibling clouds may
  // interpenetrate in depth (the reference accepts this — only icons
  // need clear space), which keeps the radius geometric instead of
  // exponential in the tree depth.
  for (let i = 0; i < n; i++) {
    const k = kids[i] as number
    const p = parents[i] as number
    const inherited = p >= 0 ? (cluster[p] as number) * DOCS_UNITS.SCENE_CHILD_SCALE : 0

    cluster[i] =
      k === 0
        ? 0
        : Math.max(
            DOCS_UNITS.SCENE_MIN_ORBIT,
            inherited,
            (2 * DOCS_UNITS.SCENE_GLYPH_MAX + DOCS_UNITS.SCENE_MIN_SEP) /
              (2 * Math.sin(Math.PI / Math.max(k, 2)))
          )
  }

  return { cluster }
}

/**
 * Hierarchical-sphere layout — the procedural-directory reference's
 * model: every node's children orbit it on a Fibonacci sphere
 * (phi = acos(1 − 2·(s+0.5)/n), theta = s·golden-angle) at the
 * parent's cluster radius. Cluster radii come from `clusterRadii` —
 * the reference's shrink-ratio orbits with a sibling-glyph clearance
 * floor, so icons keep ≥SCENE_MIN_SEP of glyph-face clear space while
 * subtree clouds compress geometrically (the hairball fix: strict
 * non-interpenetration grows exponentially and is unreadable past a
 * few hundred nodes).
 * Runs iteratively: `layoutNodes` always emits a parent before
 * its children, so `placed`-order evaluation sees resolved parents.
 * @param parents Parent index per node (-1 = root).
 * @param sibs Sibling slot per node.
 * @param sibCounts Sibling count per node.
 * @param dirs 1 for directory nodes, 0 for file leaves.
 * @returns `{ xyz, scale }` — position triplets and the proportional
 *          glyph scale per node (max(1, FIT·orbit/base)).
 */
const layoutPositionsJs = (
  parents: number[],
  sibs: number[],
  sibCounts: number[],
  dirs: number[]
): { xyz: Float32Array; scale: Float32Array } => {
  const n = parents.length
  const xyz = new Float32Array(n * 3)
  const scale = new Float32Array(n)
  const { cluster } = clusterRadii(parents)

  for (let i = 0; i < n; i++) {
    const p = parents[i] as number
    const orbit = p < 0 ? (cluster[0] as number) : (cluster[p] as number)
    const c = Math.max(sibCounts[i] as number, 1)
    const s = sibs[i] as number
    const base = dirs[i] ? DOCS_UNITS.SCENE_DIR_RADIUS : DOCS_UNITS.SCENE_FILE_RADIUS

    // The reference's icon-to-orbit ratio: glyph inflates to
    // SCENE_GLYPH_FIT of the orbit it sits on, capped at
    // SCENE_GLYPH_MAX (the size the sibling chord is guaranteed
    // against — a glyph can never outgrow its slot). The root itself
    // always renders at GLYPH_MAX — it is the big center hub.
    scale[i] =
      p < 0
        ? DOCS_UNITS.SCENE_GLYPH_MAX / base
        : Math.max(
            1,
            Math.min(DOCS_UNITS.SCENE_GLYPH_FIT * orbit, DOCS_UNITS.SCENE_GLYPH_MAX) / base
          )

    if (p < 0) continue

    // Fibonacci sphere point around the parent's position.
    const phi = Math.acos(1 - (2 * (s + 0.5)) / c)
    const theta = s * DOCS_UNITS.SCENE_Y_HASH + p * DOCS_UNITS.SCENE_SPIN_HASH

    xyz[i * 3] = xyz[p * 3] + orbit * Math.sin(phi) * Math.cos(theta)
    xyz[i * 3 + 1] = xyz[p * 3 + 1] + orbit * Math.cos(phi)
    xyz[i * 3 + 2] = xyz[p * 3 + 2] + orbit * Math.sin(phi) * Math.sin(theta)
  }

  // Pairwise relax — sibling-chord sizing guarantees SIBLING clearance,
  // but deep subtree clouds can still interpenetrate cross-branch (the
  // reference accepts this; the user-facing contract does not). A few
  // Jacobi iterations push the rare colliding pairs apart by half the
  // deficit each — drift stays local, orbits stay readable. Layout-time
  // only (O(n²·iters) on the capped ~hundreds-node scene tree).
  const radii = new Float64Array(n)

  for (let i = 0; i < n; i++) {
    radii[i] =
      (dirs[i] ? DOCS_UNITS.SCENE_DIR_RADIUS : DOCS_UNITS.SCENE_FILE_RADIUS) * (scale[i] as number)
  }

  for (let iter = 0; iter < DOCS_UNITS.SCENE_RELAX_ITERS; iter++) {
    let moved = false

    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const need = (radii[a] as number) + (radii[b] as number) + DOCS_UNITS.SCENE_MIN_SEP
        const dx = (xyz[b * 3] as number) - (xyz[a * 3] as number)
        const dy = (xyz[b * 3 + 1] as number) - (xyz[a * 3 + 1] as number)
        const dz = (xyz[b * 3 + 2] as number) - (xyz[a * 3 + 2] as number)
        const d = Math.hypot(dx, dy, dz)

        if (d >= need) continue

        // Coincident centers → push along the deterministic parent
        // hash. The synthetic root is the graph's origin anchor — it
        // never moves, so the other node absorbs the full deficit.
        // push = deficit/2 per node → an isolated pair clears in one
        // iteration; the loop count is for chained collisions.
        const anchored = a === 0
        const push = (need - d) / (anchored ? 1 : 2)
        const inv = d > 1e-6 ? 1 / d : 0
        const ux = inv ? dx * inv : Math.cos(a * DOCS_UNITS.SCENE_SPIN_HASH)
        const uy = inv ? dy * inv : 0.5
        const uz = inv ? dz * inv : Math.sin(a * DOCS_UNITS.SCENE_SPIN_HASH)

        if (!anchored) {
          xyz[a * 3] = (xyz[a * 3] as number) - ux * push
          xyz[a * 3 + 1] = (xyz[a * 3 + 1] as number) - uy * push
          xyz[a * 3 + 2] = (xyz[a * 3 + 2] as number) - uz * push
        }

        xyz[b * 3] = (xyz[b * 3] as number) + ux * push
        xyz[b * 3 + 1] = (xyz[b * 3 + 1] as number) + uy * push
        xyz[b * 3 + 2] = (xyz[b * 3 + 2] as number) + uz * push

        moved = true
      }
    }

    if (!moved) break
  }

  return { xyz, scale }
}

/**
 * Batch position compute — wasm worker first, local math on failure. The
 * worker replies with a transferable Float32Array; `structuredClone` of
 * the plain-object result also survives when transfer is unsupported.
 * @param placed Flattened tree nodes.
 * @returns xyz triplets, or null when nothing resolved.
 */
export const computePositions = async (
  placed: PlacedNode[]
): Promise<{ xyz: Float32Array; scale: Float32Array }> => {
  const parents = placed.map((p) => p.parent)
  const sibs = placed.map((p) => p.sib ?? 0)
  const sibCounts = placed.map((p) => p.sibCount ?? 1)
  const dirs = placed.map((p) => (p.node.type === 'dir' ? 1 : 0))

  // Worker replies carry the shape `{ id, type, results: { xyz } }` —
  // `results` is the worker-protocol envelope for every op.
  const res = (await wasmPool.dispatch(WASM_ACTIONS.DOCS_SCENE_LAYOUT, {
    parents,
    sibs,
    sibCounts,
    dirs,
  })) as {
    results?: { xyz?: ArrayLike<number>; scale?: ArrayLike<number> }
  } | null

  const xyz = res?.results?.xyz
  const scale = res?.results?.scale

  return xyz && xyz.length === parents.length * 3 && scale && scale.length === parents.length
    ? { xyz: new Float32Array(xyz), scale: new Float32Array(scale) }
    : layoutPositionsJs(parents, sibs, sibCounts, dirs)
}

/**
 * Pushes one triangle (3 verts = 9 floats) onto a flat soup list.
 * @param v The accumulating vert list.
 * @param a First vertex xyz.
 * @param b Second vertex xyz.
 * @param c Third vertex xyz.
 */
const pushTri = (v: number[], a: number[], b: number[], c: number[]): void => {
  v.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
}

/**
 * Pushes one quad as two triangles — vertices arrive in perimeter
 * order a→b→c→d. The glyph materials are DoubleSide, so winding is
 * descriptive only.
 * @param v The accumulating vert list.
 */
const pushQuad = (v: number[], a: number[], b: number[], c: number[], d: number[]): void => {
  pushTri(v, a, b, c)
  pushTri(v, a, c, d)
}

/**
 * Pushes a prism's rim — one wall quad per 2D outline edge spanning
 * the −t..+t thickness, so a die-cut silhouette keeps a clean edge
 * from side-on orbit angles.
 * @param v The accumulating vert list.
 * @param poly 2D outline points in CCW order.
 * @param t Prism half-thickness.
 */
const pushRim = (v: number[], poly: number[][], t: number): void => {
  poly.forEach((a, i) => {
    const nxt = poly[(i + 1) % poly.length] as number[]

    pushQuad(v, [a[0], a[1], -t], [nxt[0], nxt[1], -t], [nxt[0], nxt[1], t], [a[0], a[1], t])
  })
}

/**
 * The folder card's shared 2D anchors — the six-point silhouette
 * (rectangle body + slant-shouldered tab on the top-left, non-convex
 * at the tab foot) plus the shelf height the seam pass inks as the
 * flap line. Fill soup and seam segments both build on these so every
 * draw pass describes the same solid.
 * @returns {poly, shelf, w, t} — outline, shelf y, half-width, half-
 *          thickness.
 */
const dirShape = () => {
  const s = DOCS_UNITS.SCENE_DIR_RADIUS
  const w = s
  const h = s * 0.78
  const shelf = s * 0.42
  const tabW = s * 0.62
  const tabS = s * 0.14
  const t = s * 0.12

  return {
    // CCW silhouette: bottom edge → right wall → shelf → tab slant →
    // tab top → left wall. Non-convex at the tab foot — fill splits on
    // the shelf rather than fanning.
    poly: [
      [-w, -h],
      [w, -h],
      [w, shelf],
      [-w + tabW + tabS, shelf],
      [-w + tabW, h],
      [-w, h],
    ],
    shelf,
    w,
    t,
  }
}

/**
 * The file card's shared 2D anchors — the folded-corner pentagon
 * outline plus the crease point and text-rule heights the seam pass
 * draws. Fill soup and seam segments both build on these so every
 * draw pass describes the same solid.
 * @returns {poly, fold, rules, ruleW, t} — outline, crease point, rule
 *          ys, rule half-width, half-thickness.
 */
const fileShape = () => {
  const s = DOCS_UNITS.SCENE_FILE_RADIUS * 1.3
  const w = s * 0.7
  const h = s
  const c = s * 0.3
  const t = s * 0.12

  return {
    // CCW silhouette — the top-right corner is the dog-ear.
    poly: [
      [-w, -h],
      [w, -h],
      [w, h - c],
      [w - c, h],
      [-w, h],
    ],
    fold: [w - c, h - c],
    rules: [-h * 0.18, -h * 0.52],
    ruleW: w * 0.55,
    t,
  }
}

/**
 * Filled folder glyph — the classic filled-icon silhouette (rect body
 * + tab bump) as a thin extruded card, so the tab reads IN the outline
 * from front, back and glancing angles. The silhouette is non-convex
 * at the tab foot, so the faces split on the shelf: body quad + tab
 * quad, no fan. Pure vertex math — no textures, no imported geometry.
 * Exported: the scene3d arm uploads the same soup.
 * @returns Flat xyz triplets — triangle soup, every 9 floats one tri.
 */
export const dirFillVerts = (): Float32Array => {
  const { poly, t } = dirShape()
  const [p0, p1, p2, p3, p4, p5] = poly as [
    number[],
    number[],
    number[],
    number[],
    number[],
    number[],
  ]
  const shelfL = [p5[0], p2[1]]

  const v: number[] = []
  const f = (p: number[]): number[] => [p[0], p[1], t]
  const b = (p: number[]): number[] => [p[0], p[1], -t]

  // Body + tab quads on both faces.
  pushQuad(v, f(p0), f(p1), f(p2), f(shelfL))
  pushQuad(v, f(shelfL), f(p3), f(p4), f(p5))
  pushQuad(v, b(p0), b(p1), b(p2), b(shelfL))
  pushQuad(v, b(shelfL), b(p3), b(p4), b(p5))

  pushRim(v, poly, t)

  return new Float32Array(v)
}

/**
 * Filled document glyph — the folded-corner page as a thin extruded
 * pentagon prism (the cut corner reads as the fold; the card thickness
 * keeps the solid visible through the edge-on part of its yaw). Scaled
 * to SCENE_FILE_RADIUS·1.3 so leaf glyphs read smaller than folders
 * (the container/item size ratio of the reference). Exported: the
 * scene3d arm uploads the same soup.
 * @returns Flat xyz triplets — triangle soup, every 9 floats one tri.
 */
export const fileFillVerts = (): Float32Array => {
  const { poly, t } = fileShape()
  const p0 = poly[0] as number[]

  const v: number[] = []

  // The pentagon is convex — front face fans from p0; the back mirrors
  // each fan tri with reversed winding.
  for (let i = 1; i < poly.length - 1; i++) {
    const a = poly[i] as number[]
    const nx = poly[i + 1] as number[]

    pushTri(v, [p0[0], p0[1], t], [a[0], a[1], t], [nx[0], nx[1], t])
    pushTri(v, [p0[0], p0[1], -t], [nx[0], nx[1], -t], [a[0], a[1], -t])
  }

  pushRim(v, poly, t)

  return new Float32Array(v)
}

/**
 * Pushes the two seam passes every glyph shares: the silhouette
 * outline on BOTH faces (grown by SCENE_SEAM_GROW so the stroke keys
 * the edge instead of z-fighting it) and the corner struts tying the
 * two outlines into the card's rim.
 * @param v The accumulating segment list (flat xyz pairs).
 * @param poly 2D outline points in CCW order.
 * @param t Prism half-thickness.
 */
const pushSeamOutline = (v: number[], poly: number[][], t: number): void => {
  const grow = DOCS_UNITS.SCENE_SEAM_GROW

  const L = (a: number[], b: number[]): void => {
    v.push(a[0], a[1], a[2], b[0], b[1], b[2])
  }

  poly.forEach((a, i) => {
    const nxt = poly[(i + 1) % poly.length] as number[]
    const ax = a[0] * grow
    const ay = a[1] * grow
    const nx = nxt[0] * grow
    const ny = nxt[1] * grow

    L([ax, ay, t], [nx, ny, t])
    L([ax, ay, -t], [nx, ny, -t])
    L([ax, ay, -t], [ax, ay, t])
  })
}

/**
 * Folder seam segments — the detail strokes a filled icon pack prints
 * on the card: the silhouette outline on both faces, rim struts, and
 * the shelf line that splits flap from body. Face details ride
 * SCENE_SEAM_LIFT·t proud of the panel so they never z-fight the fill.
 * @returns Flat xyz pairs — segment list for the seam LineSegments.
 */
export const dirSeamVerts = (): Float32Array => {
  const { poly, shelf, w, t } = dirShape()

  const v: number[] = []

  pushSeamOutline(v, poly, t)

  const lift = t * DOCS_UNITS.SCENE_SEAM_LIFT
  const pad = w * 0.14

  // The shelf — the flap/body junction of a filled folder icon.
  const L = (a: number[], b: number[]): void => {
    v.push(a[0], a[1], a[2], b[0], b[1], b[2])
  }

  L([-w + pad, shelf, lift], [w - pad, shelf, lift])
  L([-w + pad, shelf, -lift], [w - pad, shelf, -lift])

  return new Float32Array(v)
}

/**
 * File seam segments — the silhouette outline on both faces, rim
 * struts, the dog-ear crease and two text rules: the detail a filled
 * file icon carries once the fill covers the wireframe's empty page.
 * Face details ride SCENE_SEAM_LIFT·t proud of the panel.
 * @returns Flat xyz pairs — segment list for the seam LineSegments.
 */
export const fileSeamVerts = (): Float32Array => {
  const { poly, fold, rules, ruleW, t } = fileShape()

  const v: number[] = []

  pushSeamOutline(v, poly, t)

  const lift = t * DOCS_UNITS.SCENE_SEAM_LIFT
  const [, , tr1, tr2] = poly as [number[], number[], number[], number[], number[]]

  const L = (a: number[], b: number[]): void => {
    v.push(a[0], a[1], a[2], b[0], b[1], b[2])
  }

  // Dog-ear crease + text rules on both faces.
  L([tr2[0], tr2[1], lift], [fold[0], fold[1], lift])
  L([fold[0], fold[1], lift], [tr1[0], tr1[1], lift])
  L([tr2[0], tr2[1], -lift], [fold[0], fold[1], -lift])
  L([fold[0], fold[1], -lift], [tr1[0], tr1[1], -lift])

  rules.forEach((y) => {
    L([-ruleW, y, lift], [ruleW, y, lift])
    L([-ruleW, y, -lift], [ruleW, y, -lift])
  })

  return new Float32Array(v)
}

/**
 * Bounding radius of a glyph vert list — the invisible pick-sphere
 * radius (instanced BufferGeometry isn't on three's raycast path, so
 * picking runs against instanced spheres sized to the glyph's exact
 * bound) and the radius edges clip against. Exported: the scene3d arm
 * sizes its JS-side pick spheres from the same bound.
 * @param verts Flat xyz triplets (segment list or triangle soup).
 */
export const glyphBound = (verts: Float32Array): number => {
  let m = 0

  for (let i = 0; i < verts.length; i += 3) {
    const r = Math.hypot(verts[i], verts[i + 1], verts[i + 2])

    if (r > m) m = r
  }

  return m
}

/**
 * Trims an edge so it stops clear of BOTH glyph faces it connects —
 * the reference's links aim at node surfaces, not centers. Each end
 * pulls back by that node's glyph bound plus SCENE_EDGE_GAP along the
 * edge direction; when nothing is left between the trimmed points the
 * edge would draw inside a glyph, so null is returned and the caller
 * drops the segment (degenerate over-close pairs only — relaxed
 * layouts keep every edge longer than the two radii).
 * @param a Child endpoint xyz.
 * @param b Parent endpoint xyz.
 * @param rA Child glyph radius (glyphBound·scale).
 * @param rB Parent glyph radius.
 * @returns Six clipped coords, or null when fully covered.
 */
export const clipEdge = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  rA: number,
  rB: number
): Float32Array | null => {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const dz = b[2] - a[2]
  const len = Math.hypot(dx, dy, dz)
  const gap = DOCS_UNITS.SCENE_EDGE_GAP
  const spare = len - rA - rB - gap * 2

  if (spare <= 0) return null

  const ux = dx / len
  const uy = dy / len
  const uz = dz / len
  const tA = rA + gap
  const tB = rB + gap

  return new Float32Array([
    a[0] + ux * tA,
    a[1] + uy * tA,
    a[2] + uz * tA,
    b[0] - ux * tB,
    b[1] - uy * tB,
    b[2] - uz * tB,
  ])
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
 * Folder-ink probe — directory glyphs wear the treeview folder's own
 * `color` (the reference pack's gold), sampled off a `--folder` probe
 * span parked inside the portal's shadow root. The custom property
 * resolves to `currentColor` there, so the seam ink comes from the
 * computed text color — the real resolved rgb. Returns null where
 * styles can't compute (tests) — callers fall back to the accent ink.
 * @param host Element inside the .docs shadow tree (canvas's parent).
 * @returns [r,g,b] 0-1 channels, or null.
 */
export const probeFolderInk = (host: Element): number[] | null => {
  const probe = document.createElement(HTML_TAGS.SPAN)

  probe.className = `${DOCS_CLASSES.DOCS_TREE_ICON} ${DOCS_CLASSES.DOCS_TREE_ICON}--${DOCS_CLASSES.DOCS_ICON_KINDS.FOLDER}`
  probe.hidden = true

  host.appendChild(probe)

  const rgb = parseCssColor(getComputedStyle(probe).color)

  probe.remove()

  return rgb
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

/** Persisted camera pose across scene remounts. */
export interface SceneCamState {
  /** camera.position xyz */
  p: [number, number, number]
  /** controls.target xyz */
  t: [number, number, number]
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
      ? { p: d.p as SceneCamState['p'], t: d.t as SceneCamState['t'] }
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
/**
 * Counts a node's whole subtree — the `+N` on a depth-capped dir's
 * aggregate leaf. Recursive per the self-similar-traversal rule.
 * @param node Subtree root.
 * @returns Total descendant count.
 */
const countSceneSubtree = (node: DocsNode): number =>
  (node.children ?? []).reduce((n, c) => n + 1 + countSceneSubtree(c), 0)

const capSceneLeaves = (node: DocsNode, depth = 1): DocsNode => {
  const kids = node.children

  if (!kids?.length) return node

  const aggregate = (hidden: number): DocsNode => ({
    type: 'file',
    name: `${DOCS_STRINGS.AGGREGATE_MARK}${hidden}`,
    path: node.path,
    aggregate: true,
  })

  // Depth cap — the whole subtree collapses into one `+N` leaf that
  // still picks through to this dir's docs page. The raw manifest is
  // ~4.4k nodes/10 rings; guaranteed separation can't render that.
  if (depth >= DOCS_UNITS.SCENE_DEPTH_CAP) {
    return { ...node, children: [aggregate(countSceneSubtree(node))] }
  }

  // The caps shrink with depth — buckets can afford a handful of
  // satellites, but out at rings 4-5 the leaves are pure comb noise,
  // so they all collapse into the `+N` aggregate. Dir fan-out gets the
  // same budget (down to SCENE_DIR_CAP_MIN) so a wide dir can't
  // weld its neighbors shut.
  const fileCap = Math.max(0, DOCS_UNITS.SCENE_FILE_CAP - depth * DOCS_UNITS.SCENE_FILE_CAP_STEP)

  const dirCap = Math.max(
    DOCS_UNITS.SCENE_DIR_CAP_MIN,
    DOCS_UNITS.SCENE_DIR_CAP - depth * DOCS_UNITS.SCENE_DIR_CAP_STEP
  )

  const files = kids.filter((c) => c.type === 'file')

  const dirs = kids.filter((c) => c.type !== 'file')

  const shownFiles = files.slice(0, fileCap)

  const shownDirs = dirs.slice(0, dirCap)

  const children = [...shownDirs.map((c) => capSceneLeaves(c, depth + 1)), ...shownFiles]

  const hidden = files.length - shownFiles.length + dirs.length - shownDirs.length

  if (hidden > 0) children.push(aggregate(hidden))

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

/**
 * Resolves an active docsPath to a placed node — the exact match, or
 * when the scene caps ('+N' aggregates, depth budget) folded the path
 * away, the nearest visible ancestor (longest string-prefix + deepest
 * match wins). Returns -1 for ''/unresolvable paths so the focus falls
 * back to the portal root. Shared by both arms.
 * @param placed Flattened placed tree.
 * @param path   Active docsPath.
 * @returns placed index of the node to light/focus, or -1.
 */
export const resolveScenePath = (placed: readonly PlacedNode[], path: string): number => {
  // '' is the synthetic portal root — it IS a scene node (index 0) and
  // lights as active at the portal root, so it resolves like any path.
  if (!path) return placed.length ? 0 : -1

  let best = -1
  let bestDepth = -1

  for (let i = 0; i < placed.length; i++) {
    const p = placed[i].node.path

    if (p === path) return i

    if (
      p !== CHAR_STRINGS.EMPTY &&
      path.startsWith(`${p}${CHAR_STRINGS.SLASH}`) &&
      placed[i].depth > bestDepth
    ) {
      bestDepth = placed[i].depth
      best = i
    }
  }

  return best
}

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
 * Fit the camera to the real graph radius — the sphere layout spreads
 * clusters along parent orbits, so the bound is the longest orbit
 * chain: distance(node) = orbit(parent→node) + distance(parent),
 * accumulated down each branch. dist = r/sin(fov/2) with ~20% margin
 * frames the whole graph.
 * @param placed The flattened placed tree.
 */
export const graphFit = (placed: readonly PlacedNode[]): GraphFit => {
  // Bounding radius = the longest orbit chain plus the largest glyph —
  // a forward walk over the placed tree (parents precede children, so
  // dist[p] is always resolved before its descendants).
  const parents = placed.map((p) => p.parent)
  const { cluster } = clusterRadii(parents)
  const dist = new Float64Array(placed.length)

  let graphR = DOCS_UNITS.SCENE_GLYPH_MAX

  for (let i = 0; i < placed.length; i++) {
    const p = placed[i].parent

    if (p < 0) continue

    const d = (dist[p] as number) + (cluster[p] as number)

    dist[i] = d

    if (d + DOCS_UNITS.SCENE_GLYPH_MAX > graphR) graphR = d + DOCS_UNITS.SCENE_GLYPH_MAX
  }

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
  // index for them rather than a half-gated canvas. The map never
  // rotates on its own: no autorotate, no intro turn — orbiting is a
  // user-driven gesture only.
  controls.enableDamping = true

  // Restore the user's camera pose from sessionStorage — once the scene
  // has been steered it remembers the pose across docs navigations
  // (remounts).
  const saved = readCamState()

  if (saved) {
    camera.position.set(saved.p[0], saved.p[1], saved.p[2])

    controls.target.set(saved.t[0], saved.t[1], saved.t[2])
  }

  /** Serializes camera pose into sessionStorage. */
  const saveCamState = () => {
    try {
      if (typeof sessionStorage === TYPE_STRINGS.UNDEFINED) return

      const state: SceneCamState = {
        p: [camera.position.x, camera.position.y, camera.position.z],
        t: [controls.target.x, controls.target.y, controls.target.z],
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
    // Aggregated-away paths focus their nearest scene ancestor — the
    // same resolution the highlight pass runs.
    const idx = path === CHAR_STRINGS.EMPTY ? -1 : resolveScenePath(placed, path)
    const hit = idx >= 0 ? nodeTargets.get(placed[idx].node.path) : undefined

    focusNode.set(hit?.pos.x ?? 0, hit?.pos.y ?? 0, hit?.pos.z ?? 0)

    focusDist =
      !hit || hit.depth === 0
        ? camDist
        : Math.min(camDist, DOCS_UNITS.SCENE_FOCUS_MIN + hit.depth * DOCS_UNITS.SCENE_FOCUS_STEP)

    focusing = true
  }

  // Gesture start cancels an in-flight focus glide — input wins over
  // the camera move; gesture end persists the settled pose. 'start'/
  // 'end' are OrbitControls' own event names (not DOM), tokenized in
  // ORBIT_EVENTS.
  const onControlStart = () => {
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
   * Node draw calls — the filled-icon look: every directory renders the
   * folder card, every file the folded-page card, each as ONE instanced
   * Mesh (the solid fill) plus ONE instanced LineSegments (the seams —
   * outline, crease and rule strokes in the page's own background ink,
   * the icon-pack cutout read) so the graph costs four draw calls plus
   * the edge set and revealed labels. Picking runs against invisible
   * instanced spheres — instanced BufferGeometry isn't on three's
   * raycast path; the pick tier shares the highlight attribute buffers
   * with the glyph geometries.
   */
  let dirMesh: THREE.InstancedMesh | null = null

  let fileMesh: THREE.InstancedMesh | null = null

  /** The instanced glyph draws per tier — fill + seams + pick. */
  let dirGlyph: GlyphTier | null = null

  let fileGlyph: GlyphTier | null = null

  /** placed[] index per instance slot — a raycast instanceId resolves to a node. */
  const dirPlaced: number[] = []

  const filePlaced: number[] = []

  /** Mesh → its placed-index table, so a raycast hit maps back to a path. */
  const pickTables = new Map<THREE.Object3D, number[]>()

  /** Shared pulse clock — patched into both node materials' shaders. */
  const pulseTime = { value: 0 }

  /** Edge geometry + material — assigned inside buildGraph, disposed in destroy(). */
  /** Edge geometries + materials — one draw per link tier (dir
   *  skeleton at full ink, leaf links dimmed). */
  const edgeGeos: THREE.BufferGeometry[] = []

  const edgeMats: THREE.LineBasicMaterial[] = []

  let disposed = false

  /**
   * Rewrites one tier's instanced attributes for the active location:
   * the exact path match pops to SCENE_ACTIVE_OPACITY with the larger
   * pulse scale (aActive=1), and ancestor dirs on its branch lift to
   * SCENE_ANCESTOR_OPACITY so the route's lineage reads on the map.
   * Everything else keeps the faint backdrop alpha for its tier.
   * Ancestry walks the placed parent chain — section-group paths
   * ('group/…') aren't string prefixes of their members' manifest
   * paths, so path-prefix matching can't see them.
   */
  const writeActive = (
    mesh: THREE.InstancedMesh | null,
    idxs: number[],
    baseOpacity: number
  ): void => {
    if (!mesh) return

    const alpha = mesh.geometry.getAttribute(ATTR_A_ALPHA) as THREE.InstancedBufferAttribute
    const act = mesh.geometry.getAttribute(ATTR_A_ACTIVE) as THREE.InstancedBufferAttribute

    const activeIdx = resolveScenePath(placed, activePath)
    const ancestors = new Set<string>()

    for (
      let p = activeIdx >= 0 ? (placed[activeIdx].parent as number) : -1;
      p >= 0;
      p = placed[p].parent as number
    ) {
      ancestors.add(placed[p].node.path)
    }

    idxs.forEach((pi, k) => {
      const p = placed[pi].node.path

      const isActive = pi === activeIdx

      const isAncestor = !isActive && p !== CHAR_STRINGS.EMPTY && ancestors.has(p)

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
   * `scale` carries each node's orbit-proportional glyph factor.
   */
  const buildGraph = ({ xyz, scale }: { xyz: Float32Array; scale: Float32Array }) => {
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
     * Builds one instanced tier — the filled glyph as a single
     * instanced Mesh draw plus the seam strokes as a single instanced
     * LineSegments draw (aOffset/aColor/aPhase/aScale +
     * aAlpha/aActive drive the same vertex shader in both), and the
     * invisible instanced pick sphere. All three geometries SHARE the
     * instanced attribute objects, so the highlight pass keeps writing
     * one buffer every visual in the tier reads.
     * @param fillVerts   Glyph triangle soup (flat xyz triplets).
     * @param seamVerts   Detail strokes (flat xyz segment pairs).
     * @param baseOpacity Resting alpha for the tier.
     * @param idxs        placed[] indexes in this tier.
     * @param rgbOf       Per-node ink resolver (icon-pack palette) —
     *                    inks the SEAMS (the icon's outline + details).
     * @param faceRgb     Card-body ink — the page bg so glyph faces read
     *                    as dark cards like the icon pack's paper.
     * @returns {fill, seam, pick} — the tier's draw objects.
     */
    const buildTier = (
      fillVerts: Float32Array,
      seamVerts: Float32Array,
      baseOpacity: number,
      idxs: number[],
      rgbOf: (_pi: number) => number[],
      faceRgb: readonly number[]
    ): GlyphTier => {
      const n = idxs.length
      const offs = new Float32Array(n * 3)
      const cols = new Float32Array(n * 3)
      const faceCols = new Float32Array(n * 3)
      const phases = new Float32Array(n)
      const scales = new Float32Array(n)
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
        faceCols[k * 3] = faceRgb[0]
        faceCols[k * 3 + 1] = faceRgb[1]
        faceCols[k * 3 + 2] = faceRgb[2]
        scales[k] = scale[pi] as number

        // Golden-angle hash — decorrelated bob phase so neighboring
        // glyphs never float in lockstep.
        phases[k] = pi * DOCS_UNITS.SCENE_Y_HASH
      })

      const offAttr = new THREE.InstancedBufferAttribute(offs, 3)
      const phaseAttr = new THREE.InstancedBufferAttribute(phases, 1)
      const scaleAttr = new THREE.InstancedBufferAttribute(scales, 1)

      /**
       * Attaches the tier's shared instanced streams to one geometry —
       * fill, seams and pick proxy all read the same attribute buffer
       * objects, so writeActive's edits land in every draw at once.
       * @param geo The target instanced geometry.
       * @param colAttr Per-instance ink (fill ink or seam ink).
       */
      const bindShared = (
        geo: THREE.InstancedBufferGeometry,
        colAttr: THREE.InstancedBufferAttribute
      ): void => {
        geo.instanceCount = n
        geo.setAttribute(ATTR_A_OFFSET, offAttr)
        geo.setAttribute(ATTR_A_COLOR, colAttr)
        geo.setAttribute(ATTR_A_PHASE, phaseAttr)
        geo.setAttribute(ATTR_A_SCALE, scaleAttr)
        geo.setAttribute(ATTR_A_ALPHA, alphaAttr)
        geo.setAttribute(ATTR_A_ACTIVE, activeAttr)
      }

      const fillGeo = new THREE.InstancedBufferGeometry()

      fillGeo.setAttribute('position', new THREE.Float32BufferAttribute(fillVerts, 3))
      // Faces draw the page body (bg ink); seams carry the kind palette —
      // the icon pack's dark-card + colored-outline read in 3D.
      bindShared(fillGeo, new THREE.InstancedBufferAttribute(faceCols, 3))

      const fillMat = new THREE.MeshBasicMaterial({
        transparent: true,
        side: THREE.DoubleSide,
      })

      patchGlyphMaterial(fillMat, pulseTime)

      const fill = new THREE.Mesh(fillGeo, fillMat)

      const seamGeo = new THREE.InstancedBufferGeometry()

      seamGeo.setAttribute('position', new THREE.Float32BufferAttribute(seamVerts, 3))
      bindShared(seamGeo, new THREE.InstancedBufferAttribute(cols, 3))

      const seamMat = new THREE.LineBasicMaterial({ transparent: true })

      patchGlyphMaterial(seamMat, pulseTime)

      const seam = new THREE.LineSegments(seamGeo, seamMat)

      // Instance positions live in aOffset — the geometries' own bound
      // is a single glyph at origin; culling on it would drop the tier.
      fill.frustumCulled = false
      seam.frustumCulled = false

      scene.add(fill)
      scene.add(seam)

      // Invisible instanced pick spheres — instanced BufferGeometry has
      // no three raycast path. Sharing alphaAttr/activeAttr keeps
      // writeActive single-buffer: the glyph shaders see the same
      // writes the tests read back off the pick geometry.
      const pickGeo = new THREE.SphereGeometry(glyphBound(seamVerts), 12, 12)

      pickGeo.setAttribute(ATTR_A_ALPHA, alphaAttr)
      pickGeo.setAttribute(ATTR_A_ACTIVE, activeAttr)

      const pick = new THREE.InstancedMesh(pickGeo, new THREE.MeshBasicMaterial(), n)

      pick.visible = false

      idxs.forEach((pi, k) => {
        // Pick spheres scale with the rendered glyph — aScale rides the
        // matrix so raycast hits land on the visible glyph bounds.
        const s = scale[pi] as number

        m4.makeScale(s, s, s)
        m4.setPosition(positions[pi])

        pick.setMatrixAt(k, m4)
      })

      pick.instanceMatrix.needsUpdate = true

      scene.add(pick)

      pickTables.set(pick, idxs)

      return { fill, seam, pick }
    }

    const dirFill = dirFillVerts()
    const fileFill = fileFillVerts()
    const dirSeam = dirSeamVerts()
    const fileSeam = fileSeamVerts()

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

    // Card-body ink — the page's own bg color so glyph faces read as the
    // icon pack's dark paper on either theme AND occlude the link web
    // behind them; falls back to dimmed accent ink when --bg-primary
    // can't be parsed (tests, exotic embeds).
    const faceRgb = fogRgb ?? accentRgb.map((x) => x * DOCS_UNITS.SCENE_SEAM_SHADE)

    // Directory outlines wear the treeview folder's gold currentColor,
    // probed off a `--folder` probe (the same ink the DOM pack paints
    // folders with); unstyled environments fall back to the accent.
    const dirRgb = probeFolderInk(canvas.parentElement ?? canvas) ?? accentRgb

    const dirTier = buildTier(
      dirFill,
      dirSeam,
      DOCS_UNITS.SCENE_DIR_OPACITY,
      dirPlaced,
      () => dirRgb,
      faceRgb
    )

    dirMesh = dirTier.pick
    dirGlyph = dirTier

    const fileTier = buildTier(
      fileFill,
      fileSeam,
      DOCS_UNITS.SCENE_FILE_OPACITY,
      filePlaced,
      (pi) =>
        placed[pi].node.aggregate
          ? accentRgb
          : (kindInks.get(kindFor(placed[pi].node.name)) ?? accentRgb),
      faceRgb
    )

    fileMesh = fileTier.pick
    fileGlyph = fileTier

    placed.forEach(({ node, depth }, i) => {
      if (node.type === 'file' || depth > DOCS_UNITS.SCENE_LABEL_MAX_DEPTH) return

      const label = makeLabel(node.name, ink)

      if (label) {
        label.sprite.position.copy(positions[i])

        label.sprite.position.y += DOCS_UNITS.LABEL_LIFT_Y * (scale[i] as number)
        label.sprite.scale.x *= scale[i] as number
        label.sprite.scale.y *= scale[i] as number

        // Labels start hidden — the reveal pass flips visibility when
        // the camera is close enough for the name to read.
        label.sprite.visible = false

        scene.add(label.sprite)

        labels.push({ ...label, depth, a: -1 })
      }
    })

    // Two link tiers: dir→dir edges carry the skeleton at full ink while
    // file leaves dim to SCENE_EDGE_LEAF of it — the leaf web is the
    // majority of segments and was the clutter.
    const dirVerts: number[] = []
    const leafVerts: number[] = []
    const dirPhases: number[] = []
    const leafPhases: number[] = []

    // Per-tier glyph bound — links trim at radius+SCENE_EDGE_GAP on both
    // ends so a line never pierces an icon's seams or faces (reference:
    // links aim at node surfaces with visible clearance, never centers).
    const dirBound = glyphBound(dirSeam)
    const fileBound = glyphBound(fileSeam)

    placed.forEach(({ node, parent }, i) => {
      if (parent < 0) return

      const isDir = node.type !== 'file'

      const seg = clipEdge(
        [positions[i].x, positions[i].y, positions[i].z],
        [positions[parent].x, positions[parent].y, positions[parent].z],
        (isDir ? dirBound : fileBound) * (scale[i] as number),
        // Parents are never files — leaves have no children — so the
        // parent's trim radius is always the dir bound.
        dirBound * (scale[parent] as number)
      )

      if (!seg) return

      // Each endpoint carries its node's bob phase — the same hash the
      // glyph shader uses, so link ends ride the identical sine as the
      // glyphs they connect (the reference's per-frame link update,
      // but free on the GPU).
      const verts = isDir ? dirVerts : leafVerts
      const phases = isDir ? dirPhases : leafPhases

      verts.push(seg[0], seg[1], seg[2], seg[3], seg[4], seg[5])
      phases.push(i * DOCS_UNITS.SCENE_Y_HASH, parent * DOCS_UNITS.SCENE_Y_HASH)
    })

    const linkDraw = (verts: number[], phases: number[], opacity: number): void => {
      if (!verts.length) return

      const geo = new THREE.BufferGeometry()

      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
      geo.setAttribute(ATTR_A_PHASE, new THREE.Float32BufferAttribute(phases, 1))

      const mat = new THREE.LineBasicMaterial({
        color: inkColor,
        transparent: true,
        opacity,
      })

      patchEdgeMaterial(mat, pulseTime)

      edgeGeos.push(geo)
      edgeMats.push(mat)

      scene.add(new THREE.LineSegments(geo, mat))
    }

    linkDraw(dirVerts, dirPhases, DOCS_UNITS.SCENE_LINE_OPACITY)
    linkDraw(leafVerts, leafPhases, DOCS_UNITS.SCENE_LINE_OPACITY * DOCS_UNITS.SCENE_EDGE_LEAF)

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
        // Reveal thresholds are fractions of the full-graph camera
        // distance — they scale with whatever radius the manifest
        // actually spans, so names stay legible from the overview in.
        const reveal =
          Math.max(
            DOCS_UNITS.LABEL_REVEAL_MIN,
            DOCS_UNITS.LABEL_REVEAL_BASE - l.depth * DOCS_UNITS.LABEL_DEPTH_STEP
          ) * camDist

        const a = Math.max(0, Math.min(1, (reveal - dist) / (DOCS_UNITS.LABEL_FADE * camDist)))

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
      // zero-allocation. The graph itself never rotates, so the goal is
      // the node's raw world position.
      if (focusing) {
        const gx = focusNode.x

        const gy = focusNode.y + DOCS_UNITS.SCENE_FOCUS_Y_BIAS

        const gz = focusNode.z

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

      // Ambient pulse/bob — the breathing runs in the vertex shader off
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

        g.fill.geometry.dispose()

        ;(g.fill.material as THREE.Material).dispose()

        g.seam.geometry.dispose()

        ;(g.seam.material as THREE.Material).dispose()
      })

      labels.forEach(({ material }) => {
        material.map?.dispose()

        material.dispose()
      })

      edgeGeos.forEach((g) => g.dispose())

      edgeMats.forEach((m) => m.dispose())

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
