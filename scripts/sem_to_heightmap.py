#!/usr/bin/env python3
"""Turn a raw SEM/AFM image into a heightmap + texture pair for WebXR terrain.

Usage: python3 sem_to_heightmap.py <input_image> <output_name>
Writes assets/processed/<output_name>_height.png (16-bit grayscale)
and assets/processed/<output_name>_texture.jpg (cropped color/gray source).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "processed"


def find_info_bar_crop(gray: np.ndarray) -> int:
    """SEM software burns a black info bar (scale, kV, mag) into the bottom
    rows. White text on that bar makes row-mean brightness noisy row-to-row,
    so instead of thresholding brightness directly, find the single sharp
    drop where smooth image content ends and the bar begins."""
    row_means = gray.mean(axis=1)
    h = len(row_means)
    search_start = int(h * 0.7)
    drops = row_means[search_start:-1] - row_means[search_start + 1:]
    if len(drops) == 0 or drops.max() < 30:
        return h
    crop_at = search_start + int(np.argmax(drops)) + 1
    return crop_at


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    src_path = Path(sys.argv[1])
    name = sys.argv[2]

    img = Image.open(src_path).convert("L")
    arr = np.array(img, dtype=np.float32)

    crop_h = find_info_bar_crop(arr)
    arr = arr[:crop_h, :]
    print(f"Cropped info bar: kept rows 0:{crop_h} of {img.height}")

    # Upsample — source SEM thumbnails are often tiny; bicubic gives the
    # terrain mesh enough vertices to look like a surface, not a staircase.
    scale = 4
    cropped_img = Image.fromarray(arr.astype(np.uint8))
    upsampled = cropped_img.resize(
        (cropped_img.width * scale, cropped_img.height * scale), Image.BICUBIC
    )
    height_arr = np.array(upsampled, dtype=np.float32)

    # Denoise before using brightness as pseudo-height, so the SEM grain
    # noise doesn't turn into a jagged, nauseating terrain.
    height_arr = gaussian_filter(height_arr, sigma=2.0)

    # Normalize full range and encode as 16-bit for smoother displacement steps.
    height_arr -= height_arr.min()
    height_arr /= max(height_arr.max(), 1e-6)
    height_16 = (height_arr * 65535).astype(np.uint16)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(height_16, mode="I;16").save(OUT_DIR / f"{name}_height.png")

    # Texture: same crop, original resolution color/gray, no blur — keep it sharp.
    texture_src = Image.open(src_path).convert("RGB")
    texture_crop = texture_src.crop((0, 0, texture_src.width, crop_h))
    texture_crop.save(OUT_DIR / f"{name}_texture.jpg", quality=92)

    print(f"Wrote {OUT_DIR / f'{name}_height.png'} ({upsampled.size})")
    print(f"Wrote {OUT_DIR / f'{name}_texture.jpg'} ({texture_crop.size})")


if __name__ == "__main__":
    main()
