/**
 * @file docs/arch-scene-3d.ts — the rust/scene3d arm of the docs
 * architecture scene. Mounts the `Surface3d` engine on the same canvas
 * the three.js path renders to, rebuilds the radial tree through the
 * engine's flat u32-id API, and drives the frame loop through a
 * `bindOrbit` rig — the same contract as the three arm (saved camera
 * pose, intro settle, node pulse, zoom-reveal labels, tap-slop picking,
 * setActive highlight, destroy teardown).
 *
 * Mapping from the three path: shared SphereGeometry → two
 * `gen_sphere` ids; per-node MeshBasicMaterial → `add_material_basic`
 * (per-node opacity/highlight writes go through `set_color`); the
 * LineSegments edge fan → one `upload_geometry` of cross-quad ribbons
 * (two perpendicular quads per edge — the engine has no line
 * primitive, and a cross reads as a hairline from every orbit angle);
 * SpriteMaterial labels → `upload_texture` of the same 2d label
 * canvas + `add_sprite`; OrbitControls → `bindOrbit` writing
 * `set_orbit`; Raycaster → `ray_at` + JS sphere tests.
 */
import { MOUSE_EVENTS, ORBIT_EVENTS, POINTER_EVENTS } from '@core/tokens/events/dom.js'
import { CACHE_STORAGE_KEYS } from '@core/tokens/data/storage.js'
import { TYPE_STRINGS } from '@core/tokens/strings/types.js'
import { CHAR_STRINGS } from '@core/tokens/strings/chars.js'
import { DOCS_UNITS } from '@core/tokens/strings/docs.js'
import { devWarn } from '@core/devlog.js'
import { mountScene3d, SCENE3D_NONE } from '@core/utils/gpu/scene3d.js'
import type { Scene3dSurface } from '@core/utils/gpu/scene3d.js'
import { bindOrbit } from '@core/utils/gpu/orbit-controller.js'
import type { OrbitController } from '@core/utils/gpu/orbit-controller.js'
import {
  computePositions,
  graphFit,
  makeLabelCanvas,
  placeRoots,
  readCamState,
} from './arch-scene.js'
import type { ArchSceneHandle, PlacedNode } from './arch-scene.js'
import type { DocsNode } from './manifest.js'

/** A pickable node: engine ids + the JS-side state the arms animate. */
interface ArmNode {
  /** Engine node id (set_position/set_scale/set_euler target). */
  node: number
  /** Material id — `set_color` writes the live opacity. */
  mat: number
  /** World position — picking ray sphere-test center. */
  x: number
  y: number
  z: number
  /** Sphere radius for hit tests (pulse widened). */
  radius: number
  /** Manifest path — onPick payload + highlight key. */
  path: string
  /** Resting opacity (dir/file token). */
  baseOpacity: number
  /** Active-highlight scale multiplier applied in the pulse write. */
  activeScale: number
}

/** A dir label: sprite node + material + the zoom-reveal bucket. */
interface ArmLabel {
  /** Engine sprite node. */
  node: number
  /** Sprite material — per-frame `set_color` alpha is the fade. */
  mat: number
  /** Ring depth — the reveal threshold input. */
  depth: number
  /** Last written alpha — dirty-gated so idle frames write nothing. */
  a: number
}

/**
 * Parses a CSS color string into 0-1 rgb channels — the engine takes
 * raw f32 triplets where the three path passed a `THREE.Color`.
 * Handles rgb()/rgba() and #rgb/#rrggbb (what `getComputedStyle`
 * emits); anything else falls back to white — unreachable in real
 * browsers, which always resolve `color` to an rgb() serialization.
 * @param css Computed color string.
 * @returns [r, g, b] in 0-1.
 */
export const parseInk = (css: string): [number, number, number] => {
  const m = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(css)

  if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255]

  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim())

  if (h) {
    const v = h[1]

    if (v.length === 3) {
      return [
        parseInt(v[0] + v[0], 16) / 255,
        parseInt(v[1] + v[1], 16) / 255,
        parseInt(v[2] + v[2], 16) / 255,
      ]
    }

    return [
      parseInt(v.slice(0, 2), 16) / 255,
      parseInt(v.slice(2, 4), 16) / 255,
      parseInt(v.slice(4, 6), 16) / 255,
    ]
  }

  return [1, 1, 1]
}

/**
 * Converts a saved world-space camera position into the orbit rig's
 * spherical pose — the inverse of the Rust rig's
 * `target + d·(cos p·sin y, sin p, cos p·cos y)`.
 * @param p Saved eye position.
 * @param t Saved orbit target.
 * @returns [distance, yaw, pitch].
 */
export const poseFromPos = (
  p: readonly [number, number, number],
  t: readonly [number, number, number]
): [number, number, number] => {
  const dx = p[0] - t[0]
  const dy = p[1] - t[1]
  const dz = p[2] - t[2]
  const d = Math.max(1e-3, Math.hypot(dx, dy, dz))

  return [d, Math.atan2(dx, dz), Math.asin(Math.min(1, Math.max(-1, dy / d)))]
}

/**
 * Expands the parent→child edge list into cross-quad ribbon geometry —
 * two perpendicular quads per edge (the engine draws triangles only;
 * a crossed pair reads as a 1px line strip from every angle). SoA
 * upload: positions + zero normals (basic material is unlit) + zero
 * uvs + triangle indices.
 * @param placed Flattened tree.
 * @param positions xyz triplets per node.
 * @returns The four attribute arrays for `upload_geometry`.
 */
export const buildEdges = (
  placed: readonly PlacedNode[],
  positions: Float32Array
): { pos: Float32Array; nrm: Float32Array; uv: Float32Array; idx: Uint32Array } => {
  const half = DOCS_UNITS.SCENE_EDGE_HALF
  const pos: number[] = []
  const idx: number[] = []

  placed.forEach(({ parent }, i) => {
    if (parent < 0) return

    const ax = positions[i * 3]
    const ay = positions[i * 3 + 1]
    const az = positions[i * 3 + 2]
    const bx = positions[parent * 3]
    const by = positions[parent * 3 + 1]
    const bz = positions[parent * 3 + 2]
    const dx = bx - ax
    const dy = by - ay
    const dz = bz - az
    const len = Math.hypot(dx, dy, dz)

    if (len < 1e-6) return

    const nx = dx / len
    const ny = dy / len
    const nz = dz / len

    // Perp 1: cross(dir, +Y) — degenerates for vertical edges, which
    // fall back to +X (any perpendicular works for a cross pair).
    let px = -nz
    let py = 0
    let pz = nx
    let pl = Math.hypot(px, py, pz)

    if (pl < 1e-6) {
      px = 1
      py = 0
      pz = 0
      pl = 1
    }

    px = (px / pl) * half
    py = (py / pl) * half
    pz = (pz / pl) * half

    // Perp 2: cross(dir, perp1) — the crossed ribbon stays readable
    // edge-on, where a single quad would vanish.
    const qx = ny * pz - nz * py
    const qy = nz * px - nx * pz
    const qz = nx * py - ny * px
    const ql = Math.hypot(qx, qy, qz) || 1
    const rx = (qx / ql) * half
    const ry = (qy / ql) * half
    const rz = (qz / ql) * half

    const base = pos.length / 3

    // Quad A in plane(dir, perp1); quad B in plane(dir, perp2).
    pos.push(
      ax - px,
      ay - py,
      az - pz,
      bx - px,
      by - py,
      bz - pz,
      bx + px,
      by + py,
      bz + pz,
      ax + px,
      ay + py,
      az + pz,
      ax - rx,
      ay - ry,
      az - rz,
      bx - rx,
      by - ry,
      bz - rz,
      bx + rx,
      by + ry,
      bz + rz,
      ax + rx,
      ay + ry,
      az + rz
    )

    for (let q = 0; q < 2; q++) {
      const b4 = base + q * 4

      idx.push(b4, b4 + 1, b4 + 2, b4, b4 + 2, b4 + 3)
    }
  })

  const nv = pos.length / 3

  return {
    pos: new Float32Array(pos),
    nrm: new Float32Array(nv * 3),
    uv: new Float32Array(nv * 2),
    idx: new Uint32Array(idx),
  }
}

/**
 * Mounts the scene3d arm: engine → orbit rig → async graph build →
 * rAF loop. Returns null on ANY engine/artifact failure — the caller
 * (mountArchScene) drops to the three.js path, so this mount can
 * never regress the portal.
 * @param canvas   Target canvas (same element the three path uses).
 * @param roots    Manifest root buckets.
 * @param onPick   Called with the manifest path on a node pick.
 * @returns The scene handle, or null when the engine can't mount.
 */
export const mountArchScene3d = async (
  canvas: HTMLCanvasElement,
  roots: Array<{ root: string; label: string; children: DocsNode[] }>,
  onPick: (_path: string) => void
): Promise<ArchSceneHandle | null> => {
  const handle = await mountScene3d(canvas)

  if (!handle) return null

  const surface: Scene3dSurface = handle.surface
  const placed = placeRoots(roots)
  const { camDist, far } = graphFit(placed)

  surface.set_fov(55)
  surface.set_clip(0.1, far)
  surface.set_clear(0, 0, 0, 0)

  // Orbit rig — the three path's camera sits at (0, camDist·LIFT,
  // camDist): the identical pose in spherical form is
  // dist = camDist·√(1+LIFT²), pitch = atan(LIFT).
  const lift = DOCS_UNITS.SCENE_CAMERA_LIFT
  const dist0 = camDist * Math.hypot(1, lift)

  const ctl: OrbitController = bindOrbit(canvas, {
    distance: dist0,
    pitch: Math.atan(lift),
    minDistance: DOCS_UNITS.SCENE_BASE_RADIUS,
    maxDistance: far,
    // OrbitControls autoRotateSpeed is "revolutions per 60 seconds·speed"
    // — 2π·speed/60 rad/s.
    autoRotateSpeed: (DOCS_UNITS.SCENE_ROTATE_SPEED * Math.PI * 2) / 60,
    damping: 0.08,
  })

  ctl.autoRotate = true

  const saved = readCamState()

  if (saved) {
    const [d, yaw, pitch] = poseFromPos(saved.p, saved.t)

    ctl.setTarget(saved.t[0], saved.t[1], saved.t[2])
    ctl.setPose(d, yaw, pitch)
    ctl.autoRotate = !saved.off
  }

  /** Serializes camera pose + interaction flag into sessionStorage. */
  const saveCamState = () => {
    try {
      if (typeof sessionStorage === TYPE_STRINGS.UNDEFINED) return

      const cp = Math.cos(ctl.pitch)
      const state = {
        p: [
          ctl.tx + ctl.distance * cp * Math.sin(ctl.yaw),
          ctl.ty + ctl.distance * Math.sin(ctl.pitch),
          ctl.tz + ctl.distance * cp * Math.cos(ctl.yaw),
        ],
        t: [ctl.tx, ctl.ty, ctl.tz],
        off: !ctl.autoRotate,
      }

      sessionStorage.setItem(CACHE_STORAGE_KEYS.DOCS_SCENE_STATE, JSON.stringify(state))
    } catch {
      /* quota/security errors — persistence is best-effort */
    }
  }

  const onControlStart = () => {
    ctl.autoRotate = false

    saveCamState()
  }

  const onControlEnd = () => saveCamState()

  ctl.addEventListener(ORBIT_EVENTS.START, onControlStart)
  ctl.addEventListener(ORBIT_EVENTS.END, onControlEnd)

  // Theme ink — same computed-style read as the three arm, parsed to
  // f32 channels (no THREE.Color in this path).
  const ink = parseInk(getComputedStyle(canvas).color || '')

  const pickables: ArmNode[] = []
  const labels: ArmLabel[] = []

  /** Root group — the intro-settle euler target (three's scene.rotation). */
  const graphRoot = surface.add_group(SCENE3D_NONE)

  /** Docs path currently highlighted — '' matches the portal-root node. */
  let activePath: string = CHAR_STRINGS.EMPTY

  let disposed = false

  /**
   * Paints the active-location highlight onto live nodes — same rules
   * as the three arm: exact match pops to SCENE_ACTIVE_OPACITY with a
   * larger pulse scale, ancestors lift to SCENE_ANCESTOR_OPACITY.
   */
  const applyActive = () => {
    pickables.forEach((p) => {
      const isActive = p.path === activePath
      const isAncestor =
        !isActive &&
        p.path !== CHAR_STRINGS.EMPTY &&
        activePath.startsWith(`${p.path}${CHAR_STRINGS.SLASH}`)

      surface.set_color(
        p.mat,
        ink[0],
        ink[1],
        ink[2],
        isActive
          ? DOCS_UNITS.SCENE_ACTIVE_OPACITY
          : isAncestor
            ? DOCS_UNITS.SCENE_ANCESTOR_OPACITY
            : p.baseOpacity
      )

      p.activeScale = isActive ? DOCS_UNITS.SCENE_ACTIVE_SCALE : 1
    })
  }

  /**
   * Populates the scene once positions land — shared dir/file sphere
   * geometries, per-node materials (opacity arms), cross-quad edges,
   * then dir-name labels on top.
   * @param xyz Worker/local position triplets.
   */
  const buildGraph = async (xyz: Float32Array) => {
    if (disposed) return

    const dirGeo = surface.gen_sphere(DOCS_UNITS.SCENE_DIR_RADIUS, 12, 12, false)
    const fileGeo = surface.gen_sphere(DOCS_UNITS.SCENE_FILE_RADIUS, 12, 12, false)

    const labelJobs: Array<Promise<void>> = []

    placed.forEach(({ node }, i) => {
      const isDir = node.type !== 'file'
      const opacity = isDir ? DOCS_UNITS.SCENE_DIR_OPACITY : DOCS_UNITS.SCENE_FILE_OPACITY
      const mat = surface.add_material_basic(ink[0], ink[1], ink[2], opacity, SCENE3D_NONE)

      surface.set_material_flags(mat, 0, 0, true, true)

      const id = surface.add_mesh(graphRoot, isDir ? dirGeo : fileGeo, mat)
      // The synthetic portal root sits at the origin — its depth-0
      // ring position is meaningless (same override as the three arm).
      const x = i === 0 ? 0 : xyz[i * 3]
      const y = i === 0 ? 0 : xyz[i * 3 + 1]
      const z = i === 0 ? 0 : xyz[i * 3 + 2]

      surface.set_position(id, x, y, z)

      pickables.push({
        node: id,
        mat,
        x,
        y,
        z,
        radius: isDir ? DOCS_UNITS.SCENE_DIR_RADIUS : DOCS_UNITS.SCENE_FILE_RADIUS,
        path: node.path,
        baseOpacity: opacity,
        activeScale: 1,
      })

      if (isDir) {
        const cnv = makeLabelCanvas(node.name, getComputedStyle(canvas).color || '')

        if (cnv && typeof createImageBitmap === TYPE_STRINGS.FUNCTION) {
          labelJobs.push(
            createImageBitmap(cnv).then((bmp) => {
              if (disposed) {
                bmp.close()
                return
              }

              const tex = surface.upload_texture(bmp, bmp.width, bmp.height)
              const lmat = surface.add_material_sprite(ink[0], ink[1], ink[2], 0, tex)

              surface.set_material_flags(lmat, 0, 0, true, false)

              const lid = surface.add_sprite(graphRoot, lmat)

              surface.set_position(lid, x, y + DOCS_UNITS.LABEL_LIFT_Y, z)
              surface.set_scale(lid, DOCS_UNITS.LABEL_SCALE_X, DOCS_UNITS.LABEL_SCALE_Y, 1)

              labels.push({ node: lid, mat: lmat, depth: placed[i].depth, a: 0 })
            })
          )
        }
      }
    })

    const edges = buildEdges(placed, xyz)

    if (edges.idx.length > 0) {
      const geo = surface.upload_geometry(edges.pos, edges.nrm, edges.uv, edges.idx, false)
      const emat = surface.add_material_basic(
        ink[0],
        ink[1],
        ink[2],
        DOCS_UNITS.SCENE_LINE_OPACITY,
        SCENE3D_NONE
      )

      surface.set_material_flags(emat, 0, 0, true, true)
      surface.add_mesh(graphRoot, geo, emat)
    }

    await Promise.all(labelJobs)

    if (disposed) return

    applyActive()
  }

  void computePositions(placed).then(buildGraph)

  // Tap slop — identical to the three arm: drags never pick.
  let downX = 0
  let downY = 0

  const onPointerDown = (e: PointerEvent) => {
    downX = e.clientX
    downY = e.clientY
  }

  /**
   * Nearest sphere hit along the picking ray — the JS half of
   * `Raycaster.intersectObjects`: solve |o + t·d − c|² = r² per node
   * (per-pick loop over pickables, never per-frame).
   */
  const pick = (e: MouseEvent) => {
    if (
      Math.abs(e.clientX - downX) > DOCS_UNITS.TAP_SLOP_PX ||
      Math.abs(e.clientY - downY) > DOCS_UNITS.TAP_SLOP_PX
    ) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    const ray = surface.ray_at(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)

    const ox = ray[0]
    const oy = ray[1]
    const oz = ray[2]
    const dx = ray[3]
    const dy = ray[4]
    const dz = ray[5]

    let best = -1
    let bestT = Infinity

    for (let i = 0; i < pickables.length; i++) {
      const p = pickables[i]
      const cx = p.x - ox
      const cy = p.y - oy
      const cz = p.z - oz
      const tca = dx * cx + dy * cy + dz * cz

      if (tca < 0) continue

      const d2 = cx * cx + cy * cy + cz * cz - tca * tca
      const r = p.radius * (1 + DOCS_UNITS.SCENE_PULSE_AMP) * Math.max(1, p.activeScale)
      const r2 = r * r

      if (d2 > r2) continue

      const t = tca - Math.sqrt(r2 - d2)

      if (t > 0 && t < bestT) {
        bestT = t
        best = i
      }
    }

    if (best >= 0) {
      const path = pickables[best].path

      if (path) onPick(path)
    }
  }

  const onClick = (e: Event) => pick(e as MouseEvent)

  canvas.addEventListener(MOUSE_EVENTS.CLICK, onClick)
  canvas.addEventListener(POINTER_EVENTS.POINTERDOWN, onPointerDown, { passive: true })

  // Intro settle — identical easeOutCubic window to the three arm.
  const introFrom = saved ? 0 : DOCS_UNITS.SCENE_INTRO_TURN
  const t0 = performance.now()

  let raf = 0
  let last = performance.now()
  let t = 0

  const tick = (now: number) => {
    if (disposed) return

    const dt = Math.min(0.05, (now - last) / 1000 || 0.016)

    last = now
    t += dt

    try {
      if (ctl.update(dt)) {
        surface.set_orbit(ctl.tx, ctl.ty, ctl.tz, ctl.distance, ctl.yaw, ctl.pitch)
      }

      if (introFrom) {
        const k = Math.min(1, (now - t0) / DOCS_UNITS.SCENE_INTRO_MS)

        surface.set_euler(graphRoot, 0, introFrom * Math.pow(1 - k, 3), 0)
      }

      // Node pulse — the same per-node sine the three arm writes into
      // mesh.scale; every node id gets one scalar write (the engine
      // dirty-marks its own transform).
      for (let i = 0; i < pickables.length; i++) {
        const p = pickables[i]
        const s =
          (1 + Math.sin(t * DOCS_UNITS.SCENE_PULSE_SPEED + i * 0.7) * DOCS_UNITS.SCENE_PULSE_AMP) *
          p.activeScale

        surface.set_scale(p.node, s, s, s)
      }

      // Zoom-reveal labels — dirty-gated: alpha only writes when the
      // bucket fade actually moved (hidden labels write once, ever).
      const d = ctl.getDistance()

      for (let i = 0; i < labels.length; i++) {
        const l = labels[i]
        const reveal = Math.max(
          DOCS_UNITS.LABEL_REVEAL_MIN,
          DOCS_UNITS.LABEL_REVEAL_BASE - l.depth * DOCS_UNITS.LABEL_DEPTH_STEP
        )
        const a = Math.max(0, Math.min(1, (reveal - d) / DOCS_UNITS.LABEL_FADE))

        if (a !== l.a) {
          surface.set_color(l.mat, ink[0], ink[1], ink[2], a)
          l.a = a
        }
      }

      surface.frame(t, typeof window === TYPE_STRINGS.UNDEFINED ? 1 : window.devicePixelRatio || 1)
    } catch (err) {
      devWarn('docs arch-scene-3d tick failed', err)

      return
    }

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
      ctl.removeEventListener(ORBIT_EVENTS.START, onControlStart)
      ctl.removeEventListener(ORBIT_EVENTS.END, onControlEnd)
      ctl.dispose()
      handle.destroy()
    },
  }
}
