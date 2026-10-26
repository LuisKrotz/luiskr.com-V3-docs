/**
 * @file docs-tails-edges-layout-fallback.test.js
 * @description Coverage tails — segmentsToRibbons' degenerate-segment and
 * vertical-edge fallback arms, buildEdges' fileBound arms, and the
 * layoutPositionsJs coincident-center guard behind computePositions'
 * wasm-unavailable fallback.
 */

import { describe, test, expect, jest } from '@jest/globals'

const { wasmPool } = await import('@core/utils/wasm/wasm-pool.js')

describe('docs tails — edges + layout fallback arms', () => {
  test('segmentsToRibbons skips zero-length segments and falls back on vertical edges', async () => {
    const { segmentsToRibbons } = await import('@docs/arch-scene-3d.js')

    // Coincident endpoints → `len < 1e-6` continue arm; a vertical edge
    // degenerates cross(dir, +Y) → the `pl < 1e-6` fallback arm.
    const out = segmentsToRibbons(
      [
        0,
        0,
        0,
        0,
        0,
        0, // zero-length
        0,
        0,
        0,
        0,
        1,
        0, // vertical (dir ∥ +Y)
        0,
        0,
        0,
        1,
        0,
        0, // normal
      ],
      0.5
    )

    expect(out.pos.length).toBeGreaterThan(0)
  })

  test('buildEdges takes the fileBound arm on file→file links', async () => {
    const { buildEdges } = await import('@docs/arch-scene-3d.js')

    const placed = [
      {
        node: { type: 'dir', name: 'r', path: 'docs' },
        depth: 0,
        angle: 0,
        parent: -1,
        sib: 0,
        sibCount: 1,
      },
      {
        node: { type: 'file', name: 'a.md', path: 'docs/a.md', id: 'docs:a.md' },
        depth: 1,
        angle: 0,
        parent: 0,
        sib: 0,
        sibCount: 2,
      },
      {
        node: { type: 'file', name: 'b.md', path: 'docs/b.md', id: 'docs:b.md' },
        depth: 1,
        angle: 1,
        parent: 0,
        sib: 1,
        sibCount: 2,
      },
    ]
    const positions = new Float32Array([0, 0, 0, 40, 0, 0, 0, 40, 0])
    const scale = new Float32Array([1, 1, 1])

    const out = buildEdges(placed, positions, scale)

    expect(out.leaf.pos.length).toBeGreaterThan(0)
  })

  test('computePositions falls back to layoutPositionsJs and resolves coincident centers', async () => {
    const spy = jest.spyOn(wasmPool, 'dispatch').mockResolvedValue(null)

    try {
      const { computePositions } = await import('@docs/arch-scene.js')

      // Two parentless roots stay parked at the origin → a coincident
      // pair → the collision loop's `d ≤ 1e-6` arm uses the deterministic
      // spin-hash displacement.
      const placed = [
        {
          node: { type: 'dir', name: 'a', path: 'docs' },
          depth: 0,
          angle: 0,
          parent: -1,
          sib: 0,
          sibCount: 2,
        },
        {
          node: { type: 'dir', name: 'b', path: 'src' },
          depth: 0,
          angle: 0,
          parent: -1,
          sib: 1,
          sibCount: 2,
        },
      ]

      const out = await computePositions(placed)

      expect(out).toBeTruthy()
    } finally {
      spy.mockRestore()
    }
  })
})
