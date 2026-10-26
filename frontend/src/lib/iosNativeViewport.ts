import { subscribeIOSLayout } from './ios-duo-layout'

/** Use the WKWebView's bounds, including the home-indicator area, instead of
 * WebKit viewport units that can exclude safe areas or resolve differently
 * under CSS zoom on older iOS releases.
 * These are scene dimensions, so rotation and iPad window resizing still work. */
export function subscribeIOSNativeViewport(onHeight: (height: number) => void): () => void {
  return subscribeIOSLayout(layout => {
    document.documentElement.style.setProperty('--ios-native-viewport-height', `${layout.height}px`)
    onHeight(layout.height)
  })
}
