import { useEffect } from 'react'
import { changeUiLanguage } from '@/i18n'
import { useStore } from '@/store'

/** Apply account settings after hydration and SETTINGS_UPDATED reloads. */
export function useUiLanguage() {
  const userId = useStore(s => s.isAuthenticated ? s.user?.id : null)
  const language = useStore(s => s.uiLanguage)

  useEffect(() => {
    if (!userId || !language) return
    let cancelled = false
    const isCurrent = () => {
      const state = useStore.getState()
      return !cancelled && state.isAuthenticated && state.user?.id === userId
        && state.uiLanguage === language
    }
    // Applying a server value must never persist the device's detected language.
    void changeUiLanguage(language, isCurrent).catch(error => {
      if (isCurrent()) console.error('[i18n] Failed to apply account language:', error)
    })
    return () => { cancelled = true }
  }, [userId, language])
}
