import { subscribeIOSLayout } from './ios-duo-layout'

/** Use the WKWebView's bounds, including the home-indicator area, instead of
 * WebKit viewport units that can exclude safe areas or resolve differently
 * under CSS zoom on older iOS releases.
 * These are scene dimensions, so rotation and iPad window resizing still work. */
export function subscribeIOSNativeViewport(onHeight: (height: number) => void): () => void {
  return subscribeIOSLayout(layout => {
    const root = document.documentElement
    root.style.setProperty('--ios-native-viewport-height', `${layout.height}px`)
    // Older wrappers already report hinge state/regions. Prefer the explicit
    // capability on new wrappers, with native geometry as a compatible fallback.
    const foldable = layout.isFoldable ?? (['closed', 'partiallyOpen', 'fullyOpen'].includes(layout.hingeStatus) || layout.divisions.length > 0)
    root.toggleAttribute('data-ios-foldable', foldable)
    root.setAttribute('data-ios-hinge', layout.hingeStatus ?? 'unknown')
    onHeight(layout.height)
  })
}
