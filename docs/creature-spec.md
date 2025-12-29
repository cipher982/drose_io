# Creature System Spec

An ambient creature ("Pepper" the maltipom) that lives on drose.io, reflecting real-world state from Life Hub.

> **Note:** Pepper v2 is now live with LLM-powered thoughts and visitor memory.
> See [pepper-v2-implementation-report.md](./pepper-v2-implementation-report.md) for current implementation details.

## Overview

A pixel art dog sprite that:
- Wanders the page autonomously
- Reacts to mouse movements (curiosity, flee)
- Reflects real data: Whoop recovery, server health, location, git activity
- Has personality through behavioral state machine

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (client)                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ creature.js │──│ state machine │──│ sprite animation  │  │
│  │             │  │ (behaviors)   │  │                   │  │
│  └──────┬──────┘  └──────────────┘  └───────────────────┘  │
│         │ fetch /api/creature/state (every 60s)             │
└─────────┼───────────────────────────────────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────────┐
│                    drose.io Server                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ GET /api/creature/state                               │   │
│  │ → Aggregates from Life Hub APIs                       │   │
│  │ → Returns { energy, mood, location, activity, ... }   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Life Hub (data.drose.io)                   │
│  • /api/whoop/latest     → recovery, sleep, strain          │
│  • /api/status           → server health                    │
│  • /query/location       → current location (Traccar)       │
└─────────────────────────────────────────────────────────────┘
```

## State Machine

### States

| State | Animation | Trigger |
|-------|-----------|---------|
| `idle` | `idle` (3 frames) | Default, after actions |
| `wander` | `walk` (4 frames) | Random timer (5-15s) |
| `curious` | `alert` (1 frame) | Mouse nearby but not too close |
| `flee` | `run` (4 frames) | Mouse very close (<120px) |
| `sleep` | `lie` (2 frames) | Low energy + night |
| `happy` | `face` (2 frames) | Click interaction |

### Transitions

```
                    ┌──────────┐
           ┌───────►│  idle    │◄───────┐
           │        └────┬─────┘        │
           │             │              │
      (timeout)    (random timer)  (timeout)
           │             │              │
           │             ▼              │
     ┌─────┴────┐   ┌─────────┐   ┌────┴─────┐
     │  flee    │   │ wander  │   │ curious  │
     └──────────┘   └─────────┘   └──────────┘
           ▲             │              ▲
           │             │              │
    (mouse close)   (arrived)    (mouse near)
           │             │              │
           └─────────────┴──────────────┘
```

## Sprite System

### Sprite Sheet Layout

File: `public/assets/images/pepper_spritesheet.png` (400×610px)

| Animation | Y-offset | Height | Frames | Speed (ms) |
|-----------|----------|--------|--------|------------|
| idle | 0 | 88 | 3 | 400 |
| walk | 88 | 85 | 4 | 150 |
| run | 173 | 82 | 4 | 80 |
| sit | 255 | 99 | 2 | 600 |
| lie | 354 | 58 | 2 | 800 |
| face | 412 | 119 | 2 | 500 |
| alert | 531 | 79 | 1 | - |

Frame width: 100px (consistent across all animations)

### Direction Handling

- Sprites face right by default
- CSS class `.facing-left` applies `scaleX(-1)` via animation variants
- Each animation has both normal and `-flip` keyframes to preserve direction during CSS animations

## Data Integration

### Creature State Response

```typescript
interface CreatureState {
  energy: number;                    // 0-100, from Whoop recovery
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
```

### Mood Calculation

```
IF recovery < 40 AND serverHealth != 'green':
  mood = 'stressed'
ELSE IF recovery < 50 OR isNight:
  mood = 'tired'
ELSE IF recovery > 80 AND serverHealth == 'green':
  mood = 'happy'
ELSE:
  mood = 'neutral'
```

## Visual Effects

### Glow Effects (CSS)

Creature has indigo glow to match site's "Zerg Glass" theme:

| Mood | Glow |
|------|------|
| happy | Strong indigo + cyan secondary |
| neutral | Medium indigo |
| tired | Dim gray, reduced opacity |
| stressed | Amber warning glow |

### CSS Animations

Each state has subtle CSS animation layered on top of sprite animation:
- **idle**: Gentle vertical bob (3s)
- **wander**: Quick bob while walking (0.3s)
- **flee**: Horizontal stretch effect (0.15s)
- **curious**: Slight head tilt (1.5s)
- **sleep**: Breathing scale (4s)
- **happy**: Bouncy scale (0.4s)

## Interaction

### Mouse Tracking

| Distance | Behavior |
|----------|----------|
| >300px | Ignore |
| 120-300px | Curious (face toward mouse) |
| <120px | Flee (run away) |

### Click Interaction

1. Show thought bubble with random message
2. Trigger happy state for 2 seconds
3. Return to idle

### Thought Bubbles

Messages: `'...'`, `'woof!'`, `'*sniff*'`, `'hello!'`, `':)'`, `'*wag*'`, `'*curious*'`, `'ooh'`, `'arf!'`

## File Structure

```
public/
├── assets/
│   ├── js/
│   │   └── creature.js         # Main creature logic (491 lines)
│   ├── css/
│   │   └── creature.css        # Styles + animations (194 lines)
│   └── images/
│       ├── pepper_spritesheet.png   # Sprite sheet (184KB)
│       └── pepper_spritesheet.json  # Frame metadata
│
server/
├── api/
│   └── creature.ts             # /api/creature/state endpoint
│
docs/
└── creature-spec.md            # This file
```

## Configuration

All tunable values in `creature.js`:

```javascript
const CONFIG = {
  wanderIntervalMin: 5000,    // Min ms between wanders
  wanderIntervalMax: 15000,   // Max ms between wanders
  stateCheckInterval: 60000,  // API poll interval

  wanderSpeed: 50,            // px/sec
  fleeSpeed: 400,             // px/sec
  curiousSpeed: 30,           // px/sec

  fleeDistance: 120,          // px
  curiousDistance: 300,       // px
  boundaryPadding: 80,        // px from viewport edge
};
```

## Future Enhancements

- [ ] Life Hub data integration (endpoint stubbed, awaiting integration)
- [x] ~~Higher quality sprites~~ → v2 spritesheet (Dec 2025)
- [x] ~~More thought bubble variety (data-driven)~~ → LLM thoughts (Dec 2025)
- [ ] Sound effects (optional, muted by default)
- [ ] Accessories based on state (hard hat during commits, backpack when traveling)
- [ ] Admin controls (summon, change mood)
- [x] ~~Visitor persistence (remember returning visitors)~~ → Phase 2 (Dec 2025)
