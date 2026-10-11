import i18n from '@/i18n'
import { useStore } from '@/store'
import { generateUUID } from '@/lib/uuid'
import { createFrontendSystemAudioAPI, type FrontendSystemAudioDependencies } from './system-audio-api'
import { getSystemAudioSource } from './system-audio-source'

/**
 * The consent prompt reuses the host's own confirmation dialog, which names the extension in its title. Every word
 * of the body comes from the host's locale files: an extension cannot influence what the user is asked.
 */
function confirmWithHost(extensionId: string, extensionName: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  const requestId = generateUUID()
  return new Promise<boolean>((resolve) => {
    let settled = false
    const done = (confirmed: boolean) => {
      if (settled) return
      settled = true
      window.removeEventListener('spindle:confirm-resolved', onResolved)
      signal.removeEventListener('abort', onAbort)
      resolve(confirmed)
    }
    const onResolved = ((event: CustomEvent) => {
      if (event.detail?.requestId === requestId) done(Boolean(event.detail.confirmed))
    }) as EventListener
    const onAbort = () => {
      const pending = useStore.getState().pendingConfirm
      if (pending?.requestId === requestId) useStore.setState({ pendingConfirm: null })
      done(false)
    }
    window.addEventListener('spindle:confirm-resolved', onResolved)
    signal.addEventListener('abort', onAbort, { once: true })
    useStore.getState().openSpindleConfirm({
      requestId,
      extensionId,
      extensionName,
      title: i18n.t('shared:spindle.systemAudio.consentTitle'),
      message: i18n.t('shared:spindle.systemAudio.consentMessage'),
      variant: 'warning',
      confirmLabel: i18n.t('shared:spindle.systemAudio.allow'),
      cancelLabel: i18n.t('shared:spindle.systemAudio.notNow'),
    })
  })
}

export function createNativeSystemAudioAPI(
  deps: Pick<FrontendSystemAudioDependencies, 'assertActive' | 'requirePermission' | 'onTeardown'> & {
    extensionId: string
    extensionName: string
  },
) {
  const { extensionId, extensionName, ...rest } = deps
  return createFrontendSystemAudioAPI({
    ...rest,
    getSource: getSystemAudioSource,
    requestConsent: (signal) => confirmWithHost(extensionId, extensionName, signal),
    showIndicator(stop) {
      const id = generateUUID()
      useStore.getState().addSystemAudioSession({ id, extensionId, extensionName, stop })
      return () => useStore.getState().removeSystemAudioSession(id)
    },
  })
}
