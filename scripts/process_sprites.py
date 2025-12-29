#!/usr/bin/env python3
"""
Sprite Sheet Processor for Pepper v2

Extracts sprites from a 4x4 grid with magenta background,
removes background, and assembles into final spritesheet.
"""

from PIL import Image
import json
from pathlib import Path

# Paths
INPUT = Path(__file__).parent.parent / "public/assets/images/pepper_spritesheet_v2_raw.png"
OUTPUT_DIR = Path(__file__).parent.parent / "public/assets/images/sprites_processed"
FINAL_SHEET = Path(__file__).parent.parent / "public/assets/images/pepper_spritesheet_v2.png"
FINAL_JSON = Path(__file__).parent.parent / "public/assets/images/pepper_spritesheet_v2.json"

# Grid config
GRID_COLS = 4
GRID_ROWS = 4
CELL_WIDTH = 300
CELL_HEIGHT = 224

# Magenta background color range (min, max for each channel)
# Includes anti-aliased edge pixels that blend toward darker
BG_R_RANGE = (170, 200)
BG_G_RANGE = (55, 80)
BG_B_RANGE = (145, 175)

# Target frame width for final output
TARGET_FRAME_WIDTH = 100

# Animation mapping: which cells go to which animation
# Format: animation_name -> list of (col, row) tuples
ANIMATION_MAP = {
    "idle": [(0, 0), (1, 0), (3, 0)],  # sitting/standing poses
    "walk": [(0, 1), (1, 1), (2, 1), (3, 1)],  # row 2 walk cycle
    "run": [(0, 1), (1, 1), (2, 1), (3, 1)],  # reuse walk for now (faster speed in JS)
    "sit": [(0, 0), (1, 0)],  # sitting poses
    "lie": [(1, 2), (2, 2)],  # curled + lying
    "face": [(0, 3), (1, 3)],  # tongue out, happy
    "alert": [(2, 3)],  # alert pose
}

# Scale adjustments for animations where the dog is drawn larger/smaller
# 1.0 = no change, <1.0 = shrink, >1.0 = enlarge
ANIMATION_SCALE = {
    "idle": 0.75,    # sitting poses are bigger
    "sit": 0.75,
    "face": 0.82,    # front-facing poses are bigger
    "alert": 0.82,
}


def is_background(pixel):
    """Check if pixel is within the background color range."""
    r, g, b = pixel[:3]
    return (BG_R_RANGE[0] <= r <= BG_R_RANGE[1] and
            BG_G_RANGE[0] <= g <= BG_G_RANGE[1] and
            BG_B_RANGE[0] <= b <= BG_B_RANGE[1])


def remove_background(img):
    """Replace background pixels with transparency."""
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size

    for y in range(h):
        for x in range(w):
            if is_background(pixels[x, y]):
                pixels[x, y] = (0, 0, 0, 0)

    return img


def trim_to_content(img, padding=2):
    """Trim transparent borders, keep small padding."""
    bbox = img.getbbox()
    if not bbox:
        return img

    # Add padding
    x1, y1, x2, y2 = bbox
    x1 = max(0, x1 - padding)
    y1 = max(0, y1 - padding)
    x2 = min(img.width, x2 + padding)
    y2 = min(img.height, y2 + padding)

    return img.crop((x1, y1, x2, y2))


def extract_cell(img, col, row):
    """Extract a single cell from the grid."""
    x = col * CELL_WIDTH
    y = row * CELL_HEIGHT
    return img.crop((x, y, x + CELL_WIDTH, y + CELL_HEIGHT))


def normalize_frames(frames, target_width=TARGET_FRAME_WIDTH, extra_scale=1.0):
    """Scale and pad frames to uniform size."""
    if not frames:
        return []

    # Apply extra scale adjustment (for animations with differently-sized dogs)
    adjusted_width = int(target_width * extra_scale)

    # Scale all frames to target width (maintain aspect ratio)
    scaled = []
    for f in frames:
        ratio = adjusted_width / f.width
        new_h = int(f.height * ratio)
        scaled.append(f.resize((adjusted_width, new_h), Image.Resampling.NEAREST))

    # Find max height
    max_h = max(f.height for f in scaled)

    # Pad to uniform size (center horizontally, bottom-align for ground contact)
    normalized = []
    for f in scaled:
        canvas = Image.new("RGBA", (target_width, max_h), (0, 0, 0, 0))
        # Center horizontally, bottom-align vertically (so feet stay on ground)
        x_offset = (target_width - f.width) // 2
        y_offset = max_h - f.height
        canvas.paste(f, (x_offset, y_offset), f)
        normalized.append(canvas)

    return normalized


def process_sprites():
    """Main processing pipeline."""
    print(f"Loading: {INPUT}")
    source = Image.open(INPUT)
    print(f"Source size: {source.size}")

    # Create output dir
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Extract and process each animation
    animations = {}
    all_rows = []

    for anim_name, cells in ANIMATION_MAP.items():
        print(f"\nProcessing: {anim_name} ({len(cells)} frames)")

        frames = []
        for i, (col, row) in enumerate(cells):
            # Extract cell
            cell = extract_cell(source, col, row)

            # Remove background
            cell = remove_background(cell)

            # Trim to content
            cell = trim_to_content(cell)

            # Save individual frame for debugging
            debug_path = OUTPUT_DIR / f"{anim_name}_{i:02d}.png"
            cell.save(debug_path)
            print(f"  Frame {i}: {cell.size} -> {debug_path.name}")

            frames.append(cell)

        # Normalize frames (apply per-animation scale adjustment)
        extra_scale = ANIMATION_SCALE.get(anim_name, 1.0)
        normalized = normalize_frames(frames, extra_scale=extra_scale)

        if normalized:
            frame_w = normalized[0].width
            frame_h = normalized[0].height

            # Create horizontal strip for this animation
            strip = Image.new("RGBA", (frame_w * len(normalized), frame_h), (0, 0, 0, 0))
            for i, f in enumerate(normalized):
                strip.paste(f, (i * frame_w, 0), f)

            all_rows.append((anim_name, strip, frame_h, len(normalized)))

            # Save strip for debugging
            strip.save(OUTPUT_DIR / f"{anim_name}_strip.png")
            print(f"  Strip: {strip.size}")

    # Assemble final spritesheet (vertical stack)
    print("\n" + "=" * 50)
    print("Assembling final spritesheet...")

    total_height = sum(row[2] for row in all_rows)
    max_width = max(row[1].width for row in all_rows)

    final = Image.new("RGBA", (max_width, total_height), (0, 0, 0, 0))
    metadata = {}

    y_offset = 0
    for anim_name, strip, height, frame_count in all_rows:
        final.paste(strip, (0, y_offset), strip)

        metadata[anim_name] = {
            "y": y_offset,
            "frameWidth": TARGET_FRAME_WIDTH,
            "frameHeight": height,
            "frameCount": frame_count,
            "frames": [
                {"x": i * TARGET_FRAME_WIDTH, "y": y_offset, "w": TARGET_FRAME_WIDTH, "h": height}
                for i in range(frame_count)
            ]
        }

        print(f"  {anim_name}: y={y_offset}, h={height}, frames={frame_count}")
        y_offset += height

    # Save final outputs
    final.save(FINAL_SHEET)
    print(f"\nSaved: {FINAL_SHEET} ({final.size})")

    with open(FINAL_JSON, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"Saved: {FINAL_JSON}")

    # Print JS config for creature.js
    print("\n" + "=" * 50)
    print("Copy this to creature.js SPRITES config:\n")
    for anim_name, _, height, frame_count in all_rows:
        y = metadata[anim_name]["y"]
        print(f"    {anim_name}: {{ y: {y}, h: {height}, frames: {frame_count}, speed: 400 }},")


if __name__ == "__main__":
    process_sprites()
