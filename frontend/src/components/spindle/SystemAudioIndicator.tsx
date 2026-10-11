import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/store'

/**
 * Stays on screen for as long as any extension is analysing system audio, owned by the host so an extension can
 * neither hide it nor restyle it. Stop ends that extension's session immediately.
 */
export default function SystemAudioIndicator() {
  const { t } = useTranslation('shared', { keyPrefix: 'spindle.systemAudio' })
  const sessions = useStore((s) => s.systemAudioSessions)
  if (sessions.length === 0) return null

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      data-testid="system-audio-indicator"
      style={{
        position: 'fixed',
        left: 'max(12px, env(safe-area-inset-left, 0px))',
        bottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
        zIndex: 10003,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        maxWidth: 'min(360px, calc(100vw - 24px))',
      }}
    >
      {sessions.map((session) => (
        <div
          key={session.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 8px 8px 12px',
            borderRadius: 999,
            fontSize: 12,
            color: 'var(--lumiverse-text)',
            background: 'var(--lumiverse-bg-elevated)',
            border: '1px solid var(--lumiverse-border)',
            boxShadow: '0 6px 24px rgba(0, 0, 0, 0.28)',
          }}
        >
          <span aria-hidden="true">♪</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t('listening', { name: session.extensionName })}
          </span>
          <button
            type="button"
            onClick={session.stop}
            style={{
              flex: 'none',
              padding: '4px 12px',
              borderRadius: 999,
              border: 0,
              cursor: 'pointer',
              font: 'inherit',
              fontWeight: 600,
              color: 'var(--lumiverse-primary-contrast, #fff)',
              background: 'var(--lumiverse-primary)',
            }}
          >
            {t('stop')}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
