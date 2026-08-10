import streamDeck from "@elgato/streamdeck";

export type GlobalSettings = { serverUrl?: string; token?: string };
export type CharacterSummary = { id: string; name: string; image_id: string | null; image_url: string | null };

type CharacterPage = {
  data: CharacterSummary[];
  total: number;
  limit?: number;
  offset?: number;
};

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
  const characters: CharacterSummary[] = [];
  const pageSize = 500;
  while (true) {
    const page = await request<CharacterPage>(
      `/api/integrations/stream-deck/v1/characters?limit=${pageSize}&offset=${characters.length}`,
    );
    characters.push(...page.data);
    // Older Lumiverse servers returned a single fixed-size page and omitted
    // pagination metadata. Stop after that response instead of repeatedly
    // requesting an offset the server does not understand.
    if (page.limit === undefined || characters.length >= page.total || page.data.length === 0) return characters;
  }
}

const imageCache = new Map<string, string>();

export async function getCharacterImage(imageUrl: string): Promise<string> {
  const cached = imageCache.get(imageUrl);
  if (cached) return cached;

  const settings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
  if (!settings.token) throw new Error("Configure a Lumiverse integration token");
  const response = await fetch(`${normalizeServerUrl(settings.serverUrl)}${imageUrl}`, {
    headers: { Authorization: `Bearer ${settings.token}` },
  });
  if (!response.ok) throw new Error(`Lumiverse image returned ${response.status}`);
  const contentType = response.headers.get("content-type") || "image/webp";
  const dataUrl = `data:${contentType};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
  imageCache.set(imageUrl, dataUrl);
  return dataUrl;
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
