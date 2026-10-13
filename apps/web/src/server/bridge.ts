// The script `/raw` puts first in every doc's <head> (spec section 12, "the frame"). It runs in the
// sandbox's opaque origin, so it can only post messages to the app, which checks where they came from.
// Plain ES5-style JS in a string: it is served as is, never bundled.
const script = String.raw`(function () {
  var mem = function () {
    var data = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; },
      clear: function () { data = {}; },
      key: function (i) { return Object.keys(data)[i] || null; },
      get length() { return Object.keys(data).length; }
    };
  };
  // The sandbox blocks storage, and a doc that reads it unguarded throws. Values last one page view.
  ["localStorage", "sessionStorage"].forEach(function (name) {
    try { window[name].getItem("atlas"); } catch (e) {
      try { Object.defineProperty(window, name, { value: mem(), configurable: true }); } catch (e2) {}
    }
  });

  var framed = window.parent !== window;
  var parts = location.pathname.split("/");
  var repo = decodeURIComponent(parts[2] || "");
  var params = new URLSearchParams(location.search);
  var post = function (msg) { if (framed) window.parent.postMessage(msg, location.origin); };

  var dark = null;
  var theme = function (value) {
    dark = value === "dark";
    [document.documentElement, document.body].forEach(function (el) {
      if (el) el.classList.toggle("dark", dark);
    });
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  };
  if (framed && params.get("theme")) {
    theme(params.get("theme"));
    // Again as soon as <body> exists, before anything in it can be clicked.
    var watch = new MutationObserver(function () {
      if (!document.body) return;
      watch.disconnect();
      if (!ownTheme()) theme(dark ? "dark" : "light");
    });
    watch.observe(document.documentElement, { childList: true });
  }
  // A doc that keeps the contract follows atlas:theme itself; for the rest the bridge sets the class.
  var ownTheme = function () { return !!document.querySelector('meta[name="atlas-contract"]'); };

  if (framed) {
    var style = document.createElement("style");
    style.textContent = "[data-atlas-chrome]{display:none!important}" +
      ".atlas-zoom{position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.88);cursor:grab;overflow:hidden;touch-action:none}" +
      ".atlas-zoom>div{position:absolute;left:50%;top:50%;transform-origin:0 0;background:#fff;padding:16px;border-radius:8px}" +
      ".atlas-zoom svg,.atlas-zoom img{display:block;max-width:none}" +
      "figure[data-atlas-diagram],figure.diagram{cursor:zoom-in}";
    document.documentElement.appendChild(style);
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data || e.data.type !== "atlas:theme") return;
    if (ownTheme()) return;
    theme(e.data.theme);
  });

  var docPath = function (url) {
    if (url.host !== location.host || url.pathname.indexOf("/raw/") !== 0) return null;
    return url.pathname.slice(4);
  };
  var isHome = function (a, url) {
    return a.hasAttribute("data-atlas-home") || (url.host === location.host && /\/index\.html$/.test(url.pathname));
  };

  document.addEventListener("click", function (e) {
    if (!framed || e.defaultPrevented || e.button !== 0) return;
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var url;
    try { url = new URL(a.getAttribute("href"), location.href); } catch (err) { return; }
    if (!/^https?:$/.test(url.protocol)) return;
    var here = url.pathname === location.pathname && url.search === location.search;
    if (here && url.hash) return;
    e.preventDefault();
    var tab = e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank";
    if (isHome(a, url)) return post({ type: "atlas:navigate", href: "/docs?repo=" + encodeURIComponent(repo), tab: tab });
    var path = docPath(url);
    if (path) return post({ type: "atlas:navigate", href: "/r" + path + url.hash, tab: tab });
    if (url.host === location.host) return post({ type: "atlas:navigate", href: url.pathname + url.search + url.hash, tab: tab });
    window.open(url.href, "_blank", "noopener");
  }, true);

  window.addEventListener("keydown", function (e) {
    if (!framed || e.isComposing) return;
    var t = e.target;
    var typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      post({ type: "atlas:key", key: "mod+k" });
    } else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing) {
      e.preventDefault();
      post({ type: "atlas:key", key: "/" });
    }
  }, true);

  window.addEventListener("hashchange", function () { post({ type: "atlas:hash", hash: location.hash }); });

  var zoom = function (fig) {
    var art = fig.querySelector("svg, img");
    if (!art) return;
    var box = art.getBoundingClientRect();
    var layer = document.createElement("div");
    layer.className = "atlas-zoom";
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-label", "Diagram, zoomed. Scroll to zoom, drag to move, Escape to close");
    var holder = document.createElement("div");
    var copy = art.cloneNode(true);
    copy.style.width = box.width + "px";
    copy.style.height = box.height + "px";
    holder.appendChild(copy);
    layer.appendChild(holder);
    var fit = Math.min((innerWidth * 0.92) / (box.width + 32), (innerHeight * 0.92) / (box.height + 32));
    var s = Math.max(1, fit), x = -(box.width + 32) * s / 2, y = -(box.height + 32) * s / 2;
    var draw = function () { holder.style.transform = "translate(" + x + "px," + y + "px) scale(" + s + ")"; };
    var close = function () { layer.remove(); document.removeEventListener("keydown", onKey, true); };
    var onKey = function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    var drag = null, moved = false;
    layer.addEventListener("wheel", function (e) {
      e.preventDefault();
      var k = Math.exp(-e.deltaY * 0.0015), cx = e.clientX - innerWidth / 2, cy = e.clientY - innerHeight / 2;
      var next = Math.min(12, Math.max(0.3, s * k));
      x = cx - (cx - x) * (next / s); y = cy - (cy - y) * (next / s); s = next; draw();
    }, { passive: false });
    layer.addEventListener("pointerdown", function (e) { drag = { x: e.clientX - x, y: e.clientY - y }; moved = false; layer.setPointerCapture(e.pointerId); });
    layer.addEventListener("pointermove", function (e) {
      if (!drag) return;
      moved = true; x = e.clientX - drag.x; y = e.clientY - drag.y; draw();
    });
    layer.addEventListener("pointerup", function () { drag = null; if (!moved) close(); });
    document.addEventListener("keydown", onKey, true);
    draw();
    document.body.appendChild(layer);
  };

  document.addEventListener("click", function (e) {
    if (!framed || e.defaultPrevented) return;
    var fig = e.target && e.target.closest && e.target.closest("figure[data-atlas-diagram], figure.diagram");
    if (fig && !e.target.closest("a")) zoom(fig);
  });

  document.addEventListener("DOMContentLoaded", function () {
    if (!framed) return;
    var related = [];
    document.querySelectorAll("[data-atlas-related] a[href], section.related a[href]").forEach(function (a) {
      var url = new URL(a.getAttribute("href"), location.href);
      var path = docPath(url);
      related.push({ text: (a.textContent || "").trim(), href: path ? "/r" + path + url.hash : url.href });
    });
    post({ type: "atlas:ready", related: related.slice(0, 30), hash: location.hash });
  });
})();`

export const BRIDGE = `<script>${script}</script>`

/** The page with the bridge first in its <head>, before any of the doc's own scripts. */
export function withBridge(html: string): string {
  const head = /<head\b[^>]*>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + BRIDGE + html.slice(head.index + head[0].length)
  const open = /<html\b[^>]*>/i.exec(html)
  if (open) return html.slice(0, open.index + open[0].length) + `<head>${BRIDGE}</head>` + html.slice(open.index + open[0].length)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  const at = doctype ? doctype[0].length : 0
  return html.slice(0, at) + BRIDGE + html.slice(at)
}
