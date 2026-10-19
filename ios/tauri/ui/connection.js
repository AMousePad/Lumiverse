const form = document.getElementById('connection-form');
const server = document.getElementById('server');
const button = document.getElementById('connect');
const status = document.getElementById('status');
const setup = document.getElementById('connection-setup');
const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args);

function showSetup(message = '') {
  setup.hidden = false;
  status.textContent = message;
  button.disabled = false;
  server.disabled = false;
}

async function connect(restore = false) {
  button.disabled = true;
  server.disabled = true;
  // Saved-server startup stays blank. An explicit connection keeps its form
  // in place so a short network round trip cannot flash a separate screen.
  setup.hidden = restore;
  status.textContent = restore ? '' : 'Connecting to your server…';
  try {
    await invoke('mobile_connect', {server: server.value, restore});
  } catch (error) {
    showSetup(typeof error === 'string' ? error : (error?.message || 'Could not connect. Check the server address and try again.'));
  }
}

form.addEventListener('submit', event => { event.preventDefault(); void connect(); });
invoke('mobile_connection_info').then(info => {
  if (info.server) {
    server.value = info.server;
    if (!new URLSearchParams(location.search).has('changeServer')) void connect(true);
    else showSetup();
  } else {
    showSetup();
  }
}).catch(() => { showSetup('Could not restore the saved server address. Enter it again to connect.'); });
