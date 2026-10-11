import type { TtsProvider } from "../provider";
import type { TtsProviderCapabilities } from "../param-schema";
import type { TtsRequest, TtsResponse, TtsStreamChunk, TtsVoice } from "../types";
import { ProviderRequestError, throwProviderResponseError } from "../../utils/provider-errors";

export const FISH_AUDIO_MODELS: Array<{ id: string; label: string }> = [
  { id: "s2.1-pro", label: "Fish S2.1 Pro (Recommended)" },
  { id: "s2.1-pro-free", label: "Fish S2.1 Pro Free (Zero-cost tier)" },
  { id: "s2-pro", label: "Fish S2 Pro" },
  { id: "s1", label: "Fish S1" },
  { id: "drama-3-preview", label: "Drama 3 (Preview)" },
];

export const FISH_AUDIO_PARAMETERS = {
  format: {
    type: "select" as const,
    default: "mp3",
    description: "Audio output format (mp3, wav, pcm, opus)",
    options: [
      { id: "mp3", label: "MP3" },
      { id: "wav", label: "WAV" },
      { id: "opus", label: "Opus" },
      { id: "pcm", label: "PCM" },
    ],
  },
  mp3_bitrate: {
    type: "select" as const,
    default: "128",
    description: "MP3 bitrate (kbps) — only applies when format is mp3",
    options: [
      { id: "64", label: "64 kbps" },
      { id: "128", label: "128 kbps" },
      { id: "192", label: "192 kbps" },
    ],
    group: "advanced",
  },
  latency: {
    type: "select" as const,
    default: "normal",
    description: "Latency trade-off (normal for quality, balanced for lower latency)",
    options: [
      { id: "normal", label: "Normal (Higher quality)" },
      { id: "balanced", label: "Balanced (Lower latency)" },
    ],
    group: "advanced",
  },
  speed: {
    type: "number" as const,
    default: 1.0,
    min: 0.5,
    max: 2.0,
    step: 0.05,
    description: "Playback speed (0.5x – 2.0x)",
    group: "advanced",
  },
  volume: {
    type: "number" as const,
    default: 0,
    min: -10,
    max: 10,
    step: 0.5,
    description: "Volume adjustment in dB (-10 to +10 dB, default 0)",
    group: "advanced",
  },
  temperature: {
    type: "number" as const,
    default: 0.7,
    min: 0,
    max: 1,
    step: 0.05,
    description: "Generation temperature (higher = more variance)",
    group: "advanced",
  },
  top_p: {
    type: "number" as const,
    default: 0.7,
    min: 0,
    max: 1,
    step: 0.05,
    description: "Top-p sampling probability threshold",
    group: "advanced",
  },
  chunk_length: {
    type: "integer" as const,
    default: 300,
    min: 100,
    max: 300,
    step: 10,
    description: "Text chunk segment length (100–300)",
    group: "advanced",
  },
  normalize: {
    type: "boolean" as const,
    default: true,
    description: "Normalize text before synthesis (numbers to words, etc.)",
    group: "advanced",
  },
};

export function buildFishAudioBody(request: TtsRequest): Record<string, any> {
  const p = request.parameters || {};
  const format = request.outputFormat || p.format || "mp3";
  const body: Record<string, any> = {
    text: request.text,
    format,
  };
  if (request.voice && request.voice.trim()) {
    body.reference_id = request.voice.trim();
  }
  if (format === "mp3" && p.mp3_bitrate) {
    body.mp3_bitrate = Number(p.mp3_bitrate);
  }
  if (p.latency) {
    body.latency = p.latency;
  }
  if (p.chunk_length != null) {
    body.chunk_length = Number(p.chunk_length);
  }
  if (p.normalize != null) {
    body.normalize = Boolean(p.normalize);
  }
  if (p.temperature != null) {
    body.temperature = Number(p.temperature);
  }
  if (p.top_p != null) {
    body.top_p = Number(p.top_p);
  }
  const speed = p.speed != null ? Number(p.speed) : 1.0;
  const volume = p.volume != null ? Number(p.volume) : 0;
  if (speed !== 1.0 || volume !== 0) {
    body.prosody = { speed, volume };
  }
  return body;
}

export class FishAudioTtsProvider implements TtsProvider {
  readonly name = "fish_audio";
  readonly displayName = "Fish Audio";

  readonly capabilities: TtsProviderCapabilities = {
    parameters: { ...FISH_AUDIO_PARAMETERS },
    apiKeyRequired: true,
    voiceListStyle: "dynamic",
    staticVoices: [],
    modelListStyle: "static",
    staticModels: FISH_AUDIO_MODELS,
    supportsStreaming: true,
    supportedFormats: ["mp3", "wav", "pcm", "opus"],
    defaultUrl: "https://api.fish.audio",
    defaultFormat: "mp3",
  };

  private baseUrl(apiUrl: string): string {
    return (apiUrl || this.capabilities.defaultUrl).replace(/\/+$/, "");
  }

  private headers(apiKey: string, model?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (model && model.trim()) {
      headers.model = model.trim();
    }
    return headers;
  }

  private contentTypeForFormat(format: string): string {
    switch (format) {
      case "wav":
        return "audio/wav";
      case "opus":
        return "audio/opus";
      case "pcm":
        return "audio/pcm";
      case "mp3":
      default:
        return "audio/mpeg";
    }
  }

  async synthesize(apiKey: string, apiUrl: string, request: TtsRequest): Promise<TtsResponse> {
    if (!apiKey) {
      throw new ProviderRequestError({
        provider: this.displayName,
        operation: "tts synthesize",
        detail: "Missing Fish Audio API key",
        retryable: false,
      });
    }

    const body = buildFishAudioBody(request);
    const model = request.model || "s2.1-pro";

    const res = await fetch(`${this.baseUrl(apiUrl)}/v1/tts`, {
      method: "POST",
      headers: this.headers(apiKey, model),
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!res.ok) await throwProviderResponseError(this.displayName, "tts synthesize", res);

    const audioData = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || this.contentTypeForFormat(body.format || "mp3");

    return {
      audioData,
      contentType,
      model,
      provider: this.name,
    };
  }

  async *synthesizeStream(
    apiKey: string,
    apiUrl: string,
    request: TtsRequest,
  ): AsyncGenerator<TtsStreamChunk, void, unknown> {
    if (!apiKey) {
      throw new ProviderRequestError({
        provider: this.displayName,
        operation: "tts stream",
        detail: "Missing Fish Audio API key",
        retryable: false,
      });
    }

    const body = buildFishAudioBody(request);
    const model = request.model || "s2.1-pro";

    const res = await fetch(`${this.baseUrl(apiUrl)}/v1/tts`, {
      method: "POST",
      headers: this.headers(apiKey, model),
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!res.ok) await throwProviderResponseError(this.displayName, "tts stream", res);

    if (!res.body) {
      throw new Error("Fish Audio: no response body for streaming");
    }

    const mimeType = res.headers.get("content-type") || this.contentTypeForFormat(body.format || "mp3");
    const reader = res.body.getReader();
    try {
      while (true) {
        if (request.signal?.aborted) return;
        const { done, value } = await reader.read();
        if (done) {
          yield { data: new Uint8Array(0), done: true, kind: "bytes", mimeType };
          break;
        }
        yield { data: value, done: false, kind: "bytes", mimeType };
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  async validateKey(apiKey: string, apiUrl: string): Promise<boolean> {
    if (!apiKey) {
      throw new ProviderRequestError({
        provider: this.displayName,
        operation: "authentication",
        detail: "Missing Fish Audio API key",
        retryable: false,
      });
    }

    try {
      const res = await fetch(`${this.baseUrl(apiUrl)}/model?page_size=1`, {
        headers: this.headers(apiKey),
      });
      if (!res.ok) await throwProviderResponseError(this.displayName, "authentication", res);
      return res.ok;
    } catch (err) {
      if (err instanceof ProviderRequestError) throw err;
      throw new ProviderRequestError({
        provider: this.displayName,
        operation: "authentication",
        detail: err instanceof Error ? err.message : "network request failed",
        retryable: true,
      });
    }
  }

  async listModels(_apiKey: string, _apiUrl: string): Promise<Array<{ id: string; label: string }>> {
    return this.capabilities.staticModels || [];
  }

  async listVoices(apiKey: string, apiUrl: string): Promise<TtsVoice[]> {
    if (!apiKey) return this.capabilities.staticVoices || [];

    try {
      // Query user's own models first (self=true)
      let res = await fetch(`${this.baseUrl(apiUrl)}/model?self=true&page_size=100`, {
        headers: this.headers(apiKey),
      });
      let data = res.ok ? await res.json() : null;
      let items: any[] = data?.items || [];

      // If user has no models of their own, fall back to public/library models
      if (items.length === 0) {
        res = await fetch(`${this.baseUrl(apiUrl)}/model?page_size=100`, {
          headers: this.headers(apiKey),
        });
        data = res.ok ? await res.json() : null;
        items = data?.items || [];
      }

      const voices: TtsVoice[] = [];
      for (const item of items) {
        const id = item._id || item.id;
        if (!id) continue;
        voices.push({
          id,
          name: item.title || item.name || id,
          description: item.description || undefined,
          language: Array.isArray(item.languages) && item.languages[0] ? item.languages[0] : undefined,
        });
      }
      return voices.length > 0 ? voices : (this.capabilities.staticVoices || []);
    } catch {
      return this.capabilities.staticVoices || [];
    }
  }
}
