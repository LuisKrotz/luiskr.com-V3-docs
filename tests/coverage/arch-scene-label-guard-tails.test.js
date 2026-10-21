/**
 * @file arch-scene-label-guard-tails.test.js
 * @description Coverage tail for arch-scene.ts `makeLabel`'s texture guard —
 * `if (!THREE.CanvasTexture || !THREE.Sprite) return null`: runtimes without
 * the texture/sprite surface skip dir labels and still mount the graph.
 * The sibling arch-scene suite can't reach this arm because jest's ESM
 * layer resolves its `get CanvasTexture()` mock export at link time —
 * frozen before any test can flip the flag — so the missing-texture
 * surface needs its own mock module (this file).
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { createMockGL } from '@tests/fixtures/mock-webgl.js'
import { HTML_TAGS } from '@core/tokens/elements/html.js'

const mockThreeState = {
  rendererThrow: false,
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
    setAttribute() {}
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

  class Raycaster {
    setFromCamera() {}

    intersectObjects() {
      return []
    }
  }

  return {
    __chain: () => {},
    Vector2,
    Vector3,
    Scene,
    Mesh,
    PerspectiveCamera,
    SphereGeometry: Disposable,
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
    // No CanvasTexture — `!THREE.CanvasTexture` fires on every makeLabel
    // call so the guard's return-null arm is deterministic.
    CanvasTexture: undefined,
    Raycaster,
    WebGLRenderer: class {
      constructor() {
        if (mockThreeState.rendererThrow) throw new Error('no renderer')
      }

      setSize() {}
      render() {}
      dispose() {}
    },
  }
})

const { mountArchScene } = await import('@docs/arch-scene.js')
const { wasmPool } = await import('@core/utils/wasm/wasm-pool.js')

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

describe('arch-scene label guard — missing texture surface', () => {
  let origGetContext
  let mockGL

  beforeEach(() => {
    mockGL = createMockGL()

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

  test('dir labels are skipped and the graph still mounts', async () => {
    const spy = jest
      .spyOn(wasmPool, 'dispatch')
      .mockImplementation(async () => ({ results: { xyz: new Float32Array(21).fill(0) } }))

    const canvas = document.createElement(HTML_TAGS.CANVAS)

    document.body.appendChild(canvas)

    const handle = mountArchScene(canvas, ROOTS, jest.fn())

    expect(handle).not.toBe(null)

    await flush()

    const { Scene } = await import('three')

    // Meshes exist for every node; no sprite labels could be built.
    expect(Scene.lastInstance.children.filter((c) => c.isSprite).length).toBe(0)
    expect(Scene.lastInstance.children.length).toBeGreaterThan(0)

    handle.destroy()
    spy.mockRestore()
    canvas.remove()
  })
})
