import streamDeck, {
  action,
  type DidReceiveSettingsEvent,
  SingletonAction,
  type KeyDownEvent,
  type SendToPluginEvent,
  type WillAppearEvent,
} from "@elgato/streamdeck";
import { listCharacters, openChat } from "./api.js";

type CharacterSettings = { characterId?: string; characterName?: string };

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
    await event.action.setTitle(event.payload.settings.characterName || "Choose\ncharacter");
  }

  override async onDidReceiveSettings(event: DidReceiveSettingsEvent<CharacterSettings>): Promise<void> {
    await event.action.setTitle(event.payload.settings.characterName || "Choose\ncharacter");
  }

  override async onKeyDown(event: KeyDownEvent<CharacterSettings>): Promise<void> {
    try {
      const { characterId } = event.payload.settings;
      if (!characterId || !await openChat(characterId)) await event.action.showAlert();
    } catch (error) {
      streamDeck.logger.error(String(error));
      await event.action.showAlert();
    }
  }

  override async onSendToPlugin(event: SendToPluginEvent<{ request?: string }, CharacterSettings>): Promise<void> {
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
