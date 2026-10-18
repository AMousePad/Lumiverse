import { useStore } from '@/store'
import {
  getPlaybackSession, isSpeaking, isTTSPlaybackActive, stop, stopAllTTSPlayback, subscribeTTSPlayback,
} from '../ttsAudio'
import { playSavedMessageAudio, startMessageTtsPlayback, startTextTtsPlayback } from '../ttsMessagePlayback'
import { resolveTtsConnectionId } from '../voiceResolution'
import { createFrontendTTSAPI, type FrontendTTSDependencies } from './tts-api'

const done = Promise.resolve()

export function createNativeTTSAPI(deps: Pick<FrontendTTSDependencies, 'assertActive' | 'requirePermission' | 'onTeardown'>) {
  const start: FrontendTTSDependencies['start'] = (input, options) => {
    const state = useStore.getState()
    if (!state.voiceSettings.ttsEnabled) throw new Error('TTS_UNAVAILABLE:disabled')
    if ('messageId' in input) {
      const message = state.messages.find((candidate) => candidate.id === input.messageId)
      if (!message) throw new Error('TTS_MESSAGE_NOT_FOUND: the message is not in the active chat')
      // Same choice as the message's Play button: saved audio first, else the voice pipeline.
      const attachments = Array.isArray(message.extra?.attachments) ? message.extra.attachments : []
      const saved = attachments.find((attachment) => attachment?.type === 'audio'
        && (attachment.swipe_id === undefined || attachment.swipe_id === message.swipe_id))
      if (saved?.image_id) playSavedMessageAudio(message.id, saved.image_id)
      else if (!startMessageTtsPlayback({
        messageId: message.id, messageName: message.name, messageContent: message.content, messageIsUser: message.is_user,
      })) throw new Error('TTS_NOTHING_TO_SPEAK: no voice or no speakable text for this message')
      return { session: getPlaybackSession(), synthesized: done, cancel() {} }
    }
    const connectionId = options.connectionId ?? resolveTtsConnectionId(state.voiceSettings, state.ttsProfiles)
    if (!connectionId) throw new Error('TTS_UNAVAILABLE:connectionRequired')
    if (!state.ttsProfiles.some((profile) => profile.id === connectionId)) throw new Error('TTS_CONNECTION_NOT_FOUND')
    const controller = new AbortController()
    const synthesized = startTextTtsPlayback({ text: input.text, connectionId, signal: controller.signal })
    return { session: getPlaybackSession(), synthesized, cancel: () => controller.abort() }
  }
  return createFrontendTTSAPI({
    ...deps,
    start,
    isSpeaking: isTTSPlaybackActive,
    isEngineSpeaking: isSpeaking,
    getSession: getPlaybackSession,
    subscribe: subscribeTTSPlayback,
    stopEngine: stop,
    stopAll: stopAllTTSPlayback,
  })
}
