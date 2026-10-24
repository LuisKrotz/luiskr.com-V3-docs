/**
 * @file arch-scene-3d-tails.test.js
 * @description Coverage tail for docs/arch-scene-3d.ts and the
 * scene3d composite arm in arch-scene.ts — the rust/WebGPU mount of
 * the architecture map. Covers the ink parser, pose conversion, edge
 * ribbon expansion (including the degenerate-perp and coincident-node
 * skips), the live-mount graph build (shared geometries, per-node
 * materials, cross-quad edges, bitmap labels), the tick loop (orbit
 * push, intro euler, node pulse, dirty-gated label fade), the
 * ray-sphere pick, setActive, destroy, and every composite arm
 * (wasm-ok, wasm-fail→three, late-handle destroy, both-fail onLost,
 * no-WebGPU → three).
 */
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { ORBIT_EVENTS } from '@core/tokens/events/dom.js'
import { CACHE_STORAGE_KEYS } from '@core/tokens/data/storage.js'
import { STATE_CLASSES } from '@core/tokens/classes/state.js'
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { DOCS_UNITS } from '@core/tokens/strings/docs.js'
import { createMockGL } from '@tests/fixtures/mock-webgl.js'

/* ── Module mocks ─────────────────────────────────────────────── */

let mockSurface = null
let mountResult = null
let mockCtl = null
let mockGpu = true
let mockGpuEnabled = true

jest.unstable_mockModule('@core/utils/gpu/scene3d.js', () => ({
  SCENE3D_NONE: 4294967295,
  mountScene3d: async () => mountResult,
  loadScene3dTexture: async () => null,
  resizeScene3d: () => undefined,
}))

jest.unstable_mockModule('@core/utils/gpu/webgpu-widget.js', () => ({
  hasWebGpu: () => mockGpu,
  webgpuWidgetsEnabled: () => mockGpuEnabled,
  mountWebGpuWidget: async () => null,
  warmWidgetArtifacts: () => undefined,
}))

jest.unstable_mockModule('@core/utils/gpu/orbit-controller.js', () => ({
  bindOrbit: () => mockCtl,
}))

const { mountArchScene3d, parseInk, poseFromPos, buildEdges } =
  await import('@docs/arch-scene-3d.js')
const { mountArchScene, placeRoots, computePositions } = await import('@docs/arch-scene.js')

/* ── Fixture tree ─────────────────────────────────────────────── */

const ROOTS = [
  {
    root: 'docs',
    label: 'Documentation',
    children: [
      {
        type: 'dir',
        name: 'architecture',
        path: 'docs/architecture',
        children: [
          {
            type: 'file',
            name: 'website.md',
            path: 'docs/architecture/website.md',
            id: 'docs:architecture/website.md',
          },
        ],
      },
      { type: 'file', name: 'README.md', path: 'docs/README.md', id: 'docs:README.md' },
    ],
  },
]

const flush = (ms = 60) => new Promise((r) => setTimeout(r, ms))

/** Fake Surface3d — records every call; ids increment per family. */
const makeSurface = () => {
  let geo = 0
  let mat = 0
  let node = 0
  let tex = 0

  return {
    calls: { positions: [], scales: [], colors: [], orbits: [], euler: [] },
    frames: [],
    destroyed: false,
    resize() {},
    set_size() {},
    set_fov() {},
    set_clip() {},
    set_clear() {},
    gen_sphere() {
      return ++geo
    },
    upload_geometry() {
      return ++geo
    },
    upload_texture() {
      return ++tex
    },
    add_material_basic() {
      return ++mat
    },
    add_material_sprite() {
      return ++mat
    },
    set_material_flags() {},
    set_color(m, r, g, b, a) {
      this.calls.colors.push([m, a])
    },
    set_emissive() {},
    add_mesh() {
      return ++node
    },
    add_group() {
      return ++node
    },
    add_sprite() {
      return ++node
    },
    add_instanced() {
      return ++node
    },
    add_points() {
      return ++node
    },
    add_lod() {
      return ++node
    },
    set_position(n, x, y, z) {
      this.calls.positions.push([n, x, y, z])
    },
    set_scale(n, x, _y, _z) {
      this.calls.scales.push([n, x])
    },
    set_euler(n, _x, y, _z) {
      this.calls.euler.push([n, y])
    },
    set_orbit(tx, ty, tz, d, y, p) {
      this.calls.orbits.push([tx, ty, tz, d, y, p])
    },
    ray_at() {
      return new Float32Array(this.ray)
    },
    ray: [0, 0, 10, 0, 0, -1],
    frame(t) {
      this.frames.push(t)
    },
    destroy() {
      this.destroyed = true
    },
  }
}

const makeCtl = () => {
  const listeners = new Map()

  return {
    autoRotate: false,
    tx: 0,
    ty: 0,
    tz: 0,
    distance: 100,
    yaw: 0,
    pitch: 0,
    moved: true,
    update() {
      return this.moved
    },
    getDistance() {
      return this.distance
    },
    setTarget(x, y, z) {
      this.tx = x
      this.ty = y
      this.tz = z
    },
    setPose(d, y, p) {
      this.distance = d
      this.yaw = y
      this.pitch = p
    },
    addEventListener(type, fn) {
      listeners.set(type, fn)
    },
    removeEventListener(type, fn) {
      if (listeners.get(type) === fn) listeners.delete(type)
    },
    fire(type) {
      listeners.get(type)?.()
    },
    dispose() {
      this.disposed = true
    },
  }
}

const fake2d = {
  font: '',
  fillStyle: '',
  textAlign: '',
  textBaseline: '',
  fillText() {},
}

describe('arch-scene-3d helpers', () => {
  test('parseInk handles rgb(), rgba(), #rgb, #rrggbb and the fallback', () => {
    expect(parseInk('rgb(255, 0, 128)')).toEqual([1, 0, 128 / 255])
    expect(parseInk('rgba(0,255,0,0.5)')).toEqual([0, 1, 0])
    expect(parseInk('#f00')).toEqual([1, 0, 0])
    expect(parseInk('#00ff80')).toEqual([0, 1, 128 / 255])
    expect(parseInk('')).toEqual([1, 1, 1])
    expect(parseInk('CanvasText')).toEqual([1, 1, 1])
  })

  test('poseFromPos inverts the orbit convention, with degenerate clamps', () => {
    // eye = target + d·(cos p·sin y, sin p, cos p·cos y)
    const [d, yaw, pitch] = poseFromPos([10, 10, 10], [0, 0, 0])
    const dd = Math.hypot(10, 10, 10)

    expect(d).toBeCloseTo(dd, 5)
    expect(Math.asin(10 / dd)).toBeCloseTo(pitch, 5)
    expect(Math.atan2(10, 10)).toBeCloseTo(yaw, 5)

    // Coincident points → distance clamps to 1e-3, dy/d clamps to ±1.
    const [d0] = poseFromPos([0, 0, 0], [0, 0, 0])

    expect(d0).toBe(1e-3)
  })

  test('buildEdges emits cross-quads and skips root/coincident/vertical cases', () => {
    const placed = [
      { node: { type: 'dir', name: 'a', path: 'a' }, depth: 0, angle: 0, parent: -1 },
      { node: { type: 'dir', name: 'b', path: 'b' }, depth: 1, angle: 0, parent: 0 },
      { node: { type: 'dir', name: 'c', path: 'c' }, depth: 1, angle: 0, parent: 0 },
      { node: { type: 'dir', name: 'd', path: 'd' }, depth: 1, angle: 0, parent: 0 },
    ]
    // Edge a→b horizontal, a→c coincident (skipped), a→d vertical (the
    // degenerate cross(dir,+Y) arm).
    const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 5, 0])

    const e = buildEdges(placed, positions)

    // b + d edges only: 8 verts, 12 indices each → 16 verts, 24 idx.
    expect(e.pos.length).toBe(16 * 3)
    expect(e.idx.length).toBe(24)
    expect(e.nrm.length).toBe(16 * 3)
    expect(e.uv.length).toBe(16 * 2)

    // NaN positions survive the len guard (NaN < 1e-6 is false) and
    // propagate into the cross products — `ql || 1` keeps the second
    // perpendicular finite instead of producing NaN geometry.
    const nan = buildEdges(placed.slice(0, 2), new Float32Array([0, 0, 0, NaN, NaN, NaN]))

    expect(nan.idx.length).toBe(12)
  })
})

describe('arch-scene-3d mount', () => {
  let canvas
  let proto
  let origGetContext
  let origBitmap

  beforeEach(() => {
    canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype
    origGetContext = proto.getContext

    proto.getContext = function patched(type) {
      if (String(type) === '2d') return fake2d

      return null
    }

    origBitmap = globalThis.createImageBitmap
    globalThis.createImageBitmap = async () => ({
      width: 64,
      height: 16,
      close() {
        this.closed = true
      },
    })

    mockSurface = makeSurface()
    mockCtl = makeCtl()
    mountResult = { canvas, surface: mockSurface, destroy: jest.fn(() => mockSurface.destroy()) }
    sessionStorage.clear()
  })

  afterEach(() => {
    proto.getContext = origGetContext
    globalThis.createImageBitmap = origBitmap
    canvas.remove()
  })

  test('mount failure resolves null', async () => {
    mountResult = null

    expect(await mountArchScene3d(canvas, ROOTS, jest.fn())).toBeNull()
  })

  test('live mount builds the graph, ticks frames, picks, destroys', async () => {
    const onPick = jest.fn()

    const handle = await mountArchScene3d(canvas, ROOTS, onPick)

    expect(handle).not.toBeNull()

    await flush()

    // Graph built: group + 4 pickable meshes + dir label sprites.
    expect(mockSurface.calls.positions.length).toBeGreaterThanOrEqual(4)

    await flush(40)

    expect(mockSurface.frames.length).toBeGreaterThan(0)
    expect(mockSurface.calls.orbits.length).toBeGreaterThan(0)
    expect(mockSurface.calls.scales.length).toBeGreaterThan(0)

    // Pick — aim the fake ray at the first non-root node.
    const [, x, y, z] = mockSurface.calls.positions[1]

    mockSurface.ray = [x, y, z - 4, 0, 0, 1]

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 5, clientY: 5, bubbles: true }))

    expect(onPick).toHaveBeenCalled()

    // Slop — a far pointerdown makes the click a drag.
    onPick.mockClear()
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 5, bubbles: true }))
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 500, clientY: 5, bubbles: true }))

    expect(onPick).not.toHaveBeenCalled()

    handle.setActive('docs/architecture')

    expect(mockSurface.calls.colors.length).toBeGreaterThan(0)

    handle.destroy()

    expect(mockSurface.destroyed).toBe(true)
    expect(mockCtl.disposed).toBe(true)
  })

  test('restores the saved camera pose and skips the intro', async () => {
    sessionStorage.setItem(
      CACHE_STORAGE_KEYS.DOCS_SCENE_STATE,
      JSON.stringify({ p: [0, 40, 50], t: [0, 0, 0], off: true })
    )

    const handle = await mountArchScene3d(canvas, ROOTS, jest.fn())

    expect(handle).not.toBeNull()
    expect(mockCtl.autoRotate).toBe(false)

    handle.destroy()
  })

  test('control start stops autorotate and persists the pose', async () => {
    const handle = await mountArchScene3d(canvas, ROOTS, jest.fn())

    mockCtl.fire(ORBIT_EVENTS.START)

    expect(mockCtl.autoRotate).toBe(false)
    expect(sessionStorage.getItem(CACHE_STORAGE_KEYS.DOCS_SCENE_STATE)).not.toBeNull()

    mockCtl.fire(ORBIT_EVENTS.END)

    handle.destroy()
  })

  test('setActive glides the rig target onto the active node and disengages', async () => {
    const origRaf = globalThis.requestAnimationFrame
    let tickFn = null

    globalThis.requestAnimationFrame = (fn) => {
      tickFn = fn

      return 1
    }

    // Saved pose → introFrom stays 0 → rootYaw is fixed at 0, so the
    // focus goal equals the node's raw world position.
    sessionStorage.setItem(
      CACHE_STORAGE_KEYS.DOCS_SCENE_STATE,
      JSON.stringify({ p: [0, 40, 50], t: [0, 0, 0], off: true })
    )

    const handle = await mountArchScene3d(canvas, ROOTS, jest.fn())

    await flush()
    await flush()

    try {
      handle.setActive('docs/architecture')

      // ~7% damp per tick — a few hundred same-stamp steps converge the
      // rig inside SCENE_FOCUS_EPS and flip the glide off.
      const now = performance.now()

      for (let i = 0; i < 500; i++) tickFn(now)

      const placed = placeRoots(ROOTS)
      const idx = placed.findIndex((p) => p.node.path === 'docs/architecture')
      const xyz = await computePositions(placed)

      expect(Math.abs(mockCtl.tx - xyz[idx * 3])).toBeLessThan(0.5)
      expect(
        Math.abs(mockCtl.ty - (xyz[idx * 3 + 1] + DOCS_UNITS.SCENE_FOCUS_Y_BIAS))
      ).toBeLessThan(0.5)
      expect(Math.abs(mockCtl.tz - xyz[idx * 3 + 2])).toBeLessThan(0.5)
      expect(
        Math.abs(
          mockCtl.distance -
            (DOCS_UNITS.SCENE_FOCUS_MIN + placed[idx].depth * DOCS_UNITS.SCENE_FOCUS_STEP)
        )
      ).toBeLessThan(0.5)

      // Disengaged — a later tick takes the focus.on-false arm and
      // leaves every rig field untouched.
      const [tx, ty, tz, d] = [mockCtl.tx, mockCtl.ty, mockCtl.tz, mockCtl.distance]

      tickFn(now)

      expect(mockCtl.tx).toBe(tx)
      expect(mockCtl.ty).toBe(ty)
      expect(mockCtl.tz).toBe(tz)
      expect(mockCtl.distance).toBe(d)

      // Portal root — '' re-arms the glide toward the origin at the
      // full-graph distance.
      handle.setActive('')

      for (let i = 0; i < 500; i++) tickFn(now)

      expect(Math.abs(mockCtl.tx)).toBeLessThan(0.5)
      expect(Math.abs(mockCtl.ty - DOCS_UNITS.SCENE_FOCUS_Y_BIAS)).toBeLessThan(0.5)
      expect(Math.abs(mockCtl.tz)).toBeLessThan(0.5)
    } finally {
      globalThis.requestAnimationFrame = origRaf
    }

    handle.destroy()
  })

  test('saveCamState no-ops when sessionStorage is unavailable', async () => {
    const handle = await mountArchScene3d(canvas, ROOTS, jest.fn())

    expect(handle).not.toBeNull()

    const desc = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')

    try {
      // SSR-ish arm — `typeof sessionStorage === 'undefined'` guards the
      // persistence write inside saveCamState (orbit start/end).
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      })

      mockCtl.fire(ORBIT_EVENTS.START)
      mockCtl.fire(ORBIT_EVENTS.END)
    } finally {
      if (desc) Object.defineProperty(globalThis, 'sessionStorage', desc)
      else delete globalThis.sessionStorage
    }

    handle.destroy()
  })

  test('dispose while label bitmaps are pending closes the late bitmaps', async () => {
    // Every dir node enqueues its own createImageBitmap — collect ALL
    // resolvers so Promise.all(labelJobs) actually settles.
    const pending = []

    const bmp = {
      width: 64,
      height: 16,
      closed: false,
      close() {
        this.closed = true
      },
    }

    globalThis.createImageBitmap = () =>
      new Promise((r) => {
        pending.push(r)
      })

    const handle = await mountArchScene3d(canvas, ROOTS, jest.fn())

    await flush()

    expect(pending.length).toBeGreaterThan(0)

    // buildGraph parked inside Promise.all(labelJobs) — destroy lands
    // `disposed` before any bitmap resolves.
    handle.destroy()
    pending.forEach((r) => r(bmp))
    await flush()

    expect(bmp.closed).toBe(true)
  })

  test('empty roots produce a graph with no edge geometry', async () => {
    const handle = await mountArchScene3d(canvas, [], jest.fn())

    expect(handle).not.toBeNull()

    await flush()

    // One synthetic root node → no parents → edges.idx empty → the
    // `edges.idx.length > 0` else arm. (Node mesh + its dir label sprite
    // each record a set_position write.)
    expect(mockSurface.calls.positions.length).toBeGreaterThanOrEqual(1)

    handle.destroy()
  })

  test('pick misses all spheres, inside-origin candidates drop, and the portal root never navigates', async () => {
    const onPick = jest.fn()

    const handle = await mountArchScene3d(canvas, ROOTS, onPick)

    await flush()

    // best < 0 — ray into empty space → `if (best >= 0)` else arm.
    mockSurface.ray = [9999, 9999, 9999, 0, 0, -1]

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 5, clientY: 5, bubbles: true }))

    expect(onPick).not.toHaveBeenCalled()

    // Origin inside a sphere → t < 0 → `t > 0 && t < bestT` false arm.
    const [, x, y, z] = mockSurface.calls.positions[1]

    mockSurface.ray = [x, y, z, 0, 0, 1]

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 5, clientY: 5, bubbles: true }))

    expect(onPick).not.toHaveBeenCalled()

    // The synthetic portal root carries path '' — a hit resolves but
    // `if (path)` keeps onPick quiet.
    mockSurface.ray = [0, 0, -10, 0, 0, 1]

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 5, clientY: 5, bubbles: true }))

    expect(onPick).not.toHaveBeenCalled()

    handle.destroy()
  })

  test('tick covers the intro-skip, update-false, label-fade, env-fallback, catch and disposed arms', async () => {
    // Saved pose → introFrom = 0 → `if (introFrom)` else arm once ticked.
    sessionStorage.setItem(
      CACHE_STORAGE_KEYS.DOCS_SCENE_STATE,
      JSON.stringify({ p: [0, 40, 50], t: [0, 0, 0], off: false })
    )

    const origRaf = globalThis.requestAnimationFrame
    const origCancel = globalThis.cancelAnimationFrame
    const wDesc = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const dprDesc = Object.getOwnPropertyDescriptor(globalThis.window, 'devicePixelRatio')
    let tickFn = null

    globalThis.requestAnimationFrame = (fn) => {
      tickFn = fn

      return 1
    }
    globalThis.cancelAnimationFrame = () => {}

    const handle = await mountArchScene3d(canvas, ROOTS, jest.fn())

    try {
      // Two flushes — computePositions → buildGraph → bitmap .then all
      // have to settle before labels[] is populated for the fade arm.
      await flush()
      await flush()

      expect(tickFn).not.toBeNull()

      // update-false arm: no orbit write this tick; label-fade arm:
      // distance 0 reveals every label → a=1 ≠ l.a=0 → set_color writes.
      mockCtl.moved = false
      mockCtl.distance = 0

      const colors = mockSurface.calls.colors.length
      const orbits = mockSurface.calls.orbits.length

      tickFn(performance.now())

      expect(mockSurface.calls.orbits.length).toBe(orbits)
      expect(mockSurface.calls.colors.length).toBeGreaterThan(colors)

      // `typeof window === 'undefined'` SSR arm of the dpr probe.
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        configurable: true,
        writable: true,
      })
      tickFn(performance.now())
      Object.defineProperty(globalThis, 'window', wDesc)

      // `window.devicePixelRatio || 1` falsy arm.
      const w = globalThis.window

      Object.defineProperty(w, 'devicePixelRatio', { value: 0, configurable: true })
      tickFn(performance.now())

      if (dprDesc) Object.defineProperty(w, 'devicePixelRatio', dprDesc)

      // `(now - last) / 1e3 || .016` — a repeated timestamp feeds the fallback dt.
      const same = performance.now()

      tickFn(same)
      tickFn(same)

      // catch arm — a throwing frame devWarns and returns without rearming.
      mockSurface.frame = () => {
        throw new Error('gpu crash')
      }
      tickFn(performance.now())

      // disposed arm — a queued tick after destroy returns immediately.
      handle.destroy()
      tickFn(performance.now())
    } finally {
      globalThis.requestAnimationFrame = origRaf
      globalThis.cancelAnimationFrame = origCancel

      if (Object.getOwnPropertyDescriptor(globalThis, 'window').value === undefined) {
        Object.defineProperty(globalThis, 'window', wDesc)
      }

      handle.destroy()
    }
  })
})

describe('arch-scene composite', () => {
  let canvas
  let proto
  let origGetContext

  beforeEach(() => {
    canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype
    origGetContext = proto.getContext

    mockGpu = true
    mockGpuEnabled = true

    mockSurface = makeSurface()
    mockCtl = makeCtl()
    mountResult = { canvas, surface: mockSurface, destroy: jest.fn(() => mockSurface.destroy()) }
    sessionStorage.clear()
  })

  afterEach(() => {
    jest.useRealTimers()
    proto.getContext = origGetContext
    canvas.remove()
  })

  test('no navigator.gpu takes the synchronous three path', () => {
    mockGpu = false

    proto.getContext = () => null

    expect(mountArchScene(canvas, ROOTS, jest.fn())).toBeNull()
  })

  test('wasm arm resolves → inner mounts, pending setActive replays', async () => {
    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    expect(handle).not.toBeNull()

    handle.setActive('docs/architecture')

    await flush()

    expect(mockSurface.calls.colors.length).toBeGreaterThan(0)

    handle.destroy()

    expect(mockSurface.destroyed).toBe(true)
  })

  test('destroy while the wasm mount is in flight releases the late handle', async () => {
    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    handle.destroy()

    await flush()

    expect(mountResult.destroy).toHaveBeenCalled()
  })

  test('wasm failure falls through to the three arm', async () => {
    mountResult = null

    proto.getContext = function patched() {
      return null
    }

    const onLost = jest.fn()

    mountArchScene(canvas, ROOTS, jest.fn(), onLost)

    await flush()

    // Both paths dead → the host hears onLost.
    expect(onLost).toHaveBeenCalled()
  })

  test('webglAllowed false takes the three path even with navigator.gpu', () => {
    document.documentElement.classList.add(STATE_CLASSES.REDUCED_MOTION)

    proto.getContext = () => null

    expect(mountArchScene(canvas, ROOTS, jest.fn())).toBeNull()

    document.documentElement.classList.remove(STATE_CLASSES.REDUCED_MOTION)
  })

  test('widget-layer kill switch takes the synchronous three path', () => {
    // navigator.gpu present but webgpuWidgetsEnabled() off — the
    // unverified scene3d arm stays parked and three mounts directly.
    mockGpuEnabled = false

    proto.getContext = () => null

    expect(mountArchScene(canvas, ROOTS, jest.fn())).toBeNull()
  })

  test('stalled scene3d mount falls back to three at the deadline', async () => {
    jest.useFakeTimers()

    let resolveMount

    mountResult = new Promise((r) => {
      resolveMount = r
    })

    proto.getContext = function patched(type) {
      if (/webgl/i.test(String(type))) return createMockGL()

      return null
    }

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    expect(handle).not.toBeNull()

    await jest.advanceTimersByTimeAsync(DOCS_UNITS.SCENE3D_MOUNT_TIMEOUT + 1)

    // The deadline mounted the three arm — a late wasm resolution is
    // torn down rather than double-mounting on the one canvas.
    resolveMount({ canvas, surface: mockSurface, destroy: jest.fn(() => mockSurface.destroy()) })

    for (let i = 0; i < 20; i++) await Promise.resolve()

    expect(mockSurface.destroyed).toBe(true)

    handle.destroy()
  })

  test('deadline fallback with no WebGL reports onLost', async () => {
    jest.useFakeTimers()

    mountResult = new Promise(() => {})

    proto.getContext = () => null

    const onLost = jest.fn()

    const handle = mountArchScene(canvas, ROOTS, jest.fn(), onLost)

    await jest.advanceTimersByTimeAsync(DOCS_UNITS.SCENE3D_MOUNT_TIMEOUT + 1)

    expect(onLost).toHaveBeenCalled()

    handle.destroy()
  })

  test('wrapper resize/setPaused delegate through inner, pending pause replays', async () => {
    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    expect(handle).not.toBeNull()

    // Pre-resolution calls — inner is null: the ?. delegates park and
    // setPaused stores pendingPaused for the mount-time replay.
    handle.resize()
    handle.setPaused(true)

    await flush()

    // The replayed pause landed on the resolved 3d arm — a pending tick
    // (or none) sees the paused flag and skips frames.
    const frames = mockSurface.frames.length

    await flush()

    expect(mockSurface.frames.length).toBe(frames)

    // Post-resolution calls hit the live arm directly.
    handle.setPaused(false)
    handle.resize()

    handle.destroy()

    expect(mockSurface.destroyed).toBe(true)
  })

  test('setPaused gates the 3d tick entry; resume refits and re-arms', async () => {
    const origRaf = globalThis.requestAnimationFrame
    let tickFn = null

    globalThis.requestAnimationFrame = (fn) => {
      tickFn = fn

      return 1
    }

    const handle = await mountArchScene3d(canvas, ROOTS, jest.fn())

    expect(handle).not.toBeNull()

    await flush()

    try {
      handle.setPaused(true)

      const frames = mockSurface.frames.length

      tickFn(performance.now())

      expect(mockSurface.frames.length).toBe(frames)

      // Same-state no-op arm.
      handle.setPaused(true)

      // Resume — refits the surface box and re-arms the loop.
      handle.setPaused(false)

      expect(tickFn).not.toBeNull()

      // Direct re-fit entry-point.
      handle.resize()

      // Post-destroy resume stays dead — the !disposed arm.
      handle.setPaused(true)
      handle.destroy()
      handle.setPaused(false)
    } finally {
      globalThis.requestAnimationFrame = origRaf
    }
  })
})
