const server = document.getElementById('server');
const status = document.getElementById('status');
const controls = [...document.querySelectorAll('button, input')];
const invoke = (action, server) => window.__TAURI_INTERNALS__.invoke('mobile_connection', { action, server: server ?? null });

async function connect(action) {
  controls.forEach(control => { control.disabled = true; });
  status.textContent = action === 'local' ? 'Preparing your local backend…' : 'Connecting to your server…';
  try {
    await invoke(action, server.value);
  } catch (error) {
    status.textContent = typeof error === 'string' ? error : (error?.message || 'Could not connect. Try again.');
  } finally {
    controls.forEach(control => { control.disabled = false; });
  }
}

document.getElementById('local').addEventListener('click', () => { void connect('local'); });
document.getElementById('connection-form').addEventListener('submit', event => {
  event.preventDefault();
  void connect('remote');
});
invoke('info').then(info => {
  server.value = info.server || '';
  if (!new URLSearchParams(location.search).has('changeServer') && info.mode) void connect(info.mode);
}).catch(() => { status.textContent = 'Could not restore your connection. Choose an option to continue.'; });
