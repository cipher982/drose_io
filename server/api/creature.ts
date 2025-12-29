/**
 * Creature State API
 *
 * Returns the current state for the ambient creature, aggregated from:
 * - Whoop (recovery, sleep, strain)
 * - Traccar (location)
 * - Infrastructure health
 * - Git activity
 *
 * For now, returns stub data. Will integrate with Life Hub (data.drose.io).
 */

import type { Context } from 'hono';

// Life Hub API base (for future integration)
const LIFE_HUB_URL = process.env.LIFE_HUB_URL || 'https://data.drose.io';

interface CreatureState {
  energy: number;
  mood: 'happy' | 'neutral' | 'tired' | 'stressed';
  location: {
    isHome: boolean;
    isMoving: boolean;
    city?: string;
  };
  activity: {
    recentCommits: number;
    serverHealth: 'green' | 'yellow' | 'red';
    activeWorkers: number;
  };
  time: {
    hour: number;
    isNight: boolean;
  };
}

// Cache to avoid hammering Life Hub
let cachedState: CreatureState | null = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000; // 60 seconds

/**
 * Calculate mood from various signals
 */
function calculateMood(
  recovery: number,
  serverHealth: 'green' | 'yellow' | 'red',
  isNight: boolean
): CreatureState['mood'] {
  if (recovery < 40 && serverHealth !== 'green') {
    return 'stressed';
  }
  if (recovery < 50 || isNight) {
    return 'tired';
  }
  if (recovery > 80 && serverHealth === 'green') {
    return 'happy';
  }
  return 'neutral';
}

/**
 * Fetch state from Life Hub APIs
 * TODO: Implement actual API calls when ready
 */
async function fetchFromLifeHub(): Promise<CreatureState> {
  const now = new Date();
  const hour = now.getHours();
  const isNight = hour >= 22 || hour < 6;

  // TODO: Replace with actual Life Hub API calls
  // const whoopRes = await fetch(`${LIFE_HUB_URL}/api/whoop/latest`);
  // const infraRes = await fetch(`${LIFE_HUB_URL}/api/status`);
  // const locationRes = await fetch(`${LIFE_HUB_URL}/query/location?latest=true`);

  // For now, return plausible stub data with some randomness
  // to make the creature feel more alive during development
  const recovery = 60 + Math.floor(Math.random() * 30); // 60-90
  const serverHealth = 'green' as const;

  return {
    energy: recovery,
    mood: calculateMood(recovery, serverHealth, isNight),
    location: {
      isHome: true,
      isMoving: false,
      city: 'Portland',
    },
    activity: {
      recentCommits: Math.floor(Math.random() * 5),
      serverHealth,
      activeWorkers: 0,
    },
    time: {
      hour,
      isNight,
    },
  };
}

/**
 * GET /api/creature/state
 */
export async function getCreatureState(c: Context) {
  const now = Date.now();

  // Return cached if fresh
  if (cachedState && now - cacheTime < CACHE_TTL) {
    return c.json(cachedState);
  }

  try {
    cachedState = await fetchFromLifeHub();
    cacheTime = now;
    return c.json(cachedState);
  } catch (error) {
    console.error('Failed to fetch creature state:', error);

    // Return fallback state
    const fallback: CreatureState = {
      energy: 70,
      mood: 'neutral',
      location: { isHome: true, isMoving: false },
      activity: { recentCommits: 0, serverHealth: 'green', activeWorkers: 0 },
      time: { hour: new Date().getHours(), isNight: false },
    };

    return c.json(fallback);
  }
}
