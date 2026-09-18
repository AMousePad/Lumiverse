import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  LOCAL_INSTANCE_CONNECTION,
  normalizeRemoteOrigin,
  type InstanceConnection,
} from "./instance-connection";
import { loadSettings } from "./settings";
import "./custom-url.css";

const form = document.querySelector<HTMLFormElement>("#frontend-url-form")!;
const input = document.querySelector<HTMLInputElement>("#frontend-url")!;
const error = document.querySelector<HTMLParagraphElement>("#error")!;
const remoteSettings = document.querySelector<HTMLElement>("#remote-settings")!;
const modeInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="connection-mode"]')];
const cancelButton = document.querySelector<HTMLButtonElement>("#cancel")!;
const saveButton = document.querySelector<HTMLButtonElement>("#save")!;

function selectedMode(): InstanceConnection["mode"] {
  return modeInputs.find((option) => option.checked)?.value === "remote" ? "remote" : "local";
}

function connectionFromForm(): InstanceConnection {
  if (selectedMode() === "local") return LOCAL_INSTANCE_CONNECTION;
  if (!input.value.trim()) throw new Error("Enter the URL of your remote Lumiverse instance.");
  return { mode: "remote", origin: normalizeRemoteOrigin(input.value) };
}

function showError(message: string): void {
  error.textContent = message;
  error.hidden = false;
}

async function save(connection: InstanceConnection): Promise<void> {
  await emit("instance-connection-changed", { connection });
  await getCurrentWindow().close();
}

const settings = await loadSettings();
const currentMode = settings.instanceConnection.mode;
const initialMode = currentMode;
input.value = currentMode === "remote" ? settings.instanceConnection.origin : "";

for (const option of modeInputs) {
  option.checked = option.value === initialMode;
  const container = option.closest<HTMLElement>("[data-connection-option]");
  const badge = container?.querySelector<HTMLElement>(".current-badge");
  if (badge) badge.hidden = option.value !== currentMode;
}

function updateMode(): void {
  const remote = selectedMode() === "remote";
  remoteSettings.toggleAttribute("data-disabled", !remote);
  input.disabled = !remote;
  input.required = remote;
  error.hidden = true;
  if (remote) requestAnimationFrame(() => input.focus());
}

for (const option of modeInputs) option.addEventListener("change", updateMode);
updateMode();

if (initialMode === "remote") input.focus();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.hidden = true;
  saveButton.disabled = true;
  cancelButton.disabled = true;
  try {
    await save(connectionFromForm());
  } catch (reason) {
    showError(reason instanceof Error ? reason.message : "Enter a valid URL.");
    saveButton.disabled = false;
    cancelButton.disabled = false;
    if (selectedMode() === "remote") input.focus();
  }
});

cancelButton.addEventListener("click", () => void getCurrentWindow().close());

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") void getCurrentWindow().close();
});
