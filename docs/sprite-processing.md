# Sprite Sheet Processing Guide

How to extract and process sprites from AI-generated sprite sheets for the Pepper creature system.

## Quick Start

```bash
# 1. Copy new sprite sheet to project
cp ~/Downloads/new_spritesheet.png public/assets/images/pepper_spritesheet_v2_raw.png

# 2. Run the processor
uv run --with pillow python scripts/process_sprites.py

# 3. Update creature.js with the output config (printed by script)

# 4. Bump cache version in creature.js: ?v=N -> ?v=N+1

# 5. Hard refresh browser to test
```

## The Script: `scripts/process_sprites.py`

The main processing script handles:
- Grid-based cell extraction
- HSV hue-based background removal (robust for anti-aliased edges)
- Per-animation scale normalization
- Spritesheet assembly with JSON metadata

### Key Configuration

Edit these values at the top of the script for each new sprite sheet:

```python
# Grid layout of source image
GRID_COLS = 4
GRID_ROWS = 4
CELL_WIDTH = 300   # pixels per cell
CELL_HEIGHT = 224

# Background hue detection (magenta ≈ 0.83-0.89)
BG_HUE_MIN = 0.80
BG_HUE_MAX = 0.92
BG_SAT_MIN = 0.20  # Avoid removing grays

# Which cells map to which animations
ANIMATION_MAP = {
    "idle": [(0, 0), (1, 0), (3, 0)],
    "walk": [(0, 1), (1, 1), (2, 1), (3, 1)],
    # ... etc
}

# Scale adjustments (AI draws different poses at different sizes)
ANIMATION_SCALE = {
    "idle": 0.75,   # Sitting poses drawn larger
    "alert": 0.82,  # Front-facing poses drawn larger
}
```

## Common AI Generator Issues

### 1. Solid Color Background (Not True Alpha)

AI generators often use solid magenta/green instead of transparency.

**Solution:** HSV hue-based detection is more robust than RGB matching:

```python
def is_background(pixel):
    r, g, b = pixel[:3]
    h, s, v = rgb_to_hsv(r, g, b)
    return (BG_HUE_MIN <= h <= BG_HUE_MAX and s >= BG_SAT_MIN)
```

**Why HSV?** Anti-aliased edges blend the background color with sprite colors, creating pixels that don't match exact RGB values. HSV catches all shades of a hue regardless of brightness.

### 2. Checkerboard "Transparency"

Some generators bake a checkerboard pattern as actual pixels.

**Solution:** Detect the two checkerboard colors by sampling corners:

```python
from collections import Counter

def detect_checkerboard(img):
    pixels = img.load()
    corner_colors = [pixels[x, y][:3] for y in range(50) for x in range(50)]
    return [c for c, _ in Counter(corner_colors).most_common(2)]
```

### 3. Inconsistent Sprite Sizes

AI draws different poses at different scales (front-facing larger than side-profile).

**Solution:** Per-animation scale factors:

```python
ANIMATION_SCALE = {
    "idle": 0.75,    # Sitting poses are drawn bigger
    "sit": 0.75,
    "face": 0.82,    # Front-facing is bigger
    "alert": 0.82,
}
```

Adjust these by comparing the visual dog size between animations.

### 4. Anti-Aliased Edge Remnants

Even with HSV detection, some edge pixels may remain.

**Debugging workflow:**

```python
# Check what pinkish pixels remain in output
from PIL import Image
from collections import Counter

img = Image.open('output.png').convert('RGBA')
pixels = img.load()

pinkish = []
for y in range(img.height):
    for x in range(img.width):
        p = pixels[x, y]
        if p[3] > 0:  # Not transparent
            r, g, b = p[:3]
            if r > 120 and b > 100 and g < 100:  # Pinkish
                pinkish.append((r, g, b))

print(f'Remaining: {len(pinkish)}')
for c, count in Counter(pinkish).most_common(10):
    print(f'  {c}: {count}')
```

Then widen `BG_HUE_MIN`/`BG_HUE_MAX` or lower `BG_SAT_MIN` as needed.

## Output Format

### Spritesheet Structure

```
pepper_spritesheet_v2.png (400 x N pixels)
├── Row 0: idle frames (horizontal)
├── Row 1: walk frames
├── Row 2: run frames
├── Row 3: sit frames
├── Row 4: lie frames
├── Row 5: face frames
└── Row 6: alert frames
```

- Fixed frame width: 100px
- Variable height per animation
- Animations stacked vertically

### JSON Metadata

```json
{
  "idle": {
    "y": 0,
    "frameWidth": 100,
    "frameHeight": 86,
    "frameCount": 3
  },
  "walk": {
    "y": 86,
    "frameWidth": 100,
    "frameHeight": 73,
    "frameCount": 4
  }
}
```

### creature.js Integration

The script outputs config ready to paste:

```javascript
const SPRITES = {
  idle:  { y: 0,   h: 86,  frames: 3, speed: 400 },
  walk:  { y: 86,  h: 73,  frames: 4, speed: 150 },
  run:   { y: 159, h: 73,  frames: 4, speed: 80  },
  // ...
};
```

**Don't forget:** Bump the cache version `?v=N` after updating!

## Animation Mapping Reference

Current animations used by the creature system:

| Animation | Behavior State | Purpose |
|-----------|---------------|---------|
| `idle` | idle | Standing/sitting still |
| `walk` | wander | Walking around page |
| `run` | flee | Running from mouse |
| `sit` | sit | Sitting pose |
| `lie` | sleep | Lying down/sleeping |
| `face` | happy | Happy expression (on click) |
| `alert` | curious | Looking at nearby mouse |

## Requesting New Sprites from AI

Prompt tips for consistent results:

```
Create a 4x4 sprite sheet of a [description] dog in pixel art style.

Requirements:
- Solid magenta (#FF00FF) background
- 16-bit pixel art with black outline
- Consistent character size across all poses
- Each cell: one pose/frame

Layout:
Row 1: Sitting poses (idle)
Row 2: Walk cycle (4 frames)
Row 3: Special poses (sleeping curled, lying flat)
Row 4: Expressions (tongue out, happy, alert)
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Magenta outline visible | Widen HSV hue range or lower saturation minimum |
| Sprite size changes between animations | Adjust `ANIMATION_SCALE` values |
| Wrong frames in animation | Update `ANIMATION_MAP` cell coordinates |
| Frames "jumping" during animation | Check bottom-alignment in `normalize_frames()` |
| White parts of sprite removed | Raise `BG_SAT_MIN` to avoid low-saturation pixels |

## Files

| File | Purpose |
|------|---------|
| `scripts/process_sprites.py` | Main processing script |
| `public/assets/images/pepper_spritesheet_v2_raw.png` | Source from AI |
| `public/assets/images/pepper_spritesheet_v2.png` | Processed output |
| `public/assets/images/pepper_spritesheet_v2.json` | Metadata |
| `public/assets/images/sprites_processed/` | Debug frames (gitignored) |
| `public/assets/js/creature.js` | Consumer of spritesheet |

## Dependencies

```bash
uv run --with pillow python scripts/process_sprites.py
```

Only needs Pillow. No heavy dependencies.
