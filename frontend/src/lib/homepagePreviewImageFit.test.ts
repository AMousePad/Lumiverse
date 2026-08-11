import { describe, expect, test } from 'bun:test'
import {
  fitHomepagePreviewImageSize,
  fitHomepagePreviewPaneWidth,
  getHomepagePreviewAvailableImageHeight,
  getHomepagePreviewStableFrameWidth,
  scaleHomepagePreviewImageWidth,
} from './homepagePreviewImageFit'
import { layoutViewportSize } from './uiScale'

const defaults = {
  frameWidth: 336,
  preferredMaxHeight: 560,
  absoluteMaxHeight: 560,
}

describe('fitHomepagePreviewImageSize', () => {
  test('fits a landscape image to its natural aspect ratio', () => {
    expect(fitHomepagePreviewImageSize({
      ...defaults,
      naturalWidth: 1600,
      naturalHeight: 800,
      availableHeight: 560,
    })).toEqual({ width: 336, height: 168, aspectRatio: 2, stableWidth: 336 })
  })

  test('fits a portrait image without exceeding its natural aspect height', () => {
    expect(fitHomepagePreviewImageSize({
      ...defaults,
      naturalWidth: 800,
      naturalHeight: 1200,
      availableHeight: 560,
    })).toEqual({ width: 336, height: 504, aspectRatio: 2 / 3, stableWidth: 336 })
  })

  test('shrinks a tall image to the pane space left by visible metadata', () => {
    expect(fitHomepagePreviewImageSize({
      ...defaults,
      naturalWidth: 800,
      naturalHeight: 1600,
      availableHeight: 430,
    })).toEqual({ width: 215, height: 430, aspectRatio: 0.5, stableWidth: 280 })
  })

  test('keeps pane width stable when wrapped metadata changes available height', () => {
    const roomy = fitHomepagePreviewImageSize({
      ...defaults,
      naturalWidth: 800,
      naturalHeight: 1600,
      availableHeight: 500,
    })
    const wrapped = fitHomepagePreviewImageSize({
      ...defaults,
      naturalWidth: 800,
      naturalHeight: 1600,
      availableHeight: 420,
    })
    expect(roomy?.stableWidth).toBe(280)
    expect(wrapped?.stableWidth).toBe(280)
    expect(roomy?.width).not.toBe(wrapped?.width)
  })

  test('reaches a fixed height instead of shrinking on repeated observer measurements', () => {
    const metadataHeight = 180
    const rowGap = 6
    const firstAvailableHeight = getHomepagePreviewAvailableImageHeight(603, metadataHeight, rowGap)
    const first = fitHomepagePreviewImageSize({
      ...defaults,
      naturalWidth: 800,
      naturalHeight: 1600,
      availableHeight: firstAvailableHeight,
    })
    const secondAvailableHeight = getHomepagePreviewAvailableImageHeight(
      (first?.height ?? 0) + metadataHeight + rowGap,
      metadataHeight,
      rowGap,
    )
    const second = fitHomepagePreviewImageSize({
      ...defaults,
      naturalWidth: 800,
      naturalHeight: 1600,
      availableHeight: secondAvailableHeight,
    })

    expect(first?.height).toBe(417)
    expect(second?.height).toBe(417)
  })

  test('returns null until valid intrinsic image dimensions are available', () => {
    expect(fitHomepagePreviewImageSize({
      ...defaults,
      naturalWidth: 0,
      naturalHeight: 0,
    })).toBeNull()
  })

  test('keeps a manually lowered portrait frame on the same aspect ratio', () => {
    expect(scaleHomepagePreviewImageWidth(180, 0.5, 215)).toBe(90)
  })

  test('compacts a portrait pane around a readable metadata column', () => {
    expect(fitHomepagePreviewPaneWidth({
      imageWidth: 285,
      metadataMinWidth: 300,
      chromeWidth: 22,
      manualMaxWidth: 420,
    })).toBe(322)
  })

  test('keeps wide artwork at the manual pane maximum', () => {
    expect(fitHomepagePreviewPaneWidth({
      imageWidth: 398,
      metadataMinWidth: 300,
      chromeWidth: 22,
      manualMaxWidth: 420,
    })).toBe(420)
  })

  test('uses the manual pane width until an image fit is available', () => {
    expect(fitHomepagePreviewPaneWidth({
      imageWidth: null,
      metadataMinWidth: 300,
      chromeWidth: 22,
      manualMaxWidth: 360,
    })).toBe(360)
  })

  test('uses UI-scale layout width when fitting a narrow viewport', () => {
    const viewport = layoutViewportSize(
      { width: 1440, height: 900 },
      1.25,
      { innerWidth: 400, innerHeight: 800 },
    )
    expect(getHomepagePreviewStableFrameWidth({
      panelMaxWidth: 420,
      layoutViewportWidth: viewport.width,
      gutter: 24,
      chromeWidth: 22,
    })).toBe(274)
  })
})
