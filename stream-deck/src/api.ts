import streamDeck from "@elgato/streamdeck";

export type GlobalSettings = { serverUrl?: string; token?: string };
export type CharacterSummary = { id: string; name: string; image_id: string | null };

function normalizeServerUrl(value: string | undefined): string {
  return (value?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}

async function request<T>(path: string): Promise<T> {
  const settings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
  if (!settings.token) throw new Error("Configure a Lumiverse integration token");
  const response = await fetch(`${normalizeServerUrl(settings.serverUrl)}${path}`, {
    headers: { Authorization: `Bearer ${settings.token}` },
  });
  if (!response.ok) throw new Error(response.status === 401 ? "Lumiverse token was rejected" : `Lumiverse returned ${response.status}`);
  return response.json() as Promise<T>;
}

export async function listCharacters(): Promise<CharacterSummary[]> {
  return (await request<{ data: CharacterSummary[] }>("/api/integrations/stream-deck/v1/characters")).data;
}

export async function getRecentChat(characterId?: string): Promise<{ id: string } | null> {
  const query = characterId ? `?characterId=${encodeURIComponent(characterId)}` : "";
  return (await request<{ chat: { id: string } | null }>(`/api/integrations/stream-deck/v1/recent-chat${query}`)).chat;
}

export async function openChat(characterId?: string): Promise<boolean> {
  const chat = await getRecentChat(characterId);
  if (!chat) return false;
  const settings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
  await streamDeck.system.openUrl(`${normalizeServerUrl(settings.serverUrl)}/chat/${encodeURIComponent(chat.id)}`);
  return true;
}
