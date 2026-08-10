let websocket, uuid, actionInfo, context;
const server = document.getElementById("server");
const token = document.getElementById("token");
const character = document.getElementById("character");
const characterFields = document.getElementById("characterFields");
const status = document.getElementById("status");

function send(event, ctx, payload) { websocket.send(JSON.stringify({ event, context: ctx, payload })); }
function saveGlobal() { send("setGlobalSettings", uuid, { serverUrl: server.value.trim(), token: token.value.trim() }); }
function requestCharacters() { status.textContent = "Loading characters…"; send("sendToPlugin", context, { request: "characters" }); }

window.connectElgatoStreamDeckSocket = (port, pluginUUID, registerEvent, info, rawActionInfo) => {
  uuid = pluginUUID;
  actionInfo = JSON.parse(rawActionInfo);
  context = actionInfo.context;
  websocket = new WebSocket(`ws://127.0.0.1:${port}`);
  websocket.onopen = () => {
    websocket.send(JSON.stringify({ event: registerEvent, uuid }));
    send("getGlobalSettings", uuid);
    if (actionInfo.action === "com.lumiverse.streamdeck.opencharacter") {
      characterFields.hidden = false;
      requestCharacters();
    }
  };
  websocket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.event === "didReceiveGlobalSettings") {
      server.value = message.payload.settings.serverUrl || "http://localhost:3000";
      token.value = message.payload.settings.token || "";
    }
    if (message.event === "sendToPropertyInspector") {
      if (message.payload.error) { status.textContent = message.payload.error; return; }
      const selected = actionInfo.payload.settings.characterId || "";
      for (const item of message.payload.characters || []) character.add(new Option(item.name, item.id, false, item.id === selected));
      status.textContent = "";
    }
  };
};

server.addEventListener("change", () => { saveGlobal(); requestCharacters(); });
token.addEventListener("change", () => { saveGlobal(); requestCharacters(); });
character.addEventListener("change", () => {
  const option = character.options[character.selectedIndex];
  send("setSettings", context, { characterId: character.value, characterName: option?.text || "" });
});
