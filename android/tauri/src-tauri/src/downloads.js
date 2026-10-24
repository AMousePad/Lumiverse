// Installed before application scripts, including when connected to a remote server.
(() => {
  if (window !== window.top || !window.lumiverseDownloads || window.__LUMIVERSE_DOWNLOADS_INSTALLED__) return;
  window.__LUMIVERSE_DOWNLOADS_INSTALLED__ = true;
  const bridge = window.lumiverseDownloads;
  const pending = new Map();
  // Keep the original Blob while its URL is alive. Reading our own generated
  // exports must not depend on connect-src allowing blob: or a second fetch.
  const blobs = new Map();
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = function (value) {
    const url = createObjectURL.call(this, value);
    if (value instanceof Blob) blobs.set(url, value);
    return url;
  };
  URL.revokeObjectURL = function (url) {
    blobs.delete(String(url));
    return revokeObjectURL.call(this, url);
  };
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
    let stage = 'read the generated export';
    try {
      // Capture the Blob synchronously before callers revoke its URL. URLs not
      // created in this frame (including data:) retain the existing fallback.
      let blob = blobs.get(url);
      if (!blob) {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Could not read the export.');
        blob = await response.blob();
      }
      stage = 'create the file in Downloads/Lumiverse';
      transfer = await request('begin', { filename, mimeType: blob.type, size: blob.size });
      stage = 'write the export';
      for (let offset = 0; offset < blob.size; offset += 49152) {
        const part = blob.slice(offset, offset + 49152);
        // FileReader also supports older Android WebViews without Blob.arrayBuffer.
        const buffer = typeof part.arrayBuffer === 'function' ? await part.arrayBuffer() : await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error('Could not read an export chunk.'));
          reader.readAsArrayBuffer(part);
        });
        const bytes = new Uint8Array(buffer);
        // Never create a whole-file base64 string or exceed argument-stack limits.
        let binary = '';
        for (let index = 0; index < bytes.length; index += 8192)
          binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
        await request('chunk', { transfer, offset, data: btoa(binary) });
      }
      stage = 'finish saving the export';
      await request('finish', { transfer });
    } catch (error) {
      const message = `Could not ${stage}. ${error?.message || ''}`.trim();
      console.error('[Lumiverse export]', message);
      await request('abort', { transfer, message }).catch(() => {});
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
