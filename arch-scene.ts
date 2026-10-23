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
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { GL_EVENTS, MOUSE_EVENTS, ORBIT_EVENTS, POINTER_EVENTS } from '@core/tokens/events/dom.js'
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

const instancedVertexPreamble = `uniform float uTime;\nattribute float ${ATTR_A_ALPHA};\nattribute float ${ATTR_A_ACTIVE};\nvarying float vAlpha;\n`

const instancedVertexPulse =
  `${GLSL_BEGIN_VERTEX}\n` +
  `transformed *= (1.0 + sin(uTime * ${DOCS_UNITS.SCENE_PULSE_SPEED} + float(gl_InstanceID) * 0.7) * ${DOCS_UNITS.SCENE_PULSE_AMP}) * (1.0 + ${ATTR_A_ACTIVE} * ${DOCS_UNITS.SCENE_ACTIVE_SCALE - 1.0});\n` +
  `vAlpha = ${ATTR_A_ALPHA};\n`

const instancedFragmentPreamble = 'varying float vAlpha;\n'

const instancedFragmentAlpha = `${GLSL_COLOR_FRAGMENT}\ndiffuseColor.a *= vAlpha;\n`

/**
 * Patches a node material so the pulse scale and per-instance alpha run
 * in-shader: `uTime` is the shared clock, `aAlpha`/`aActive` are the
 * instanced attribute streams the highlight pass rewrites on demand.
 */
const patchNodeMaterial = (mat: THREE.MeshBasicMaterial, pulseTime: { value: number }): void => {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = pulseTime

    shader.vertexShader =
      instancedVertexPreamble + shader.vertexShader.replace(GLSL_BEGIN_VERTEX, instancedVertexPulse)

    shader.fragmentShader =
      instancedFragmentPreamble +
      shader.fragmentShader.replace(GLSL_COLOR_FRAGMENT, instancedFragmentAlpha)
  }
}

/**
 * Flattens the manifest tree into positioned node descriptors: depth sets
 * the ring radius, sibling order spreads the angle. Recursive per the
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
  const span = (to - from) / Math.max(nodes.length, 1)

  nodes.forEach((node, i) => {
    const angle = from + span * (i + 0.5)

    const idx = acc.length

    acc.push({ node, depth, angle, parent })

    if (node.children?.length) {
      layoutNodes(node.children, depth + 1, angle - span / 2, angle + span / 2, idx, acc)
    }
  })

  return acc
}

/**
 * Main-thread twin of the DOCS_SCENE_LAYOUT worker op — the batch
 * fallback for when the wasm pool is unavailable (tests, worker-less
 * environments). Ring radius grows with depth; y alternates per ring and
 * adds a slow sine wave for vertical separation.
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
      Math.sin(angles[i] * 2) * DOCS_UNITS.SCENE_Y_WAVE
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
 * The manifest buckets hang off a synthetic center node — the portal
 * root level IS the tree root, so the scene reads as one rooted graph
 * (center = "In-depth project docs", ring 1 = the four buckets, …).
 * Buckets are { root, label, children } — mapped to dir nodes here so
 * they carry a real path (pickable + highlightable) and a real label.
 * Shared by the three.js and scene3d arms.
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
      children: roots.map((r) => ({
        type: 'dir' as const,
        name: r.label,
        path: r.root,
        children: r.children,
      })),
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

  const { camDist, far } = graphFit(placed)

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

  // First user gesture kills the idle rotation for good; gesture end
  // persists the settled pose. 'start'/'end' are OrbitControls' own
  // event names (not DOM), tokenized in ORBIT_EVENTS.
  const onControlStart = () => {
    controls.autoRotate = false

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

  const labels: LabelRef[] = []

  /**
   * Node draw calls — every dir sphere renders through ONE InstancedMesh,
   * every file sphere through another, so the multi-thousand-node graph
   * costs two draws instead of one call per node (plus the line set and
   * the revealed labels). Weak GPUs/tablets keep their frame budget.
   */
  let dirMesh: THREE.InstancedMesh | null = null

  let fileMesh: THREE.InstancedMesh | null = null

  /** placed[] index per instance slot — a raycast instanceId resolves to a node. */
  const dirPlaced: number[] = []

  const filePlaced: number[] = []

  /** Mesh → its placed-index table, so a raycast hit maps back to a path. */
  const pickTables = new Map<THREE.Object3D, number[]>()

  /** Shared pulse clock — patched into both node materials' shaders. */
  const pulseTime = { value: 0 }

  /** Edge geometry — assigned inside buildGraph, disposed in destroy(). */
  let lineGeo: THREE.BufferGeometry | null = null

  /** Docs path currently highlighted — '' matches the portal-root node. */
  let activePath: string = CHAR_STRINGS.EMPTY

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

      if (node.type !== 'file') {
        dirPlaced.push(i)
      } else {
        filePlaced.push(i)
      }
    })

    const m4 = new THREE.Matrix4()

    /**
     * Builds one instanced tier — shared sphere geometry, one material,
     * static instance matrices, and the two instanced attribute streams
     * (alpha / active) the highlight pass owns.
     */
    const buildTier = (
      radius: number,
      baseOpacity: number,
      idxs: number[]
    ): THREE.InstancedMesh => {
      const geo = new THREE.SphereGeometry(radius, 12, 12)

      const mat = new THREE.MeshBasicMaterial({ color: inkColor, transparent: true })

      patchNodeMaterial(mat, pulseTime)

      const mesh = new THREE.InstancedMesh(geo, mat, idxs.length)

      geo.setAttribute(
        ATTR_A_ALPHA,
        new THREE.InstancedBufferAttribute(new Float32Array(idxs.length).fill(baseOpacity), 1)
      )

      geo.setAttribute(
        ATTR_A_ACTIVE,
        new THREE.InstancedBufferAttribute(new Float32Array(idxs.length), 1)
      )

      idxs.forEach((pi, k) => {
        m4.setPosition(positions[pi])

        mesh.setMatrixAt(k, m4)
      })

      mesh.instanceMatrix.needsUpdate = true

      scene.add(mesh)

      pickTables.set(mesh, idxs)

      return mesh
    }

    dirMesh = buildTier(DOCS_UNITS.SCENE_DIR_RADIUS, DOCS_UNITS.SCENE_DIR_OPACITY, dirPlaced)

    fileMesh = buildTier(DOCS_UNITS.SCENE_FILE_RADIUS, DOCS_UNITS.SCENE_FILE_OPACITY, filePlaced)

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
    })

    lineGeo = new THREE.BufferGeometry()

    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3))

    scene.add(
      new THREE.LineSegments(
        lineGeo,
        new THREE.LineBasicMaterial({
          color: inkColor,
          transparent: true,
          opacity: DOCS_UNITS.SCENE_LINE_OPACITY,
        })
      )
    )

    // The highlight may have been set while positions were in flight —
    // re-apply now that the meshes exist.
    applyActive()
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

  resize()

  let raf = 0

  const t0 = performance.now()

  const tick = () => {
    // Context lost mid-flight → stop scheduling; the host owns remount.
    if (disposed) return

    try {
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
    },

    destroy() {
      disposed = true

      cancelAnimationFrame(raf)

      canvas.removeEventListener(MOUSE_EVENTS.CLICK, onClick)
      canvas.removeEventListener(POINTER_EVENTS.POINTERDOWN, onPointerDown)
      canvas.removeEventListener(GL_EVENTS.WEBGL_CONTEXT_LOST, onContextLost)

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

      labels.forEach(({ material }) => {
        material.map?.dispose()

        material.dispose()
      })

      lineGeo?.dispose()

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
  })

  return {
    setActive(path: string) {
      pendingPath = path

      inner?.setActive(path)
    },

    destroy() {
      disposed = true

      clearTimeout(mountTimer)
      inner?.destroy()
    },
  }
}
