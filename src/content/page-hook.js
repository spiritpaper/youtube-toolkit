// Runs in YouTube's own page context (manifest "world": "MAIN") so it can see
// the caption files the video player downloads. YouTube no longer lets other
// code fetch captions directly (they need a token only the player can make),
// so we keep a copy of what the player itself receives and hand it to the
// extension's content script with postMessage. Nothing else is touched.
(() => {
  const SOURCE = 'ytk-timedtext';
  const isCaptions = (url) => typeof url === 'string' && url.includes('/api/timedtext');
  const post = (url, body) => {
    if (typeof body === 'string' && body.length > 20) window.postMessage({ source: SOURCE, url, body }, location.origin);
  };
  const bodyOf = (xhr) => {
    if (xhr.responseType === '' || xhr.responseType === 'text') return xhr.responseText;
    if (xhr.responseType === 'json') return JSON.stringify(xhr.response);
    if (xhr.responseType === 'arraybuffer' && xhr.response) return new TextDecoder().decode(xhr.response);
    return '';
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ytkUrl = String(url);
    return open.call(this, method, url, ...rest);
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (isCaptions(this.__ytkUrl)) {
      this.addEventListener('load', () => {
        try {
          post(new URL(this.__ytkUrl, location.origin).href, bodyOf(this));
        } catch {}
      });
    }
    return send.apply(this, args);
  };

  const fetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await fetch.call(this, input, init);
    try {
      const url = typeof input === 'string' ? input : input?.url;
      if (isCaptions(url)) res.clone().text().then((t) => post(new URL(url, location.origin).href, t), () => {});
    } catch {}
    return res;
  };
})();
