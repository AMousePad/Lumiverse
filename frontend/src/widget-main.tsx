import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { initI18n } from '@/i18n'
import { useStore } from '@/store'
import { useWebSocket } from '@/ws/useWebSocket'
import { useThemeApplicator } from '@/hooks/useThemeApplicator'
import { useCustomCSSApplicator } from '@/hooks/useCustomCSSApplicator'
import { initializeSafeThemeMode } from '@/lib/safeThemeMode'
import { installDisplayPerformanceTelemetry, markDisplayInteractive, markDisplayMilestone } from '@/lib/displayPerformance'
import DesktopFloatingWidgetHost from '@/components/spindle/DesktopFloatingWidgetHost'
import ErrorBoundary from '@/components/shared/ErrorBoundary'
import './theme/variables.css'
import './theme/reset.css'
import './theme/global.css'

installDisplayPerformanceTelemetry('desktop-widget')

function DesktopWidgetAuthGate({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useStore((state) => state.isAuthenticated)
  const isAuthLoading = useStore((state) => state.isAuthLoading)
  const checkSession = useStore((state) => state.checkSession)

  useEffect(() => {
    void checkSession()
  }, [checkSession])

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      void getCurrentWindow().close().catch(() => {})
    }
  }, [isAuthenticated, isAuthLoading])

  return isAuthenticated ? <>{children}</> : null
}

function DesktopWidgetRuntime() {
  useWebSocket()
  useThemeApplicator()
  useCustomCSSApplicator()
  return <DesktopFloatingWidgetHost />
}

document.documentElement.setAttribute('data-tauri-desktop', '')
document.documentElement.setAttribute('data-tauri-floating-widget', '')

void Promise.all([initI18n(), initializeSafeThemeMode()]).then(() => {
  markDisplayMilestone('render-scheduled')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary label="Desktop widget">
        <DesktopWidgetAuthGate>
          <DesktopWidgetRuntime />
        </DesktopWidgetAuthGate>
      </ErrorBoundary>
    </StrictMode>,
  )
  markDisplayInteractive()
})
