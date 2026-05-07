/**
 * Visitor-context helper for Umami `umami.identify(...)`.
 *
 * Emitted as an inline <script> before the Umami tracker. The tracker calls
 * window.sendUmamiVisitorContext() via its onload hook, which attaches a
 * stable visitor id and session traits (viewport bucket, source bucket,
 * traffic quality, timezone, etc.) that Umami does not collect natively.
 *
 * Source of truth lives in ~/git/me/mytech/operations/umami.md.
 */
export const UMAMI_VISITOR_CONTEXT_SCRIPT = `<script>
window.umamiVisitorContext = (function () {
  function getVisitorId() {
    try {
      var key = "drose.visitor_id";
      var existing = localStorage.getItem(key);
      if (existing) return existing;
      var random = crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
      var id = "dv_" + random.replace(/[^a-zA-Z0-9]/g, "").slice(0, 47);
      localStorage.setItem(key, id);
      return id;
    } catch (e) {
      return undefined;
    }
  }
  function bucketViewport() {
    var width = window.innerWidth || 0;
    if (width >= 1440) return "desktop_wide";
    if (width >= 1024) return "desktop";
    if (width >= 768) return "tablet";
    return "mobile";
  }
  function bucketSource() {
    var ref = document.referrer || "";
    var params = new URLSearchParams(location.search);
    var source = (params.get("utm_source") || "").toLowerCase();
    if (source) return source;
    if (!ref) return "direct";
    var host = "";
    try { host = new URL(ref).hostname.toLowerCase(); } catch (e) {}
    if (/chatgpt|perplexity|claude|gemini|copilot/.test(host)) return "ai";
    if (/google|bing|duckduckgo|brave|yahoo|yandex|ecosia/.test(host)) return "search";
    if (/x\\.com|twitter|facebook|instagram|linkedin|reddit|threads|tiktok|bsky/.test(host)) return "social";
    if (/localhost|127\\.0\\.0\\.1|drose\\.local|ts\\.net/.test(host)) return "dev";
    return "other";
  }
  function trafficQuality() {
    var ua = navigator.userAgent || "";
    if (/HeadlessChrome|Playwright|Puppeteer|Selenium/i.test(ua)) return "headless_hint";
    if (/UptimeRobot|Pingdom|Better Stack|StatusCake|Healthchecks/i.test(ua)) return "monitor_hint";
    if (/localhost|127\\.0\\.0\\.1|\\.local$/.test(location.hostname)) return "dev";
    return "human";
  }
  function data() {
    var nav = navigator;
    var connection = nav.connection || nav.mozConnection || nav.webkitConnection;
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
      timezone_offset: new Date().getTimezoneOffset(),
      viewport: bucketViewport(),
      pixel_ratio: Math.round((window.devicePixelRatio || 1) * 100) / 100,
      touch: (nav.maxTouchPoints || 0) > 0,
      connection: connection && connection.effectiveType ? connection.effectiveType : "unknown",
      source_bucket: bucketSource(),
      traffic_quality: trafficQuality(),
      landing_path: sessionStorage.getItem("drose.landing_path") || location.pathname
    };
  }
  try {
    if (!sessionStorage.getItem("drose.landing_path")) {
      sessionStorage.setItem("drose.landing_path", location.pathname);
    }
  } catch (e) {}
  return { getVisitorId: getVisitorId, data: data };
})();
// Fire identify() once we can, on whichever signal happens first:
//  - script onload (fast path, usually enough)
//  - DOMContentLoaded (tracker IIFE has executed by this point)
//  - window "load" (hard guarantee, survives background-tab setTimeout throttling)
//  - visibilitychange → visible (recovers tabs that were backgrounded during init)
//  - pageshow (bfcache restore)
// Also keeps a short polling fallback, but real-user reliability comes from the
// event listeners, not the timer — setTimeout is clamped to ~1s in background
// tabs, so timer-only retries can miss identify on quick-bounce sessions.
window.sendUmamiVisitorContext = function () {
  var sent = false;
  function attempt() {
    if (sent) return true;
    try {
      if (!window.umamiVisitorContext) return false;
      if (!window.umami || typeof window.umami.identify !== "function") return false;
      var visitorId = window.umamiVisitorContext.getVisitorId();
      var data = window.umamiVisitorContext.data();
      if (visitorId) {
        window.umami.identify(visitorId, data);
      } else {
        window.umami.identify(data);
      }
      sent = true;
      return true;
    } catch (e) {
      return false;
    }
  }
  if (attempt()) return;
  // Bounded polling as a belt-and-suspenders for the ~few-hundred-ms between
  // tracker IIFE execution and our events firing.
  var polls = 0;
  var POLL_LIMIT = 30;
  var timer = setInterval(function () {
    if (attempt() || ++polls >= POLL_LIMIT) clearInterval(timer);
  }, 100);
  function onEvent() {
    if (attempt()) {
      clearInterval(timer);
    }
  }
  try {
    document.addEventListener("DOMContentLoaded", onEvent, { once: true });
    window.addEventListener("load", onEvent, { once: true });
    window.addEventListener("pageshow", onEvent);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") onEvent();
    });
  } catch (e) {}
};
</script>`;
