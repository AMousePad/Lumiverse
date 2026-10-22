import { useEffect, useState } from 'react'
import { charactersApi } from '@/api/characters'
import { useStore } from '@/store'
import type { Character, Message } from '@/types/api'
import {
  getGreetingMessageCharacterId,
  getGreetingMessageImage,
  removeGreetingImageMarkup,
} from '@/lib/greetingImage'
import { getGreetingTitle } from '@/lib/greetingMetadata'

/** Resolve opening art without fetching characters for ordinary messages. */
export function useGreetingMessageImage(message: Message, content: string, visible = true) {
  const optedIn = useStore((s) => s.showGreetingImage)
  const position = useStore((s) => s.greetingImagePosition === 'bottom' ? 'bottom' : 'top')
  const enabled = optedIn && visible && !message.is_user && message.index_in_chat === 0
  const characterId = useStore((s) => enabled
    ? getGreetingMessageCharacterId(message, s.activeCharacterId)
    : null)
  const cachedCharacter = useStore((s) => characterId
    ? s.characters.find((character) => character.id === characterId)
    : undefined)
  const metadata = useStore((s) => enabled && s.activeChatId === message.chat_id
    ? s.activeChatMetadata
    : null)
  const [fetchedCharacter, setFetchedCharacter] = useState<Character | null>(null)

  useEffect(() => {
    if (!characterId || cachedCharacter) return
    let cancelled = false
    charactersApi.get(characterId).then((character) => {
      if (!cancelled) setFetchedCharacter(character)
    }).catch(() => {
      if (!cancelled) setFetchedCharacter(null)
    })
    return () => { cancelled = true }
  }, [characterId, cachedCharacter])

  // A previous request can finish around a chat switch; never reuse another
  // speaker's art while the next character is being fetched.
  const character = cachedCharacter
    ?? (fetchedCharacter?.id === characterId ? fetchedCharacter : null)
  const image = enabled && character ? getGreetingMessageImage(character, message, metadata) : null
  const title = image && character ? getGreetingTitle(character.extensions, image.greetingIndex) : null

  return {
    image: image ? { ...image, alt: title ? `${title} — ${character!.name}` : character!.name } : null,
    position,
    // Keep authored content intact for prompts, editing, search and copying.
    content: image?.embeddedSource ? removeGreetingImageMarkup(content, image.embeddedSource) : content,
  }
}
