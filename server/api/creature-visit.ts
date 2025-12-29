import { Hono } from 'hono';
import { loadVisitor, saveVisitor, validateVid } from '../lib/visitor-memory';

const app = new Hono();

interface VisitRequest {
  vid: string;
  event: 'start' | 'end';  // start = page load, end = beforeunload
  referrer?: string | null;
  page?: string;
  timeOnPage?: number;
  interactions?: {
    clicks: number;
    fled: number;
  };
}

// Record a visit or update visitor data
app.post('/visit', async (c) => {
  try {
    const body = await c.req.json<VisitRequest>();
    const { vid, event = 'start', referrer, page, timeOnPage, interactions } = body;

    if (!vid || typeof vid !== 'string') {
      return c.json({ error: 'vid required' }, 400);
    }

    const safeVid = validateVid(vid);
    if (!safeVid) {
      return c.json({ error: 'invalid vid format' }, 400);
    }

    const visitor = await loadVisitor(safeVid);

    // Only increment visits on 'start' event (page load)
    if (event === 'start') {
      visitor.visits++;
      visitor.lastVisit = new Date().toISOString();

      // Sanitize and store referrer (host only, max 100 chars)
      if (referrer && typeof referrer === 'string') {
        try {
          const refHost = new URL(referrer).hostname.slice(0, 100);
          if (refHost && !visitor.referrers.includes(refHost)) {
            visitor.referrers.push(refHost);
            // Keep only last 10 referrers
            if (visitor.referrers.length > 10) visitor.referrers.shift();
          }
        } catch {
          // Invalid URL, skip
        }
      }

      // Store page (max 200 chars)
      if (page && typeof page === 'string') {
        const safePage = page.slice(0, 200);
        if (!visitor.pagesVisited.includes(safePage)) {
          visitor.pagesVisited.push(safePage);
          // Keep only last 50 pages
          if (visitor.pagesVisited.length > 50) visitor.pagesVisited.shift();
        }
      }
    }

    // Update time on 'end' event only (avoid double-counting)
    if (event === 'end' && typeof timeOnPage === 'number') {
      // Validate: finite, positive, max 6 hours
      if (Number.isFinite(timeOnPage) && timeOnPage > 0 && timeOnPage < 21600) {
        visitor.totalTimeOnSite += Math.floor(timeOnPage);
      }
    }

    // Update interactions (use max to handle out-of-order delivery)
    if (interactions) {
      const clicks = Math.min(interactions.clicks || 0, 10000);
      const fled = Math.min(interactions.fled || 0, 10000);
      visitor.interactions.clicks = Math.max(visitor.interactions.clicks, clicks);
      visitor.interactions.fled = Math.max(visitor.interactions.fled, fled);
    }

    await saveVisitor(safeVid, visitor);

    return c.json({
      visits: visitor.visits,
      firstSeen: visitor.firstSeen,
      returning: visitor.visits > 1,
    });
  } catch (error) {
    console.error('Visitor tracking error:', error);
    return c.json({ error: 'internal error' }, 500);
  }
});

export default app;
