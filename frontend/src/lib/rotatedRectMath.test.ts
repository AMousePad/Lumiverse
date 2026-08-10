import { describe, expect, test } from 'bun:test'
import { clampRectToBounds, resizeRectFromHandle, toLocalDelta } from './rotatedRectMath'

describe('rotated rectangle math', () => {
  test('maps a downward screen drag to local east at 90 degrees', () => { expect(toLocalDelta(0, 100, 90).dx).toBeCloseTo(100) })
  test('preserves aspect and clamps a resized rectangle', () => {
    expect(resizeRectFromHandle({ x: 0, y: 0, width: 80, height: 40 }, 'se', { dx: 40, dy: 0 }, { aspectRatio: 2, bounds: { x: 0, y: 0, width: 100, height: 100 } })).toEqual({ x: 0, y: 0, width: 100, height: 50 })
    expect(clampRectToBounds({ x: 90, y: 90, width: 40, height: 40 }, { x: 0, y: 0, width: 100, height: 100 })).toEqual({ x: 60, y: 60, width: 40, height: 40 })
  })
})
