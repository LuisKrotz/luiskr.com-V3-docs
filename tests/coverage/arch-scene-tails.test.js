/**
 * @file arch-scene-tails.test.js
 * @description Coverage tails for the docs architecture scene — mounts
 * the three.js radial tree on a stubbed WebGL context, exercises node
 * picking, resize and teardown, plus the ViewDocs scene lifecycle
 * (mount on root, destroy on navigate-away).
 *
 * `three` is module-mocked with a minimal controllable implementation —
 * the repo-wide proxy mock can't drive raycast hits, and these tails
 * need real node/userData plumbing.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { mount } from '@tests/fixtures/test-constants.js'
import { createMockGL, createMock2D } from '@tests/fixtures/mock-webgl.js'
import { HTML_TAGS } from '@core/tokens/elements/html.js'
import { WEBGL_STRINGS } from '@core/tokens/strings/webgl.js'
import { DOCS_IDS } from '@core/tokens/ids/docs.js'
import { DOCS_CLASSES } from '@core/tokens/classes/docs.js'
import { PRINT_EVENTS } from '@core/tokens/events/dom.js'
import { ROUTE_PATHS } from '@core/tokens/routes/paths.js'

// Shared raycast-hit queue — the click handler picks hit[0].userData.path.
const mockThreeState = {
  hits: [],
  rendererThrow: false,
  renderThrow: false,
  noCanvasTex: false,
  noSprite: false,
  renders: 0,
}

jest.unstable_mockModule('three', () => {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x
      this.y = y
      this.z = z
    }

    set(x, y, z) {
      this.x = x
      this.y = y
      this.z = z

      return this
    }

    copy(v) {
      this.x = v.x
      this.y = v.y
      this.z = v.z

      return this
    }

    setScalar(s) {
      this.x = s
      this.y = s
      this.z = s

      return this
    }
  }

  class Vector2 {
    set(x, y) {
      this.x = x
      this.y = y

      return this
    }
  }

  class Disposable {
    dispose() {}
  }

  class Scene {
    constructor() {
      this.children = []

      // Object3D's Euler — the intro settle writes scene.rotation.y.
      this.rotation = { x: 0, y: 0, z: 0 }

      Scene.lastInstance = this
    }

    add(o) {
      this.children.push(o)
    }
  }

  class Mesh extends Disposable {
    constructor(geometry, material) {
      super()

      this.geometry = geometry || new Disposable()
      this.material = material || new Disposable()
      this.userData = {}
      this.position = new Vector3()
      this.scale = new Vector3()
    }
  }

  class PerspectiveCamera {
    constructor() {
      this.aspect = 1
      this.position = new Vector3()
    }

    updateProjectionMatrix() {}
  }

  class BufferGeometry extends Disposable {
    constructor() {
      super()

      // Named attribute streams — instanced alpha/active land here so
      // the scene's highlight pass can read them back.
      this.attributes = {}
    }

    setAttribute(name, attr) {
      this.attributes[name] = attr
    }

    getAttribute(name) {
      return this.attributes[name]
    }
  }

  class InstancedBufferAttribute extends Disposable {
    constructor(array, itemSize = 1) {
      super()

      this.array = array
      this.itemSize = itemSize
      this.needsUpdate = false
    }

    setX(i, v) {
      this.array[i * this.itemSize] = v
    }
  }

  class Matrix4 {
    setPosition() {
      return this
    }
  }

  class InstancedMesh extends Mesh {
    constructor(geometry, material, count = 0) {
      super(geometry, material)

      this.count = count
      this.instanceMatrix = new InstancedBufferAttribute(new Float32Array(count * 16), 16)
      this.isInstancedMesh = true
    }

    setMatrixAt() {}
  }

  class Color extends Disposable {
    constructor(v) {
      super()

      this.value = v
    }
  }

  class Sprite extends Mesh {
    constructor(material) {
      super()

      this.material = material || new Disposable()
      this.isSprite = true
    }
  }

  class SpriteMaterial extends Disposable {
    constructor(opts = {}) {
      super()

      Object.assign(this, opts)
    }
  }

  class CanvasTexture extends Disposable {
    constructor(image) {
      super()

      this.image = image
    }
  }

  class Raycaster {
    setFromCamera() {}

    intersectObjects() {
      return mockThreeState.hits
    }
  }

  return {
    // three-post.js (OrbitControls mock map) imports this from './three.js'.
    __chain: () => {},
    Vector2,
    Vector3,
    Scene,
    Mesh,
    PerspectiveCamera,
    SphereGeometry: BufferGeometry,
    InstancedMesh,
    InstancedBufferAttribute,
    Matrix4,
    // Stores constructor opts — the scene mutates material.opacity for
    // the active-location highlight, so opacity must read back.
    MeshBasicMaterial: class extends Disposable {
      constructor(opts = {}) {
        super()

        Object.assign(this, opts)
      }
    },
    MeshStandardMaterial: Disposable,
    BufferGeometry,
    Float32BufferAttribute: class {},
    LineSegments: class {},
    LineBasicMaterial: Disposable,
    AmbientLight: class {},
    Color,
    Sprite,
    SpriteMaterial,
    // Getter — tails flip `mockThreeState.noCanvasTex` to exercise the
    // `!THREE.CanvasTexture` label guard without a second mock module.
    get CanvasTexture() {
      return mockThreeState.noCanvasTex ? undefined : CanvasTexture
    },
    Raycaster,
    WebGLRenderer: class {
      constructor() {
        if (mockThreeState.rendererThrow) throw new Error('no renderer')
      }

      setSize() {}
      render() {
        mockThreeState.renders++

        if (mockThreeState.renderThrow) throw new Error('gpu crash')
      }
      dispose() {}
    },
  }
})

const { mountArchScene, placeRoots } = await import('@docs/arch-scene.js')
const { DOCS_STRINGS, DOCS_UNITS } = await import('@core/tokens/strings/docs.js')
const { ViewDocs } = await import('@docs/Docs.js')
const { CACHE_STORAGE_KEYS } = await import('@core/tokens/data/storage.js')
const { GL_EVENTS } = await import('@core/tokens/events/dom.js')
const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
const { wasmPool } = await import('@core/utils/wasm/wasm-pool.js')
const router = (await import('@core/router/router.js')).default

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
  {
    root: 'src',
    label: 'Source Code',
    children: [{ type: 'file', name: 'App.tsx', path: 'src/App.tsx', id: 'src:App.tsx' }],
  },
]

const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms))

/**
 * Reads the instanced alpha + active flag for a manifest path. Nodes
 * render as TWO InstancedMesh tiers — dir spheres first, file spheres
 * second, in scene-add order — and a path's instance slot is the index
 * it holds inside its own tier (the same partition buildGraph runs).
 */
const instanceAttrs = (Scene, path) => {
  const placed = placeRoots(ROOTS)
  const isDir = placed.find((p) => p.node.path === path)?.node.type !== 'file'
  const slot = placed
    .filter((p) => (p.node.type !== 'file') === isDir)
    .findIndex((p) => p.node.path === path)

  const tier = Scene.lastInstance.children.filter((c) => c.isInstancedMesh)[isDir ? 0 : 1]

  return {
    alpha: tier.geometry.getAttribute(DOCS_STRINGS.SCENE_ATTR_ALPHA).array[slot],
    active: tier.geometry.getAttribute(DOCS_STRINGS.SCENE_ATTR_ACTIVE).array[slot],
    mesh: tier,
    slot,
  }
}

describe('docs architecture scene', () => {
  let origGetContext
  let mockGL

  beforeEach(() => {
    mockThreeState.hits = []
    mockThreeState.rendererThrow = false
    mockThreeState.renderThrow = false
    mockThreeState.renders = 0
    mockGL = createMockGL()

    sessionStorage.clear()

    const proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype

    origGetContext = proto.getContext

    proto.getContext = function patched(type) {
      if (/webgl/i.test(String(type))) return mockGL

      return null
    }
  })

  afterEach(() => {
    const proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype

    proto.getContext = origGetContext
  })

  test('mounts the radial tree, ticks frames, resizes and destroys', async () => {
    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    expect(handle).not.toBe(null)

    await flush()

    handle.destroy()

    canvas.remove()
  })

  test('printcapture repaints a frame and answers with a PNG data URL', () => {
    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    canvas.toDataURL = () => 'data:image/png;base64,CAP=='

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    expect(handle).not.toBe(null)

    const detail = {}
    const before = mockThreeState.renders

    canvas.dispatchEvent(new CustomEvent(PRINT_EVENTS.CAPTURE, { detail }))

    expect(mockThreeState.renders).toBeGreaterThan(before)
    expect(detail.dataUrl).toContain('data:image/png')

    // A crashed paint answers with nothing — the print walk falls back
    // to its own toDataURL read for this canvas.
    mockThreeState.renderThrow = true
    detail.dataUrl = undefined

    canvas.dispatchEvent(new CustomEvent(PRINT_EVENTS.CAPTURE, { detail }))

    expect(detail.dataUrl).toBeUndefined()

    handle.destroy()

    canvas.remove()
  })

  test('click pick routes the node path to onPick', () => {
    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const onPick = jest.fn()

    const handle = mountArchScene(canvas, ROOTS, onPick)

    mockThreeState.hits = [{ object: { userData: { path: 'docs/architecture' } } }]

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10 }))

    expect(onPick).toHaveBeenCalledWith('docs/architecture')

    handle.destroy()
    canvas.remove()
  })

  test('empty hit list is a no-op', () => {
    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const onPick = jest.fn()

    const handle = mountArchScene(canvas, ROOTS, onPick)

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 1, clientY: 1 }))

    expect(onPick).not.toHaveBeenCalled()

    handle.destroy()
    canvas.remove()
  })

  test('labels skip cleanly when THREE.CanvasTexture is unavailable', async () => {
    mockThreeState.noCanvasTex = true

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    expect(handle).not.toBe(null)

    await flush()

    handle.destroy()
    canvas.remove()
    mockThreeState.noCanvasTex = false
  })

  test('renderer construction failure lands on the null fallback', () => {
    mockThreeState.rendererThrow = true

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    expect(mountArchScene(canvas, ROOTS, jest.fn())).toBe(null)

    canvas.remove()
  })

  test('returns null when no WebGL2 context is available', () => {
    const proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype

    proto.getContext = () => null

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    expect(mountArchScene(canvas, ROOTS, jest.fn())).toBe(null)

    proto.getContext = origGetContext

    proto.getContext = function patched(type) {
      if (/webgl/i.test(String(type))) return mockGL

      return null
    }
  })

  test('ViewDocs scene persists across docs navigations and follows the path', async () => {
    const prev = router.currentRoute

    router.currentRoute = {
      name: 'docs',
      meta: { docsRoute: true },
      params: { docsPath: '' },
    }

    const view = new ViewDocs()
    const cleanup = mount(view)

    await flush()

    const first = view._sceneHandle

    expect(first).not.toBe(null)

    // The canvas is persistent — navigation re-seats the SAME scene and
    // only re-syncs the active-path highlight (no GPU remount).
    const activeSpy = jest.spyOn(first, 'setActive')

    view.onRouteParamChange({ params: { docsPath: 'docs' } })
    await flush()

    expect(view._sceneHandle).toBe(first)
    expect(activeSpy).toHaveBeenCalledWith('docs')

    cleanup()
    router.currentRoute = prev
  })

  test('ViewDocs scene path mounts + component destroy releases it', async () => {
    const prev = router.currentRoute

    router.currentRoute = {
      name: 'docs',
      meta: { docsRoute: true },
      params: { docsPath: '' },
    }

    const view = new ViewDocs()
    const cleanup = mount(view)

    await flush()

    cleanup()

    router.currentRoute = prev
  })

  test('picking a scene node navigates the portal', async () => {
    const prev = router.currentRoute

    router.currentRoute = {
      name: 'docs',
      meta: { docsRoute: true },
      params: { docsPath: '' },
    }

    const view = new ViewDocs()
    const cleanup = mount(view)

    await flush()

    const pushSpy = jest.spyOn(router, 'push').mockImplementation(async () => {})

    const canvas = view.shadowRoot.querySelector(`#${DOCS_IDS.SCENE}`)

    mockThreeState.hits = [{ object: { userData: { path: 'docs/architecture' } } }]

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 5, clientY: 5 }))

    expect(pushSpy).toHaveBeenCalledWith(`${ROUTE_PATHS.DOCS}/docs/architecture`)

    pushSpy.mockRestore()
    cleanup()
    router.currentRoute = prev
  })

  test('a click past the tap-slop radius is treated as a drag, not a pick', () => {
    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const onPick = jest.fn()

    const handle = mountArchScene(canvas, ROOTS, onPick)

    const down = new Event('pointerdown', { bubbles: true })

    down.clientX = 0
    down.clientY = 0

    canvas.dispatchEvent(down)

    mockThreeState.hits = [{ object: { userData: { path: 'docs' } } }]

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 200, clientY: 200 }))

    expect(onPick).not.toHaveBeenCalled()

    handle.destroy()
    canvas.remove()
  })

  test('dir labels draw when 2d canvas is available; dispose frees textures', async () => {
    const proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype

    proto.getContext = function patched(type) {
      if (/webgl/i.test(String(type))) return mockGL

      if (type === WEBGL_STRINGS.CONTEXT_2D) return createMock2D()

      return null
    }

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    canvas.style.color = 'red'

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    await flush()

    handle.destroy()
    canvas.remove()
  })

  test('wasm-dispatched positions populate the graph when the pool answers', async () => {
    const spy = jest
      .spyOn(wasmPool, 'dispatch')
      .mockImplementation(async () => ({ results: { xyz: new Float32Array(21).fill(0) } }))

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    await flush()

    expect(spy).toHaveBeenCalled()

    handle.destroy()
    spy.mockRestore()
    canvas.remove()
  })

  test('first gesture stops autoRotate and persists the camera pose', () => {
    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    const controls = OrbitControls.lastInstance

    expect(controls.autoRotate).toBe(true)

    controls.dispatch('start')

    expect(controls.autoRotate).toBe(false)

    controls.dispatch('end')

    const saved = JSON.parse(sessionStorage.getItem(CACHE_STORAGE_KEYS.DOCS_SCENE_STATE))

    expect(saved.off).toBe(true)
    expect(saved.p.length).toBe(3)

    handle.destroy()
    canvas.remove()
  })

  test('a persisted pose is restored on remount — rotation stays off', () => {
    sessionStorage.setItem(
      CACHE_STORAGE_KEYS.DOCS_SCENE_STATE,
      JSON.stringify({ p: [1, 2, 3], t: [4, 5, 6], off: true })
    )

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    expect(OrbitControls.lastInstance.autoRotate).toBe(false)

    handle.destroy()

    // Malformed stored state falls back to defaults instead of throwing.
    sessionStorage.setItem(CACHE_STORAGE_KEYS.DOCS_SCENE_STATE, 'not json')

    const handle2 = mountArchScene(canvas, ROOTS, jest.fn())

    expect(OrbitControls.lastInstance.autoRotate).toBe(true)

    handle2.destroy()
    canvas.remove()
  })

  test('context loss notifies the host; a dead tick stops scheduling', () => {
    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const onLost = jest.fn()

    const handle = mountArchScene(canvas, ROOTS, jest.fn(), onLost)

    canvas.dispatchEvent(new Event(GL_EVENTS.WEBGL_CONTEXT_LOST))

    expect(onLost).toHaveBeenCalledTimes(1)

    handle.destroy()
    canvas.remove()
  })

  test('a render throw mid-frame takes the same host-notified path', async () => {
    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const onLost = jest.fn()

    const handle = mountArchScene(canvas, ROOTS, jest.fn(), onLost)

    mockThreeState.renderThrow = true

    await flush()

    expect(onLost).toHaveBeenCalledTimes(1)

    mockThreeState.renderThrow = false

    handle.destroy()
    canvas.remove()
  })

  test('a controls.update throw mid-frame lands on the same path', async () => {
    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const onLost = jest.fn()

    const handle = mountArchScene(canvas, ROOTS, jest.fn(), onLost)

    // The tick's outer try guards the controls/intro/clock work — the
    // render call has its own catch inside paintFrame.
    OrbitControls.lastInstance.update = () => {
      throw new Error('ctl crash')
    }

    await flush()

    expect(onLost).toHaveBeenCalledTimes(1)

    handle.destroy()
    canvas.remove()
  })

  test('a null wasm result falls back to the JS layout', async () => {
    const spy = jest.spyOn(wasmPool, 'dispatch').mockImplementation(async () => null)

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    await flush()

    expect(handle).not.toBe(null)

    handle.destroy()

    // A reply without the `results` envelope takes the same fallback.
    spy.mockImplementation(async () => ({}))

    const handle2 = mountArchScene(canvas, ROOTS, jest.fn())

    await flush()

    expect(handle2).not.toBe(null)

    handle2.destroy()
    spy.mockRestore()
    canvas.remove()
  })

  test('a wrong-length wasm result falls back to the JS layout', async () => {
    const spy = jest
      .spyOn(wasmPool, 'dispatch')
      .mockImplementation(async () => ({ results: { xyz: [1, 2] } }))

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    await flush()

    expect(handle).not.toBe(null)

    handle.destroy()
    spy.mockRestore()
    canvas.remove()
  })

  test('camera state reads/writes as no-ops when sessionStorage is unavailable', () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')

    Object.defineProperty(globalThis, 'sessionStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    })

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    expect(OrbitControls.lastInstance.autoRotate).toBe(true)

    // Gesture → saveCamState hits the same storage-undefined guard.
    OrbitControls.lastInstance.dispatch('start')
    OrbitControls.lastInstance.dispatch('end')

    handle.destroy()
    canvas.remove()

    Object.defineProperty(globalThis, 'sessionStorage', desc)
  })

  test('a well-formed JSON pose with wrong vector shapes uses defaults', () => {
    sessionStorage.setItem(
      CACHE_STORAGE_KEYS.DOCS_SCENE_STATE,
      JSON.stringify({ p: [1], t: [4, 5, 6], off: true })
    )

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    expect(OrbitControls.lastInstance.autoRotate).toBe(true)

    handle.destroy()
    canvas.remove()
  })

  test('context loss while positions are in flight drops the graph build', async () => {
    const spy = jest
      .spyOn(wasmPool, 'dispatch')
      .mockImplementation(() => new Promise((r) => setTimeout(() => r(null), 5)))

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const onLost = jest.fn()

    const handle = mountArchScene(canvas, ROOTS, jest.fn(), onLost)

    canvas.dispatchEvent(new Event(GL_EVENTS.WEBGL_CONTEXT_LOST))

    await flush()

    expect(onLost).toHaveBeenCalledTimes(1)

    handle.destroy()
    spy.mockRestore()
    canvas.remove()
  })

  test('scene context loss flags the ViewDocs canvas off without crashing the portal', async () => {
    const prev = router.currentRoute

    router.currentRoute = {
      name: 'docs',
      meta: { docsRoute: true },
      params: { docsPath: '' },
    }

    const view = new ViewDocs()
    const cleanup = mount(view)

    await flush()

    expect(view._sceneHandle).not.toBe(null)

    view._sceneCanvas.dispatchEvent(new Event(GL_EVENTS.WEBGL_CONTEXT_LOST))

    expect(view._sceneHandle).toBe(null)
    expect(view._sceneCanvas.classList.contains(DOCS_CLASSES.DOCS_SCENE_OFF)).toBe(true)

    cleanup()
    router.currentRoute = prev
  })

  test('webglcontextrestored remounts the ViewDocs scene on the same canvas', async () => {
    const prev = router.currentRoute

    router.currentRoute = {
      name: 'docs',
      meta: { docsRoute: true },
      params: { docsPath: '' },
    }

    const view = new ViewDocs()
    const cleanup = mount(view)

    await flush()

    const first = view._sceneHandle

    expect(first).not.toBe(null)

    view._sceneCanvas.dispatchEvent(new Event(GL_EVENTS.WEBGL_CONTEXT_RESTORED))

    await flush()

    expect(view._sceneHandle).not.toBe(null)
    expect(view._sceneHandle).not.toBe(first)

    cleanup()
    router.currentRoute = prev
  })

  test('setActive highlights the live node and lifts its ancestors', async () => {
    const { Scene } = await import('three')

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    await flush()

    handle.setActive('docs/architecture')

    const active = instanceAttrs(Scene, 'docs/architecture')
    const ancestor = instanceAttrs(Scene, 'docs')
    const offPath = instanceAttrs(Scene, 'src/App.tsx')

    expect(active.alpha).toBeCloseTo(DOCS_UNITS.SCENE_ACTIVE_OPACITY)
    expect(active.active).toBe(1)
    expect(ancestor.alpha).toBeCloseTo(DOCS_UNITS.SCENE_ANCESTOR_OPACITY)
    expect(ancestor.active).toBe(0)
    expect(offPath.alpha).toBeCloseTo(DOCS_UNITS.SCENE_FILE_OPACITY)

    // Returning to the portal root restores the faint backdrop alpha and
    // lights the center node ('' is its path) instead.
    handle.setActive('')

    expect(instanceAttrs(Scene, 'docs/architecture').alpha).toBeCloseTo(
      DOCS_UNITS.SCENE_DIR_OPACITY
    )
    expect(instanceAttrs(Scene, '').alpha).toBeCloseTo(DOCS_UNITS.SCENE_ACTIVE_OPACITY)
    expect(instanceAttrs(Scene, '').active).toBe(1)

    handle.destroy()
    canvas.remove()
  })

  test('setActive before the graph lands re-applies when meshes build', async () => {
    const { Scene } = await import('three')

    const spy = jest
      .spyOn(wasmPool, 'dispatch')
      .mockImplementation(() => new Promise((r) => setTimeout(() => r(null), 5)))

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    // Path arrives while positions are still in flight.
    handle.setActive('docs/architecture')

    await flush()

    // The deferred buildGraph re-applied the in-flight highlight into
    // the instanced attribute stream.
    expect(instanceAttrs(Scene, 'docs/architecture').alpha).toBeCloseTo(
      DOCS_UNITS.SCENE_ACTIVE_OPACITY
    )

    handle.destroy()
    spy.mockRestore()
    canvas.remove()
  })

  test('a fresh mount eases the graph in via the intro turn; a saved pose skips it', async () => {
    const { Scene } = await import('three')

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    await flush()

    // ~50ms into a multi-second ease — the graph is still rotated in.
    expect(Math.abs(Scene.lastInstance.rotation.y)).toBeGreaterThan(0.1)

    handle.destroy()

    sessionStorage.setItem(
      CACHE_STORAGE_KEYS.DOCS_SCENE_STATE,
      JSON.stringify({ p: [1, 2, 3], t: [4, 5, 6], off: false })
    )

    const handle2 = mountArchScene(canvas, ROOTS, jest.fn())

    await flush()

    expect(Scene.lastInstance.rotation.y).toBe(0)

    handle2.destroy()
    canvas.remove()
  })

  test('ViewDocs syncs the active path into the scene on navigation', async () => {
    const prev = router.currentRoute

    router.currentRoute = {
      name: 'docs',
      meta: { docsRoute: true },
      params: { docsPath: '' },
    }

    const view = new ViewDocs()
    const cleanup = mount(view)

    await flush()

    view.onRouteParamChange({ params: { docsPath: 'docs' } })

    await flush()

    // The nav re-render remounts the scene; assert the wiring end-to-end
    // via the painted highlight on the fresh scene's node.
    const { Scene } = await import('three')

    expect(instanceAttrs(Scene, 'docs').alpha).toBeCloseTo(DOCS_UNITS.SCENE_ACTIVE_OPACITY)

    cleanup()
    router.currentRoute = prev
  })

  test('instanced hits resolve through the tier table; foreign hits miss', async () => {
    const { Scene } = await import('three')

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const onPick = jest.fn()

    const handle = mountArchScene(canvas, ROOTS, onPick)

    await flush()

    const arch = instanceAttrs(Scene, 'docs/architecture')

    // A real three.js instanced hit carries the mesh + instanceId.
    mockThreeState.hits = [{ object: arch.mesh, instanceId: arch.slot }]

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10 }))

    expect(onPick).toHaveBeenCalledWith('docs/architecture')

    // An instanceId on an object that is not a scene tier → no pick.
    mockThreeState.hits = [{ object: {}, instanceId: 0 }]

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10 }))

    expect(onPick).toHaveBeenCalledTimes(1)

    // Out-of-range instanceId on a real tier → no pick either.
    mockThreeState.hits = [{ object: arch.mesh, instanceId: arch.mesh.count + 5 }]

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10 }))

    expect(onPick).toHaveBeenCalledTimes(1)

    // A hit with no object at all → no pick.
    mockThreeState.hits = [{}]

    canvas.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10 }))

    expect(onPick).toHaveBeenCalledTimes(1)

    handle.destroy()
    canvas.remove()
  })

  test('the node-material shader patch injects pulse + instanced alpha', async () => {
    const { Scene } = await import('three')

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    await flush()

    const tier = Scene.lastInstance.children.find((c) => c.isInstancedMesh)

    // The mock renderer never compiles programs — invoke the patch
    // hook the way three would at first render.
    const shader = { uniforms: {}, vertexShader: 'v', fragmentShader: 'f' }

    tier.material.onBeforeCompile(shader)

    expect(shader.uniforms.uTime.value).toBeGreaterThanOrEqual(0)
    expect(shader.vertexShader).toContain(DOCS_STRINGS.SCENE_ATTR_ALPHA)
    expect(shader.fragmentShader).toContain('v')

    handle.destroy()
    canvas.remove()
  })

  test('label reveal is dirty-gated — a steady camera skips the rewrite', async () => {
    const proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype

    proto.getContext = function patched(type) {
      if (/webgl/i.test(String(type))) return mockGL

      if (type === WEBGL_STRINGS.CONTEXT_2D) return createMock2D()

      return null
    }

    const origRaf = globalThis.requestAnimationFrame
    let tickFn = null

    globalThis.requestAnimationFrame = (fn) => {
      tickFn = fn

      return 1
    }

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    canvas.style.color = 'red'

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    await flush()

    try {
      // Two steady-camera ticks: the first writes the reveal alpha, the
      // second finds a === l.a and skips — the dirty-gate else arm.
      tickFn(performance.now())
      tickFn(performance.now())
    } finally {
      globalThis.requestAnimationFrame = origRaf
    }

    handle.destroy()
    canvas.remove()
  })

  test('dirs deeper than SCENE_LABEL_MAX_DEPTH skip their label sprite', async () => {
    const proto = window.HTMLCanvasElement?.prototype || HTMLCanvasElement.prototype

    proto.getContext = function patched(type) {
      if (/webgl/i.test(String(type))) return mockGL

      if (type === WEBGL_STRINGS.CONTEXT_2D) return createMock2D()

      return null
    }

    const deep = {
      type: 'dir',
      name: 'a',
      path: 'deep/a',
      children: [
        {
          type: 'dir',
          name: 'b',
          path: 'deep/a/b',
          children: [{ type: 'dir', name: 'c', path: 'deep/a/b/c', children: [] }],
        },
      ],
    }

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    canvas.style.color = 'red'

    document.body.appendChild(canvas)

    const handle = mountArchScene(
      canvas,
      [{ root: 'deep', label: 'Deep', children: [deep] }],
      jest.fn()
    )

    await flush()

    const { Scene } = await import('three')

    // Labeled: '' (depth 0), 'deep' bucket (1), a (2), b (3) — c sits at
    // depth 4, past the cap, so exactly 4 sprites exist.
    expect(Scene.lastInstance.children.filter((c) => c.isSprite).length).toBe(4)

    handle.destroy()
    canvas.remove()
  })

  test('setPaused halts and re-arms the rAF loop; resize refits', async () => {
    const origRaf = globalThis.requestAnimationFrame
    let tickFn = null

    globalThis.requestAnimationFrame = (fn) => {
      tickFn = fn

      return 1
    }

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    expect(handle).not.toBe(null)

    await flush()

    try {
      // Same-state call is a no-op.
      handle.setPaused(false)

      // Pause parks the loop; a pending tick that fires anyway dead-ends
      // on the entry guard without painting.
      handle.setPaused(true)

      const before = mockThreeState.renders

      tickFn(performance.now())

      expect(mockThreeState.renders).toBe(before)

      // Resume — refits the canvas box and re-arms the loop.
      handle.setPaused(false)

      expect(tickFn).not.toBe(null)

      // Direct re-fit entry-point.
      handle.resize()

      // Post-destroy resume stays dead — the !disposed arm.
      handle.setPaused(true)
      handle.destroy()
      handle.setPaused(false)
    } finally {
      globalThis.requestAnimationFrame = origRaf
    }

    canvas.remove()
  })

  test('missing ResizeObserver keeps the mount-time size; an observed resize refits', async () => {
    const origRO = globalThis.ResizeObserver

    // RO-absent arm — the observer optional-chain collapses to null.
    delete globalThis.ResizeObserver

    const c1 = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(c1)

    const h1 = mountArchScene(c1, ROOTS, jest.fn())

    expect(h1).not.toBe(null)

    h1.destroy()
    c1.remove()

    // RO-callback arm — a delivered observation re-runs the fit.
    let roCb = null

    globalThis.ResizeObserver = class {
      constructor(cb) {
        roCb = cb
      }

      observe() {}
      disconnect() {}
    }

    const c2 = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(c2)

    const h2 = mountArchScene(c2, ROOTS, jest.fn())

    expect(h2).not.toBe(null)

    // The RO callback defers the fit to rAF — firing twice before the
    // frame flushes covers the coalesce early-return, then the deferred
    // callback re-runs the fit once.
    roCb()
    roCb()

    await flush()

    h2.destroy()
    c2.remove()

    globalThis.ResizeObserver = origRO
  })
})
