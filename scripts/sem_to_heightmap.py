#!/usr/bin/env python3
"""Turn a raw SEM/AFM image into a heightmap + texture pair for WebXR terrain.

Usage: python3 sem_to_heightmap.py <input_image> <output_name>
Writes assets/processed/<output_name>_height.png (16-bit grayscale)
and assets/processed/<output_name>_texture.jpg (cropped color/gray source).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import gaussian_filter, grey_dilation

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

    # Oblique SEM shots light the edge of a raised feature brightly and leave
    # the rest of its top surface a similar mid-gray to the trench floor —
    # using brightness as height directly turns those edges into thin knife
    # spikes rather than the flat-top ridges the real structure has. Grayscale
    # dilation spreads each bright edge into a plateau spanning roughly one
    # structure width, which reads as a walkable flat-top wall instead.
    plateau_radius = 6  # ~ half a comb-finger width at this upsample scale
    height_arr = grey_dilation(height_arr, size=(plateau_radius * 2 + 1,) * 2)

    # Light final smoothing to soften the plateau's corners — this is just
    # anti-aliasing, not the main shaping step, so keep it small.
    height_arr = gaussian_filter(height_arr, sigma=1.0)

    # Normalize full range and encode as 16-bit for smoother displacement steps.
    height_arr -= height_arr.min()
    height_arr /= max(height_arr.max(), 1e-6)
    height_16 = (height_arr * 65535).astype(np.uint16)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(height_16, mode="I;16").save(OUT_DIR / f"{name}_height.png")

    # Texture: same crop, upscaled and mildly sharpened. This can't add real
    # detail beyond the source resolution, but it keeps edges crisper than a
    # plain bicubic stretch would once it's wrapped over many meters of terrain.
    texture_src = Image.open(src_path).convert("RGB")
    texture_crop = texture_src.crop((0, 0, texture_src.width, crop_h))
    texture_upsampled = texture_crop.resize(
        (texture_crop.width * scale, texture_crop.height * scale), Image.BICUBIC
    )
    texture_sharpened = texture_upsampled.filter(
        ImageFilter.UnsharpMask(radius=2, percent=120, threshold=2)
    )
    texture_sharpened.save(OUT_DIR / f"{name}_texture.jpg", quality=92)

    print(f"Wrote {OUT_DIR / f'{name}_height.png'} ({upsampled.size})")
    print(f"Wrote {OUT_DIR / f'{name}_texture.jpg'} ({texture_sharpened.size})")


if __name__ == "__main__":
    main()
