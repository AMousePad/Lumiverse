// Installed before application scripts, including when connected to a remote server.
(() => {
  if (window !== window.top || !window.lumiverseDownloads || window.__LUMIVERSE_DOWNLOADS_INSTALLED__) return;
  window.__LUMIVERSE_DOWNLOADS_INSTALLED__ = true;
  const bridge = window.lumiverseDownloads;
  const pending = new Map();
  let sequence = 0;
  bridge.onmessage = event => {
    try {
      const reply = JSON.parse(event.data);
      const request = pending.get(reply.id);
      if (!request) return;
      pending.delete(reply.id);
      clearTimeout(request.timer);
      if (reply.error) request.reject(new Error(reply.error));
      else request.resolve(reply.result);
    } catch { /* Ignore messages that are not download replies. */ }
  };
  function request(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = String(++sequence);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Export request timed out.'));
      }, 120000);
      pending.set(id, { resolve, reject, timer });
      try { bridge.postMessage(JSON.stringify({ id, action, payload })); }
      catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  async function saveBlob(url, filename) {
    let transfer;
    try {
      // Acquire the URL immediately: callers commonly revoke it right after click().
      const response = await fetch(url);
      if (!response.ok) throw new Error('Could not read the export.');
      const blob = await response.blob();
      transfer = await request('begin', { filename, mimeType: blob.type, size: blob.size });
      for (let offset = 0; offset < blob.size; offset += 49152) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + 49152).arrayBuffer());
        // Never create a whole-file base64 string or exceed argument-stack limits.
        let binary = '';
        for (let index = 0; index < bytes.length; index += 8192)
          binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
        await request('chunk', { transfer, offset, data: btoa(binary) });
      }
      await request('finish', { transfer });
    } catch (error) {
      await request('abort', { transfer, message: error.message || 'Could not save the export.' }).catch(() => {});
    }
  }
  function download(anchor) {
    if (!anchor.hasAttribute('download')) return false;
    const url = anchor.href;
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      void saveBlob(url, anchor.download);
      return true;
    }
    // Other websites keep their normal navigation policy and gain no bridge access.
    if (new URL(url, location.href).origin !== location.origin) return false;
    if (!/^https?:/i.test(url)) return false;
    void request('url', { url, filename: anchor.download }).catch(error => {
      void request('abort', { message: error.message }).catch(() => {});
    });
    return true;
  }
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const anchor = event.composedPath().find(node => node instanceof HTMLAnchorElement);
    if (anchor && download(anchor)) event.preventDefault();
  }, true);
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    // Detached anchors do not bubble to document (several export callers use them).
    if (!this.isConnected && download(this)) return;
    return originalClick.call(this);
  };
})();
