import streamDeck, {
  action,
  type DidReceiveSettingsEvent,
  type KeyAction,
  SingletonAction,
  type KeyDownEvent,
  type SendToPluginEvent,
  type WillAppearEvent,
} from "@elgato/streamdeck";
import { getCharacterImage, listCharacters, openChat } from "./api.js";

type CharacterSettings = { characterId?: string; characterName?: string; characterImageUrl?: string };

async function applyCharacterAppearance(
  action: KeyAction<CharacterSettings>,
  settings: CharacterSettings,
): Promise<void> {
  if (settings.characterImageUrl) {
    try {
      streamDeck.logger.info("Loading selected character artwork");
      const image = await getCharacterImage(settings.characterImageUrl);
      streamDeck.logger.info(`Applying character artwork (${image.length} characters)`);
      await action.setImage(image);
      await action.setTitle("");
      streamDeck.logger.info("Character artwork command sent");
      return;
    } catch (error) {
      streamDeck.logger.error(`Failed to load character image: ${String(error)}`);
      await action.showAlert();
      return;
    }
  }
  await action.setImage();
  await action.setTitle(settings.characterName || "Choose\ncharacter");
}

@action({ UUID: "com.lumiverse.streamdeck.openrecent" })
class OpenRecentChat extends SingletonAction {
  override async onKeyDown(event: KeyDownEvent): Promise<void> {
    try {
      if (!await openChat()) await event.action.showAlert();
    } catch (error) {
      streamDeck.logger.error(String(error));
      await event.action.showAlert();
    }
  }
}

@action({ UUID: "com.lumiverse.streamdeck.opencharacter" })
class OpenCharacterChat extends SingletonAction<CharacterSettings> {
  override async onWillAppear(event: WillAppearEvent<CharacterSettings>): Promise<void> {
    if (!event.action.isKey()) return;
    await applyCharacterAppearance(event.action, event.payload.settings);
  }

  override async onDidReceiveSettings(event: DidReceiveSettingsEvent<CharacterSettings>): Promise<void> {
    if (!event.action.isKey()) return;
    await applyCharacterAppearance(event.action, event.payload.settings);
  }

  override async onKeyDown(event: KeyDownEvent<CharacterSettings>): Promise<void> {
    try {
      if (event.action.isKey()) await applyCharacterAppearance(event.action, event.payload.settings);
      const { characterId } = event.payload.settings;
      if (!characterId || !await openChat(characterId)) await event.action.showAlert();
    } catch (error) {
      streamDeck.logger.error(String(error));
      await event.action.showAlert();
    }
  }

  override async onSendToPlugin(event: SendToPluginEvent<{
    request?: string;
    settings?: CharacterSettings;
  }, CharacterSettings>): Promise<void> {
    if (event.payload.request === "selectCharacter" && event.payload.settings) {
      await event.action.setSettings(event.payload.settings);
      if (event.action.isKey()) await applyCharacterAppearance(event.action, event.payload.settings);
      return;
    }
    if (event.payload.request !== "characters") return;
    try {
      await streamDeck.ui.sendToPropertyInspector({ characters: await listCharacters() });
    } catch (error) {
      await streamDeck.ui.sendToPropertyInspector({ error: String(error) });
    }
  }
}

streamDeck.actions.registerAction(new OpenRecentChat());
streamDeck.actions.registerAction(new OpenCharacterChat());
streamDeck.connect();
