// Runs first in every page and iframe inside the app. Gives the userscript the same
// GM_* functions Violentmonkey has, and a way to ask the app for a real finger tap.
(function () {
  if (typeof RuhulBridge === 'undefined' || window.__ruhulBridgeReady) return;
  window.__ruhulBridgeReady = true;

  window.GM_getValue = function (k, d) {
    var v = RuhulBridge.getValue(String(k));
    return (v === null || v === undefined) ? d : v;
  };
  window.GM_setValue = function (k, v) { RuhulBridge.setValue(String(k), String(v)); };
  window.GM_xmlhttpRequest = function (o) {
    setTimeout(function () {
      var r;
      try { r = String(RuhulBridge.httpGet(o.url)); } catch (e) { r = 'ERR:' + e; }
      if (r.indexOf('ERR:') === 0) { if (o.onerror) o.onerror({ error: r }); return; }
      var i = r.indexOf('\n');
      if (o.onload) o.onload({ status: parseInt(r.slice(0, i), 10), responseText: r.slice(i + 1) });
    }, 0);
  };

  // x, y are CSS pixels inside this frame's viewport. Each frame adds its iframe's offset
  // and passes the request up; the top page converts to screen pixels and asks the app.
  window.__ruhulTap = function (x, y) {
    if (window === window.top) {
      var vv = window.visualViewport;
      var ox = vv ? vv.offsetLeft : 0, oy = vv ? vv.offsetTop : 0, w = vv ? vv.width : window.innerWidth;
      RuhulBridge.tap(x - ox, y - oy, w);
    } else {
      window.parent.postMessage({ __ruhulTap: 1, x: x, y: y }, '*');
    }
  };
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__ruhulTap !== 1 || typeof d.x !== 'number' || typeof d.y !== 'number') return;
    var fr = document.querySelectorAll('iframe,frame');
    for (var i = 0; i < fr.length; i++) {
      if (fr[i].contentWindow === e.source) {
        var r = fr[i].getBoundingClientRect(), cs = getComputedStyle(fr[i]);
        window.__ruhulTap(
          d.x + r.left + fr[i].clientLeft + (parseFloat(cs.paddingLeft) || 0),
          d.y + r.top + fr[i].clientTop + (parseFloat(cs.paddingTop) || 0));
        return;
      }
    }
  });
})();
