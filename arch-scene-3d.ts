/**
 * @file docs/arch-scene-3d.ts — the rust/scene3d arm of the docs
 * architecture scene. Mounts the `Surface3d` engine on the same canvas
 * the three.js path renders to, rebuilds the radial tree through the
 * engine's flat u32-id API, and drives the frame loop through a
 * `bindOrbit` rig — the same contract as the three arm (saved camera
 * pose, camera-facing billboard glyphs, node pulse/bob, distance-scaled
 * label reveal, tap-slop picking, setActive highlight, destroy
 * teardown). The map never self-rotates: no autorotate, no intro turn.
 *
 * Mapping from the three path: shared filled glyph triangle soups →
 * two `upload_geometry` meshes; per-node MeshBasicMaterial →
 * `add_material_basic`
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
import { THEME_CSS_PROPS } from '@core/tokens/css/theme.js'
import { devWarn } from '@core/devlog.js'
import { mountScene3d, resizeScene3d, SCENE3D_NONE } from '@core/utils/gpu/scene3d.js'
import type { Scene3dSurface } from '@core/utils/gpu/scene3d.js'
import { bindOrbit } from '@core/utils/gpu/orbit-controller.js'
import type { OrbitController } from '@core/utils/gpu/orbit-controller.js'
import {
  clipEdge,
  computePositions,
  dirFillVerts,
  dirSeamVerts,
  fileFillVerts,
  fileSeamVerts,
  graphFit,
  glyphBound,
  makeLabelCanvas,
  placeRoots,
  probeFolderInk,
  probeIconInks,
  resolveScenePath,
  readCamState,
} from './arch-scene.js'
import { kindFor } from './tree-icon.js'
import type { ArchSceneHandle, PlacedNode } from './arch-scene.js'
import type { DocsNode } from './manifest.js'

/** A pickable node: engine ids + the JS-side state the arms animate. */
interface ArmNode {
  /** Engine node id (set_position/set_scale/set_euler target). */
  node: number
  /** Fill material id — `set_color` writes the live opacity. */
  mat: number
  /** Seam material id — the knockout strokes' material; the highlight
   *  pass writes the same alpha to it so fills and seams fade together. */
  seamMat: number
  /** World position — picking ray sphere-test center. */
  x: number
  y: number
  z: number
  /** Sphere radius for hit tests (pulse widened). */
  radius: number
  /** Ring depth — the focus-glide dolly distance input. */
  depth: number
  /** Manifest path — onPick payload + highlight key. */
  path: string
  /** placed[] index — the parent chain walk for ancestor highlights. */
  pi: number
  /** Resting opacity (dir/file token). */
  baseOpacity: number
  /** Active-highlight scale multiplier applied in the pulse write. */
  activeScale: number
  /** Per-kind ink rgb — restored by the highlight pass; the glyph
   *  palette is per-node now, not one global ink. */
  rgb: [number, number, number]
  /** Bob phase — decorrelated per node (golden-angle hash). */
  phase: number
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
 * Expands a raw segment list into cross-quad ribbon geometry — two
 * perpendicular quads per segment (the engine draws triangles only;
 * a crossed pair reads as a 1px line strip from every angle). SoA
 * upload: positions + zero normals (basic material is unlit) + zero
 * uvs + triangle indices. Used by the edge fan; the filled glyphs
 * upload through `trisToGeometry` instead.
 * @param segs Flat xyz pairs — every six floats are one segment.
 * @param half Ribbon half-width in chart units.
 * @returns The four attribute arrays for `upload_geometry`.
 */
export const segmentsToRibbons = (
  segs: ArrayLike<number>,
  half: number
): { pos: Float32Array; nrm: Float32Array; uv: Float32Array; idx: Uint32Array } => {
  const pos: number[] = []
  const idx: number[] = []

  for (let s = 0; s + 5 < segs.length; s += 6) {
    const ax = segs[s]
    const ay = segs[s + 1]
    const az = segs[s + 2]
    const bx = segs[s + 3]
    const by = segs[s + 4]
    const bz = segs[s + 5]
    const dx = bx - ax
    const dy = by - ay
    const dz = bz - az
    const len = Math.hypot(dx, dy, dz)

    if (len < 1e-6) continue

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
  }

  const nv = pos.length / 3

  return {
    pos: new Float32Array(pos),
    nrm: new Float32Array(nv * 3),
    uv: new Float32Array(nv * 2),
    idx: new Uint32Array(idx),
  }
}

/**
 * Packages a glyph triangle soup into the engine's SoA geometry
 * payload — sequential indices over the unindexed soup, zero normals
 * (the basic material is unlit) and zero uvs. Mirrors
 * `segmentsToRibbons`'s return shape so both upload identically.
 * @param tris Flat xyz triplets — every 9 floats one triangle.
 * @returns The four attribute arrays for `upload_geometry`.
 */
export const trisToGeometry = (
  tris: Float32Array
): { pos: Float32Array; nrm: Float32Array; uv: Float32Array; idx: Uint32Array } => {
  const n = tris.length / 3
  const idx = new Uint32Array(n)

  for (let i = 0; i < n; i++) idx[i] = i

  return {
    pos: tris,
    nrm: new Float32Array(tris.length),
    uv: new Float32Array(n * 2),
    idx,
  }
}

/**
 * Expands the parent→child edge list into cross-quad ribbon geometry
 * via `segmentsToRibbons` at the edge half-width.
 * @param placed Flattened tree.
 * @param positions xyz triplets per node.
 * @returns The four attribute arrays for `upload_geometry`.
 */
export const buildEdges = (
  placed: readonly PlacedNode[],
  positions: Float32Array,
  scale: Float32Array
): {
  dir: { pos: Float32Array; nrm: Float32Array; uv: Float32Array; idx: Uint32Array }
  leaf: { pos: Float32Array; nrm: Float32Array; uv: Float32Array; idx: Uint32Array }
} => {
  const dirSegs: number[] = []
  const leafSegs: number[] = []

  // Links trim at glyph radius + SCENE_EDGE_GAP on both ends so lines
  // never pierce an icon's filled faces (same contract as the three arm).
  const dirBound = glyphBound(dirSeamVerts())
  const fileBound = glyphBound(fileSeamVerts())

  placed.forEach(({ node, parent }, i) => {
    if (parent < 0) return

    const isDir = node.type !== 'file'

    const seg = clipEdge(
      [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]],
      [positions[parent * 3], positions[parent * 3 + 1], positions[parent * 3 + 2]],
      (isDir ? dirBound : fileBound) * (scale[i] as number),
      // Parents are never files — leaves have no children — so the
      // parent's trim radius is always the dir bound.
      dirBound * (scale[parent] as number)
    )

    if (!seg) return

    // File-leaf links are the bulk of the web — they ride their own
    // geometry so the mount dims them to SCENE_EDGE_LEAF of the dir
    // skeleton's ink (same split as the three arm's two LineSegments).
    ;(isDir ? dirSegs : leafSegs).push(seg[0], seg[1], seg[2], seg[3], seg[4], seg[5])
  })

  return {
    dir: segmentsToRibbons(dirSegs, DOCS_UNITS.SCENE_EDGE_HALF),
    leaf: segmentsToRibbons(leafSegs, DOCS_UNITS.SCENE_EDGE_HALF),
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
 * @param onReady  Called once the async graph build lands — the host
 *                 drops the stage's loading veil on this signal.
 * @returns The scene handle, or null when the engine can't mount.
 */
export const mountArchScene3d = async (
  canvas: HTMLCanvasElement,
  roots: Array<{ root: string; label: string; children: DocsNode[] }>,
  onPick: (_path: string) => void,
  onReady?: () => void
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
    damping: 0.08,
  })

  const saved = readCamState()

  if (saved) {
    const [d, yaw, pitch] = poseFromPos(saved.p, saved.t)

    ctl.setTarget(saved.t[0], saved.t[1], saved.t[2])
    ctl.setPose(d, yaw, pitch)
  }

  /** Serializes camera pose into sessionStorage. */
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
      }

      sessionStorage.setItem(CACHE_STORAGE_KEYS.DOCS_SCENE_STATE, JSON.stringify(state))
    } catch {
      /* quota/security errors — persistence is best-effort */
    }
  }

  const onControlStart = () => {
    focus.on = false

    saveCamState()
  }

  const onControlEnd = () => saveCamState()

  ctl.addEventListener(ORBIT_EVENTS.START, onControlStart)
  ctl.addEventListener(ORBIT_EVENTS.END, onControlEnd)

  // Theme ink — same computed-style read as the three arm, parsed to
  // f32 channels (no THREE.Color in this path).
  const ink = parseInk(getComputedStyle(canvas).color || '')

  // Card-body ink — the page's own bg color so glyph faces read as the
  // icon pack's dark paper and occlude the link web behind them on
  // either theme; falls back to dimmed ink when --bg-primary can't be
  // parsed (same contract as the three arm).
  const faceCss = getComputedStyle(canvas).getPropertyValue(THEME_CSS_PROPS.BG_PRIMARY)

  const faceRgb: [number, number, number] = faceCss
    ? parseInk(faceCss)
    : [
        ink[0] * DOCS_UNITS.SCENE_SEAM_SHADE,
        ink[1] * DOCS_UNITS.SCENE_SEAM_SHADE,
        ink[2] * DOCS_UNITS.SCENE_SEAM_SHADE,
      ]

  const pickables: ArmNode[] = []
  const labels: ArmLabel[] = []

  /** Root group — every node/edge/label parents under it. */
  const graphRoot = surface.add_group(SCENE3D_NONE)

  /** Docs path currently highlighted — '' matches the portal-root node. */
  let activePath: string = CHAR_STRINGS.EMPTY

  let disposed = false

  /**
   * Location-focus glide — setActive retargets; the tick eases the orbit
   * rig's target + distance toward the goal (the rig's setTarget/setPose
   * snap, so per-frame lerped writes ARE the animation). '' or an
   * unknown path falls back to the origin at the full-graph distance.
   */
  const focus: { x: number; y: number; z: number; dist: number; on: boolean } = {
    x: 0,
    y: DOCS_UNITS.SCENE_FOCUS_Y_BIAS,
    z: 0,
    dist: dist0,
    on: false,
  }

  /**
   * Arms the focus glide for a docs location — placed nodes aim at their
   * world position with a depth-scaled dolly; the portal root keeps the
   * full-graph distance. Re-armed at the end of buildGraph so a location
   * set before positions landed still centers once they arrive.
   */
  const startFocus = (path: string) => {
    // Aggregated-away paths focus their nearest scene ancestor — the
    // same resolution the highlight pass runs.
    const idx = path === CHAR_STRINGS.EMPTY ? -1 : resolveScenePath(placed, path)
    const hit = idx >= 0 ? pickables.find((p) => p.pi === idx) : undefined

    focus.x = hit?.x ?? 0

    focus.y = (hit?.y ?? 0) + DOCS_UNITS.SCENE_FOCUS_Y_BIAS

    focus.z = hit?.z ?? 0

    focus.dist =
      !hit || hit.depth === 0
        ? dist0
        : Math.min(dist0, DOCS_UNITS.SCENE_FOCUS_MIN + hit.depth * DOCS_UNITS.SCENE_FOCUS_STEP)

    focus.on = true
  }

  /**
   * Paints the active-location highlight onto live nodes — same rules
   * as the three arm: exact match pops to SCENE_ACTIVE_OPACITY with a
   * larger pulse scale, ancestors lift to SCENE_ANCESTOR_OPACITY.
   */
  const applyActive = () => {
    // Ancestry walks the placed parent chain — section-group paths
    // ('group/…') aren't string prefixes of their members' manifest
    // paths, so path-prefix matching can't see them.
    const activeIdx = resolveScenePath(placed, activePath)
    const ancestors = new Set<string>()

    for (
      let i = activeIdx >= 0 ? (placed[activeIdx].parent as number) : -1;
      i >= 0;
      i = placed[i].parent as number
    ) {
      ancestors.add(placed[i].node.path)
    }

    pickables.forEach((p) => {
      const isActive = p.pi === activeIdx
      const isAncestor = !isActive && p.path !== CHAR_STRINGS.EMPTY && ancestors.has(p.path)

      const alpha = isActive
        ? DOCS_UNITS.SCENE_ACTIVE_OPACITY
        : isAncestor
          ? DOCS_UNITS.SCENE_ANCESTOR_OPACITY
          : p.baseOpacity

      // Face = page-body ink (bg), seam strokes = the node's kind ink —
      // the icon pack's dark-card + colored-outline read in 3D.
      surface.set_color(p.mat, faceRgb[0], faceRgb[1], faceRgb[2], alpha)
      surface.set_color(p.seamMat, p.rgb[0], p.rgb[1], p.rgb[2], alpha)

      p.activeScale = isActive ? DOCS_UNITS.SCENE_ACTIVE_SCALE : 1
    })
  }

  /**
   * Populates the scene once positions land — shared dir/file sphere
   * geometries, per-node materials (opacity arms), cross-quad edges,
   * then dir-name labels on top.
   * @param positions Worker/local result — `xyz` position triplets plus
   *                  the orbit-proportional glyph `scale` per node.
   */
  const buildGraph = async ({ xyz, scale }: { xyz: Float32Array; scale: Float32Array }) => {
    if (disposed) return

    // Shared filled glyph geometries — the same folder/document
    // triangle soups the three arm instances. One upload per glyph,
    // shared by every node in the tier.
    const dirFill = dirFillVerts()
    const fileFill = fileFillVerts()
    const dirTri = trisToGeometry(dirFill)
    const fileTri = trisToGeometry(fileFill)

    const dirGeo = surface.upload_geometry(dirTri.pos, dirTri.nrm, dirTri.uv, dirTri.idx, false)
    const fileGeo = surface.upload_geometry(
      fileTri.pos,
      fileTri.nrm,
      fileTri.uv,
      fileTri.idx,
      false
    )

    // Seam geometries — the detail strokes (outline, crease, rules,
    // shelf) ribboned into cross-quads at the edge half-width, one
    // upload per glyph shared by every node in the tier.
    const dirSeam = segmentsToRibbons(dirSeamVerts(), DOCS_UNITS.SCENE_EDGE_HALF)
    const fileSeam = segmentsToRibbons(fileSeamVerts(), DOCS_UNITS.SCENE_EDGE_HALF)

    const dirSeamGeo = surface.upload_geometry(
      dirSeam.pos,
      dirSeam.nrm,
      dirSeam.uv,
      dirSeam.idx,
      false
    )
    const fileSeamGeo = surface.upload_geometry(
      fileSeam.pos,
      fileSeam.nrm,
      fileSeam.uv,
      fileSeam.idx,
      false
    )

    // Per-kind palette — same probe the three arm runs: file nodes wear
    // their treeview icon ink, dirs + +N aggregates the accent.
    const kinds = new Set<string>()

    placed.forEach(({ node }) => {
      if (node.type === 'file' && !node.aggregate) kinds.add(kindFor(node.name))
    })

    const kindInks = probeIconInks(canvas.parentElement ?? canvas, [...kinds])

    // Directory outlines wear the treeview folder's gold currentColor —
    // probed like the kind inks so the map keeps the DOM pack's code.
    const dirRgb = (probeFolderInk(canvas.parentElement ?? canvas) ?? ink) as [
      number,
      number,
      number,
    ]

    const labelJobs: Array<Promise<void>> = []

    placed.forEach(({ node }, i) => {
      const isDir = node.type !== 'file'
      const opacity = isDir ? DOCS_UNITS.SCENE_DIR_OPACITY : DOCS_UNITS.SCENE_FILE_OPACITY
      const rgb: [number, number, number] =
        isDir || node.aggregate
          ? dirRgb
          : ((kindInks.get(kindFor(node.name)) ?? ink) as [number, number, number])

      const mat = surface.add_material_basic(
        faceRgb[0],
        faceRgb[1],
        faceRgb[2],
        opacity,
        SCENE3D_NONE
      )

      // Side 2 = double — the billboarding cards must never backface-
      // cull into a flicker silhouette at glancing orbit angles.
      surface.set_material_flags(mat, 2, 0, true, true)

      const id = surface.add_mesh(graphRoot, isDir ? dirGeo : fileGeo, mat)

      // Seam strokes ride the node as a child mesh — they inherit
      // position/scale/euler/pulse with zero extra per-frame writes.
      const seamMat = surface.add_material_basic(rgb[0], rgb[1], rgb[2], opacity, SCENE3D_NONE)

      surface.set_material_flags(seamMat, 2, 0, true, true)
      surface.add_mesh(id, isDir ? dirSeamGeo : fileSeamGeo, seamMat)
      // The synthetic portal root sits at the origin — its depth-0
      // ring position is meaningless (same override as the three arm).
      const x = i === 0 ? 0 : xyz[i * 3]
      const y = i === 0 ? 0 : xyz[i * 3 + 1]
      const z = i === 0 ? 0 : xyz[i * 3 + 2]

      surface.set_position(id, x, y, z)

      // The reference's icon-to-orbit proportion — the same aScale the
      // three arm feeds its instanced glyphs, applied per-mesh here.
      const gs = scale[i] as number

      surface.set_scale(id, gs, gs, gs)

      pickables.push({
        node: id,
        mat,
        seamMat,
        x,
        y,
        z,
        radius: glyphBound(isDir ? dirFill : fileFill) * gs,
        depth: placed[i].depth,
        path: node.path,
        pi: i,
        baseOpacity: opacity,
        activeScale: 1,
        rgb: [rgb[0], rgb[1], rgb[2]],
        phase: i * DOCS_UNITS.SCENE_Y_HASH,
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

              surface.set_position(lid, x, y + DOCS_UNITS.LABEL_LIFT_Y * gs, z)
              surface.set_scale(
                lid,
                DOCS_UNITS.LABEL_SCALE_X * gs,
                DOCS_UNITS.LABEL_SCALE_Y * gs,
                1
              )

              labels.push({ node: lid, mat: lmat, depth: placed[i].depth, a: 0 })
            })
          )
        }
      }
    })

    const edges = buildEdges(placed, xyz, scale)

    // Two link tiers: the dir skeleton draws at full line ink, leaf
    // links at SCENE_EDGE_LEAF of it — the leaf web is the clutter bulk.
    const mountEdges = (
      geo: { pos: Float32Array; nrm: Float32Array; uv: Float32Array; idx: Uint32Array },
      opacity: number
    ): void => {
      if (!geo.idx.length) return

      const id = surface.upload_geometry(geo.pos, geo.nrm, geo.uv, geo.idx, false)
      const emat = surface.add_material_basic(ink[0], ink[1], ink[2], opacity, SCENE3D_NONE)

      surface.set_material_flags(emat, 0, 0, true, true)
      surface.add_mesh(graphRoot, id, emat)
    }

    mountEdges(edges.dir, DOCS_UNITS.SCENE_LINE_OPACITY)
    mountEdges(edges.leaf, DOCS_UNITS.SCENE_LINE_OPACITY * DOCS_UNITS.SCENE_EDGE_LEAF)

    await Promise.all(labelJobs)

    if (disposed) return

    applyActive()

    startFocus(activePath)

    // Graph populated — the host's stage veil drops on this signal.
    onReady?.()
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

      const root = Math.sqrt(r2 - d2)
      // Origin inside the sphere → the near root is negative and the
      // hit lands on the exit surface; orbit-proportioned glyphs are
      // big enough to contain the camera inside their own cluster.
      const t = tca - root > 0 ? tca - root : tca + root

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

  let raf = 0

  /**
   * Host-driven pause — true while the map column is display:none. The
   * loop stops scheduling entirely (no rAF wakeup, no GPU frame); the
   * flag is also re-checked at tick entry so a pause that lands between
   * schedule and fire still dead-ends the frame.
   */
  let paused = false

  let last = performance.now()
  let t = 0

  const tick = (now: number) => {
    if (disposed || paused) return

    const dt = Math.min(0.05, (now - last) / 1000 || 0.016)

    last = now
    t += dt

    try {
      // Location focus — retarget the rig toward the active node and
      // dolly to the framing distance. The graph itself never rotates,
      // so the goal is the node's raw world position. setTarget/setPose
      // snap, so lerped per-frame writes are the glide itself.
      if (focus.on) {
        const k = DOCS_UNITS.SCENE_FOCUS_DAMP

        const ntx = ctl.tx + (focus.x - ctl.tx) * k

        const nty = ctl.ty + (focus.y - ctl.ty) * k

        const ntz = ctl.tz + (focus.z - ctl.tz) * k

        ctl.setTarget(ntx, nty, ntz)

        const nd = ctl.distance + (focus.dist - ctl.distance) * k

        ctl.setPose(nd, ctl.yaw, ctl.pitch)

        if (
          Math.abs(focus.x - ntx) + Math.abs(focus.y - nty) + Math.abs(focus.z - ntz) <
            DOCS_UNITS.SCENE_FOCUS_EPS &&
          Math.abs(focus.dist - nd) < DOCS_UNITS.SCENE_FOCUS_EPS
        ) {
          focus.on = false
        }
      }

      if (ctl.update(dt)) {
        surface.set_orbit(ctl.tx, ctl.ty, ctl.tz, ctl.distance, ctl.yaw, ctl.pitch)
      }

      // Node pulse + float + camera-facing yaw — the three arm runs the
      // same motion in-shader as a full billboard; the engine has no
      // instanced attribute path, so each pickable gets scale/position/
      // yaw writes in the same loop. The yaw is the rig's camera
      // azimuth — cards stand upright facing the viewer, never
      // spinning (edge ribbons stay anchored — the bobbed endpoints
      // drift ±BOB_AMP off the wire ends, an accepted divergence on
      // this debug-gated arm).
      for (let i = 0; i < pickables.length; i++) {
        const p = pickables[i]
        const s =
          (1 + Math.sin(t * DOCS_UNITS.SCENE_PULSE_SPEED + i * 0.7) * DOCS_UNITS.SCENE_PULSE_AMP) *
          p.activeScale

        surface.set_scale(p.node, s, s, s)
        surface.set_position(
          p.node,
          p.x,
          p.y + Math.sin(t * DOCS_UNITS.SCENE_BOB_SPEED + p.phase) * DOCS_UNITS.SCENE_BOB_AMP,
          p.z
        )
        surface.set_euler(p.node, 0, ctl.yaw, 0)
      }

      // Zoom-reveal labels — dirty-gated: alpha only writes when the
      // bucket fade actually moved (hidden labels write once, ever).
      // Thresholds are fractions of the full-graph camera distance so
      // names stay legible from the overview inward (same contract as
      // the three arm).
      const d = ctl.getDistance()

      for (let i = 0; i < labels.length; i++) {
        const l = labels[i]
        const reveal =
          Math.max(
            DOCS_UNITS.LABEL_REVEAL_MIN,
            DOCS_UNITS.LABEL_REVEAL_BASE - l.depth * DOCS_UNITS.LABEL_DEPTH_STEP
          ) * camDist
        const a = Math.max(0, Math.min(1, (reveal - d) / (DOCS_UNITS.LABEL_FADE * camDist)))

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

      startFocus(path)
    },

    // The mount facade already owns a ResizeObserver feeding device-px
    // resize — this entry-point re-asserts the fit for host-driven moves
    // (map column ↔ zoom dialog) between observer deliveries.
    resize() {
      resizeScene3d(surface, canvas)
    },

    setPaused(next: boolean) {
      if (next === paused) return

      paused = next

      if (paused) {
        cancelAnimationFrame(raf)
      } else if (!disposed) {
        // Resume on a fresh fit — the canvas may have re-seated into a
        // different box while the loop was down.
        resizeScene3d(surface, canvas)

        last = performance.now()
        raf = requestAnimationFrame(tick)
      }
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
