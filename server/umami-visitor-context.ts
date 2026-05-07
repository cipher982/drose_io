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
// The Umami tracker defers attaching window.umami until
// document.readyState === "complete", which can land after <script defer>
// onload fires. Retry for up to ~5s so we don't silently miss identify.
window.sendUmamiVisitorContext = function () {
  var attempts = 0;
  var MAX_ATTEMPTS = 50;
  var INTERVAL_MS = 100;
  function tryIdentify() {
    try {
      if (!window.umamiVisitorContext) return;
      if (window.umami && typeof window.umami.identify === "function") {
        var visitorId = window.umamiVisitorContext.getVisitorId();
        var data = window.umamiVisitorContext.data();
        if (visitorId) {
          window.umami.identify(visitorId, data);
        } else {
          window.umami.identify(data);
        }
        return;
      }
      if (++attempts < MAX_ATTEMPTS) {
        setTimeout(tryIdentify, INTERVAL_MS);
      }
    } catch (e) {}
  }
  tryIdentify();
};
</script>`;
