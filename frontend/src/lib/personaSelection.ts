import i18n from '@/i18n'
import { chatsApi } from '@/api/chats'
import { useStore } from '@/store'
import { personaToastName } from '@/store/slices/personas'
import {
  CHAT_PERSONA_METADATA_KEY,
  resolveChatPersonaSelection,
  setPersistedChatPersonaId,
} from '@/lib/chatPersonaSelection'
import { toast } from '@/lib/toast'

const tp = (key: string, options?: Record<string, unknown>) =>
  i18n.t(`personaManager.toast.${key}`, { ns: 'panels', ...options })

/**
 * Make a persona active, or deactivate the current one with `null`. In a saved
 * chat the choice is stored on the chat, so it applies to that chat only.
 */
export function selectPersona(personaId: string | null): void {
  const state = useStore.getState()
  const announce = () => {
    if (personaId === null) {
      toast.info(tp('personaDeactivated'))
      return
    }
    const persona = state.personas.find((p) => p.id === personaId)
    if (persona) toast.info(tp('switchedToPersona', { name: personaToastName(persona) }))
  }

  const isChatScoped = !!state.activeChatId && state.activeChatMetadata?.temporary !== true
  if (!isChatScoped) {
    state.setActivePersona(personaId)
    announce()
    return
  }

  const activeCharacter = state.activeCharacterId
    ? state.characters.find((character) => character.id === state.activeCharacterId) ?? null
    : null
  const previousMetadata = state.activeChatMetadata
  const previousActivePersonaId = state.activePersonaId
  const nextMetadata = setPersistedChatPersonaId(previousMetadata, personaId)
  const fallbackPersonaId = personaId ?? resolveChatPersonaSelection({
    metadata: nextMetadata,
    characterId: state.activeCharacterId,
    characterTags: activeCharacter?.tags ?? [],
    personas: state.personas,
    characterPersonaBindings: state.characterPersonaBindings,
    personaTagBindings: state.personaTagBindings,
  }).personaId

  state.setActiveChatMetadata(nextMetadata)
  state.setActivePersona(fallbackPersonaId)

  chatsApi.patchMetadata(state.activeChatId!, { [CHAT_PERSONA_METADATA_KEY]: personaId }).then(announce).catch((err) => {
    console.error('[PersonaBrowser] Failed to save chat persona selection:', err)
    state.setActiveChatMetadata(previousMetadata)
    state.setActivePersona(previousActivePersonaId)
    toast.error(tp('failedSaveChatPersona'))
  })
}
