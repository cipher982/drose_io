import type { Context } from "hono";
import { getMessages, appendMessage, generateMessageId, isValidVisitorId, isBlocked } from "../storage/threads";
import {
  getVisitorIdByContinueToken,
  continueUrlForToken,
} from "../storage/thread-meta";

const BYPASS_RATE_LIMIT = Bun.env.TEST_MODE === "true";
const tokenLookupLimits = new Map<string, { count: number; resetAt: number }>();

function checkLimit(
  map: Map<string, { count: number; resetAt: number }>,
  key: string,
  max: number,
  windowMs: number
): boolean {
  if (BYPASS_RATE_LIMIT) return true;
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || now > entry.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function renderContinuePage(token: string, messages: { from: string; text: string; ts: number }[], error?: string): string {
  const msgs = messages.length
    ? messages.map(m => `
      <div class="msg ${m.from === "david" ? "david" : "visitor"}">
        <div class="author">${m.from === "david" ? "David" : "You"}</div>
        <div class="text">${esc(m.text)}</div>
        <div class="time">${esc(formatTime(m.ts))}</div>
      </div>`).join("")
    : "<p class=\"empty\">No messages yet.</p>";

  const err = error ? `<p class="error">${esc(error)}</p>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Continue conversation — drose.io</title>
  <link rel="stylesheet" href="/assets/css/tokens.css" />
  <style>
    body { margin: 0; min-height: 100vh; background: #0a0a0f; color: #e4e4e7; font-family: ui-sans-serif, system-ui, sans-serif; }
    .wrap { max-width: 560px; margin: 0 auto; padding: 24px 16px 48px; }
    h1 { font-size: 1.25rem; margin: 0 0 8px; }
    .sub { color: #a1a1aa; font-size: 0.9rem; margin-bottom: 24px; }
    .thread { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px; margin-bottom: 16px; max-height: 50vh; overflow-y: auto; }
    .msg { margin-bottom: 12px; }
    .msg .author { font-size: 0.75rem; color: #a1a1aa; margin-bottom: 2px; }
    .msg.david .text { color: #a5b4fc; }
    .msg .text { white-space: pre-wrap; word-break: break-word; }
    .msg .time { font-size: 0.7rem; color: #71717a; margin-top: 2px; }
    textarea { width: 100%; box-sizing: border-box; min-height: 88px; background: rgba(0,0,0,0.35); color: #e4e4e7; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 12px; font: inherit; resize: vertical; }
    button { margin-top: 10px; width: 100%; background: #6366f1; color: white; border: 0; border-radius: 8px; padding: 12px; font-weight: 600; cursor: pointer; }
    button:hover { background: #4f46e5; }
    .error { color: #f87171; }
    .empty { color: #71717a; text-align: center; }
    a.home { color: #a5b4fc; text-decoration: none; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <a class="home" href="/">← drose.io</a>
    <h1>Continue the conversation</h1>
    <p class="sub">This private link lets you keep chatting with David after you left the site.</p>
    ${err}
    <div class="thread">${msgs}</div>
    <form method="POST" action="/m/${esc(token)}">
      <textarea name="text" maxlength="280" placeholder="Your message..." required></textarea>
      <button type="submit">Send message</button>
    </form>
  </div>
</body>
</html>`;
}

function clientIp(c: Context): string {
  return c.req.header("cf-connecting-ip")
    || c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || c.req.header("x-real-ip")
    || "unknown";
}

export async function continueThreadGet(c: Context) {
  const { token } = c.req.param();
  const ip = clientIp(c);

  if (!checkLimit(tokenLookupLimits, `lookup:${ip}`, 60, 60_000)) {
    return c.text("Too many requests", 429);
  }

  const visitorId = getVisitorIdByContinueToken(token);
  if (!visitorId) {
    return c.html(renderContinuePage(token, [], "This link is invalid or expired."), 404);
  }

  const messages = getMessages(visitorId);
  return c.html(renderContinuePage(token, messages));
}

export async function continueThreadPost(c: Context) {
  const { token } = c.req.param();
  const ip = clientIp(c);

  if (!checkLimit(tokenLookupLimits, `lookup:${ip}`, 60, 60_000)) {
    return c.text("Too many requests", 429);
  }
  if (!checkLimit(tokenLookupLimits, `post:${ip}`, 20, 3_600_000)) {
    return c.text("Too many messages", 429);
  }

  const visitorId = getVisitorIdByContinueToken(token);
  if (!visitorId || !isValidVisitorId(visitorId)) {
    return c.html(renderContinuePage(token, [], "This link is invalid or expired."), 404);
  }

  if (isBlocked(visitorId)) {
    return c.text("Blocked", 403);
  }

  const contentType = c.req.header("content-type") || "";
  let text = "";
  if (contentType.includes("application/json")) {
    const body = await c.req.json();
    text = (body.text || "").trim();
  } else {
    const body = await c.req.parseBody();
    text = String(body.text || "").trim();
  }

  if (!text) {
    const messages = getMessages(visitorId);
    return c.html(renderContinuePage(token, messages, "Message required."), 400);
  }
  if (text.length > 280) {
    const messages = getMessages(visitorId);
    return c.html(renderContinuePage(token, messages, "Message too long (280 max)."), 400);
  }

  appendMessage(visitorId, {
    id: generateMessageId(),
    from: "visitor",
    text,
    ts: Date.now(),
    page: `/m/${token}`,
  });

  if (!contentType.includes("application/json")) {
    return c.redirect(`/m/${token}`, 303);
  }

  return c.json({ success: true, continueUrl: continueUrlForToken(token) });
}
