import { renderedPxToLayoutPx } from './uiScale'

/** Reserve a popover's content once, including while its closing content is retained. */
export function measureComposerHeight(composer: HTMLElement, popover: HTMLElement | null): number {
  const content = popover?.firstElementChild as HTMLElement | null | undefined
  if (!popover || !content) return composer.offsetHeight
  // The grid clips its inner wrapper, whose scroll height still describes the
  // whole panel. Publishing each interpolated grid height forces the virtual
  // message list to synchronously render on every expansion frame.
  const baseHeight = renderedPxToLayoutPx(
    composer.getBoundingClientRect().height - popover.getBoundingClientRect().height,
  )
  return baseHeight + content.scrollHeight
}

/** Measure keyboard clearance throughout the composer's CSS movement. */
export function observeComposerMotion(element: HTMLElement, measure: () => void): () => void {
  const view = element.ownerDocument.defaultView!
  const active = new Set<string>()
  let frame = 0
  const relevant = (event: TransitionEvent) => event.target === element &&
    (event.propertyName === 'bottom' || event.propertyName === 'padding-bottom')
  const tick = () => {
    frame = 0
    measure()
    if (active.size) frame = view.requestAnimationFrame(tick)
  }
  const start = (event: TransitionEvent) => {
    if (!relevant(event)) return
    active.add(event.propertyName)
    if (!frame) frame = view.requestAnimationFrame(tick)
  }
  const finish = (event: TransitionEvent) => {
    if (!relevant(event)) return
    active.delete(event.propertyName)
    measure()
    if (!active.size && frame) {
      view.cancelAnimationFrame(frame)
      frame = 0
    }
  }

  element.addEventListener('transitionrun', start)
  element.addEventListener('transitionend', finish)
  element.addEventListener('transitioncancel', finish)
  return () => {
    if (frame) view.cancelAnimationFrame(frame)
    active.clear()
    element.removeEventListener('transitionrun', start)
    element.removeEventListener('transitionend', finish)
    element.removeEventListener('transitioncancel', finish)
  }
}
