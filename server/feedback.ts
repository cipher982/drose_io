import type { Context } from "hono";
import { notifications } from "./notifications";
import { appendMessage, isBlocked, generateMessageId, getVisitorMetadata, isValidVisitorId } from "./storage/threads";
import { upsertThreadMeta, continueUrlForToken, isValidEmail } from "./storage/thread-meta";
import { sendPushNotification } from "./api/push";

const BYPASS_RATE_LIMIT = Bun.env.TEST_MODE === "true";
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const emailLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(map: Map<string, { count: number; resetAt: number }>, key: string, maxRequests = 10, windowMs = 3600000): boolean {
  if (BYPASS_RATE_LIMIT) return true;
  const now = Date.now();
  const limit = map.get(key);
  if (!limit || now > limit.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (limit.count >= maxRequests) return false;
  limit.count++;
  return true;
}

export async function handleFeedback(c: Context) {
  try {
    const body = await c.req.json();
    const { visitorId, type, text, page, email } = body;

    if (!visitorId) {
      return c.json({ error: "visitorId required" }, 400);
    }
    if (!isValidVisitorId(visitorId)) {
      return c.json({ error: "Invalid visitorId" }, 400);
    }

    if (isBlocked(visitorId)) {
      return c.json({ error: "Blocked" }, 403);
    }

    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    if (!checkRateLimit(rateLimits, ip)) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    let contactEmail: string | undefined;
    if (typeof email === "string" && email.trim()) {
      contactEmail = email.trim().toLowerCase();
      if (!isValidEmail(contactEmail)) {
        return c.json({ error: "Invalid email" }, 400);
      }
      if (!checkRateLimit(emailLimits, `email:${contactEmail}`, 5, 3600000)) {
        return c.json({ error: "Email rate limit exceeded" }, 429);
      }
    }

    const messageId = generateMessageId();
    const message = {
      id: messageId,
      from: "visitor" as const,
      text: text || "",
      ts: Date.now(),
      page: page || "/",
    };

    appendMessage(visitorId, message);

    const meta = upsertThreadMeta(visitorId, contactEmail ? { contactEmail } : undefined);
    const continueUrl = continueUrlForToken(meta.continueToken);

    console.log("📝 Message stored:", { visitorId, messageId, type, page });

    const metadata = getVisitorMetadata(visitorId);

    try {
      if (type === "ping") {
        const notificationText = `👋 Someone pinged from ${page}\n\nVisitor: ${visitorId.substring(0, 8)}\nFirst seen: ${metadata ? new Date(metadata.firstSeen).toLocaleString() : "now"}\nMessages: ${metadata?.messageCount || 1}`;
        await notifications.sendAll(notificationText);
        await sendPushNotification("New Ping!", `Someone pinged from ${page}`, visitorId);
      } else if (type === "message" && text) {
        const notificationText = `💬 New message from ${visitorId.substring(0, 8)}\n\nPage: ${page}\nFirst seen: ${metadata ? new Date(metadata.firstSeen).toLocaleString() : "now"}\nMessages: ${metadata?.messageCount || 1}\n\n"${text}"`;
        await notifications.sendAll(notificationText);
        await sendPushNotification("New Message!", text, visitorId);
      }
    } catch (error) {
      console.error("❌ Notification failed:", error);
    }

    const todayKey = new Date().toISOString().split("T")[0];
    const countKey = `count-${todayKey}`;
    let count = parseInt(Bun.env[countKey] || "0");
    count++;
    Bun.env[countKey] = count.toString();

    return c.json({
      success: true,
      messageId,
      visitorId,
      continueUrl,
      continueToken: meta.continueToken,
      contactEmail: meta.contactEmail || null,
      count: type === "ping" ? count : undefined,
    });
  } catch (error) {
    console.error("Error handling feedback:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
}
