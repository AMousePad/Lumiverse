import { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { FloatWidgetState } from '@/store/slices/spindle-placement'
import { useStore } from '@/store'
import useIsMobile from '@/hooks/useIsMobile'
import ContextMenu, { type ContextMenuPos, type ContextMenuEntry } from '@/components/shared/ContextMenu'
import { useLongPress } from '@/hooks/useLongPress'
import { getLiveRootRecordExact } from '@/lib/spindle/live-root-registry'
import { scheduleSpindleDomTask } from '@/lib/spindle/browser-scheduler'
import { getUiScale, layoutViewportSize, toLayoutDelta } from '@/lib/uiScale'
import {
  FLOAT_WIDGET_VIEWPORT_PADDING,
  resolveFloatWidgetSize,
  resolveFloatWidgetStyle,
} from './spindle-float-widget-layout'
import styles from './SpindleFloatWidget.module.css'

interface Props {
  widget: FloatWidgetState
}

export default function SpindleFloatWidget({ widget }: Props) {
  const { t } = useTranslation('shared', { keyPrefix: 'spindle' })
  const updateFloatWidget = useStore((s) => s.updateFloatWidget)
  const setPlacementHidden = useStore((s) => s.setPlacementHidden)
  const isMobile = useIsMobile()

  const drag = useRef<{
    pointerId: number
    x: number
    y: number
    scale: number
    start: { x: number; y: number }
    position: { x: number; y: number }
  } | null>(null)
  const contentHostRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ x: widget.x, y: widget.y })
  const [contextMenu, setContextMenu] = useState<ContextMenuPos | null>(null)
  const [viewport, setViewport] = useState(() => layoutViewportSize())

  const size = useMemo(() => resolveFloatWidgetSize(
    isMobile,
    { width: widget.width, height: widget.height },
    viewport,
  ), [isMobile, viewport, widget.height, widget.width])

  useEffect(() => {
    const updateViewport = () => {
      const next = layoutViewportSize()
      setViewport((prev) => prev.width === next.width && prev.height === next.height ? prev : next)
    }
    const observer = new MutationObserver(updateViewport)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    window.addEventListener('resize', updateViewport)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateViewport)
    }
  }, [])

  useEffect(() => {
    const pad = FLOAT_WIDGET_VIEWPORT_PADDING
    setPos({
      x: Math.max(pad, Math.min(widget.x, viewport.width - size.width - pad)),
      y: Math.max(pad, Math.min(widget.y, viewport.height - size.height - pad)),
    })
  }, [size.height, size.width, viewport.height, viewport.width, widget.x, widget.y])

  useEffect(() => {
    const host = contentHostRef.current
    if (!host) return

    return scheduleSpindleDomTask(() => {
      if (!getLiveRootRecordExact(widget.extensionId, widget.root)) return
      if (!host.isConnected) return
      if (!host.contains(widget.root)) {
        host.replaceChildren(widget.root)
      }
    }, { phase: 'paint' })
  }, [widget.extensionId, widget.root])

  const clampPos = useCallback(
    (x: number, y: number) => {
      const pad = FLOAT_WIDGET_VIEWPORT_PADDING
      return {
        x: Math.max(pad, Math.min(x, viewport.width - size.width - pad)),
        y: Math.max(pad, Math.min(y, viewport.height - size.height - pad)),
      }
    },
    [size.width, size.height, viewport.height, viewport.width]
  )

  const snapToEdge = useCallback(
    (x: number, y: number) => {
      if (!widget.snapToEdge) return { x, y }
      const snapDist = 24
      const pad = FLOAT_WIDGET_VIEWPORT_PADDING
      const vw = viewport.width
      const vh = viewport.height
      let sx = x, sy = y
      if (x < snapDist) sx = pad
      else if (x + size.width > vw - snapDist) sx = vw - size.width - pad
      if (y < snapDist) sy = pad
      else if (y + size.height > vh - snapDist) sy = vh - size.height - pad
      return { x: sx, y: sy }
    },
    [widget.snapToEdge, size.width, size.height, viewport.height, viewport.width]
  )

  const isFullscreen = widget.fullscreen ?? false

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isFullscreen || e.button !== 0 || drag.current) return
    drag.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      scale: getUiScale(),
      start: pos,
      position: pos,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [pos, isFullscreen])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const active = drag.current
    if (!active || active.pointerId !== e.pointerId || isFullscreen) return
    // Pointer coordinates are rendered CSS pixels; left/top live inside the
    // UI zoom layer. Device pixel ratio is already handled by the WebView.
    const delta = toLayoutDelta(e.clientX - active.x, e.clientY - active.y, active.scale)
    active.position = clampPos(active.start.x + delta.x, active.start.y + delta.y)
    setPos(active.position)
  }, [clampPos, isFullscreen])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== e.pointerId) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (isFullscreen) return
    // Release can carry a newer position than the last pointermove. Cancellation
    // and lost capture instead retain the last position we actually displayed.
    if (e.type === 'pointerup') {
      const delta = toLayoutDelta(e.clientX - active.x, e.clientY - active.y, active.scale)
      active.position = clampPos(active.start.x + delta.x, active.start.y + delta.y)
    }
    const snapped = snapToEdge(active.position.x, active.position.y)
    setPos(snapped)
    updateFloatWidget(widget.id, snapped)
    window.dispatchEvent(
      new CustomEvent('spindle:float-drag-end', {
        detail: { widgetId: widget.id, ...snapped },
      })
    )
  }, [clampPos, snapToEdge, updateFloatWidget, widget.id, isFullscreen])

  const longPress = useLongPress({
    onLongPress: (pos) => setContextMenu(pos),
  })

  // The extension owns its content area. If an inner element handled the
  // contextmenu event (either by opening a Spindle context menu via the store,
  // or by calling preventDefault), don't also raise the outer widget-chrome
  // menu — otherwise the less-specific chrome menu wins ownership over the
  // extension's own menu on the same right-click.
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (e.defaultPrevented) return
    if (useStore.getState().pendingContextMenu) return
    longPress.onContextMenu(e)
  }, [longPress])

  const menuItems: ContextMenuEntry[] = useMemo(() => [
    {
      key: 'hide',
      label: t('hideWidget'),
      onClick: () => { setPlacementHidden(widget.id, true); setContextMenu(null) },
    },
    {
      key: 'reset',
      label: t('resetPosition'),
      onClick: () => {
        const pad = FLOAT_WIDGET_VIEWPORT_PADDING
        const resetWidth = widget.defaultWidth
        const resetHeight = widget.defaultHeight
        const bounds = layoutViewportSize()
        const reset = {
          x: Math.max(pad, Math.min(widget.defaultX, bounds.width - resetWidth - pad)),
          y: Math.max(pad, Math.min(widget.defaultY, bounds.height - resetHeight - pad)),
          width: resetWidth,
          height: resetHeight,
        }
        setPos({ x: reset.x, y: reset.y })
        updateFloatWidget(widget.id, reset)
        setContextMenu(null)
      },
    },
  ], [
    t,
    setPlacementHidden,
    updateFloatWidget,
    widget.defaultHeight,
    widget.defaultWidth,
    widget.defaultX,
    widget.defaultY,
    widget.id,
  ])

  if (!widget.visible) return null

  const widgetStyle = resolveFloatWidgetStyle(isFullscreen, pos, size)

  return (
    <>
      <div
        className={`${styles.widget}${widget.chromeless ? ` ${styles.chromeless}` : ''}${isFullscreen ? ` ${styles.fullscreen}` : ''}`}
        style={widgetStyle}
        title={widget.tooltip}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
        {...longPress}
        onTouchStart={(e) => { if (!widget.root.contains(e.target as Node)) longPress.onTouchStart(e) }}
        onContextMenu={handleContextMenu}
      >
        <div className={styles.content} ref={contentHostRef} />
      </div>

      <ContextMenu
        position={contextMenu}
        items={menuItems}
        onClose={() => setContextMenu(null)}
      />
    </>
  )
}
