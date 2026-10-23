(() => {
  // Older server frontends use randomUUID directly. UUID generation only needs
  // getRandomValues; leave secure-context APIs and certificate checks untouched.
  if (typeof crypto.randomUUID !== 'function') {
    Object.defineProperty(crypto, 'randomUUID', {configurable: true, value() {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }});
  }
  Object.defineProperty(window, '__LUMIVERSE_MOBILE__', {value: true});
  Object.defineProperty(window, '__LUMIVERSE_PLATFORM__', {value: 'ios'});
  Object.defineProperty(window, '__LUMIVERSE_IOS_NATIVE__', {value: Object.freeze({
    version: 1,
    request(action, payload = {}) {
      const handler = window.webkit?.messageHandlers?.lumiverseNative;
      if (!handler) return Promise.reject(new Error('Update the Lumiverse iOS app to enable native permissions.'));
      return handler.postMessage({action, payload});
    }
  })});
  const mark = () => {
    document.documentElement?.setAttribute('data-tauri-mobile', 'ios');
    document.documentElement?.setAttribute('data-platform', 'ios');
    document.documentElement?.setAttribute('data-ios', '');
    document.documentElement?.removeAttribute('data-tauri-desktop');
  };
  mark();
  document.addEventListener('DOMContentLoaded', mark, {once: true});
})();
