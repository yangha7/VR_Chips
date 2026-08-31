#!/usr/bin/env python3
"""Turn a raw SEM/AFM image into a heightmap + texture pair for WebXR terrain.

Usage: python3 sem_to_heightmap.py <input_image> <output_name> [options]
Writes assets/processed/<output_name>_height.png (16-bit grayscale)
and assets/processed/<output_name>_texture.jpg (cropped color/gray source).

Options:
  --no-crop            Skip info-bar detection for already-cropped sources.
  --target-dim N        Output size on the longer side (default 2048).
  --plateau-radius N    Grayscale-dilation radius in px (default: proportional
                         to output width). Use a small value (1-2) or 0 to
                         preserve fine periodic texture instead of smoothing
                         it into flat-top plateaus -- appropriate for a real
                         line/space grating where the fine structure IS the
                         real periodicity, not shading noise to clean up.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import gaussian_filter, grey_dilation

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "processed"

# Cap output at this on its longer side, regardless of source resolution.
# Web thumbnails (a few hundred px) get upsampled toward this; real
# high-res SEM captures (thousands of px) get downsampled toward it --
# a fixed 4x upsample multiplier only made sense for the former and
# produced multi-thousand-pixel monsters for the latter, well past what a
# mobile GPU texture should be asked to hold.
DEFAULT_TARGET_MAX_DIM = 2048


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
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input_image")
    parser.add_argument("output_name")
    parser.add_argument("--no-crop", action="store_true")
    parser.add_argument("--target-dim", type=int, default=DEFAULT_TARGET_MAX_DIM)
    parser.add_argument("--plateau-radius", type=int, default=None)
    args = parser.parse_args()

    src_path = Path(args.input_image)
    name = args.output_name

    img = Image.open(src_path).convert("L")
    arr = np.array(img, dtype=np.float32)

    crop_h = img.height if args.no_crop else find_info_bar_crop(arr)
    arr = arr[:crop_h, :]
    print(f"Cropped info bar: kept rows 0:{crop_h} of {img.height}")

    # Scale toward target_dim -- upsampling tiny thumbnails, downsampling
    # real high-res captures. Either way this gives the terrain mesh a
    # consistent, sane vertex/texture budget regardless of source size.
    cropped_img = Image.fromarray(arr.astype(np.uint8))
    scale = args.target_dim / max(cropped_img.width, cropped_img.height)
    out_size = (round(cropped_img.width * scale), round(cropped_img.height * scale))
    upsampled = cropped_img.resize(out_size, Image.BICUBIC)
    height_arr = np.array(upsampled, dtype=np.float32)

    # Oblique SEM shots light the edge of a raised feature brightly and leave
    # the rest of its top surface a similar mid-gray to the trench floor —
    # using brightness as height directly turns those edges into thin knife
    # spikes rather than the flat-top ridges the real structure has. Grayscale
    # dilation spreads each bright edge into a plateau spanning roughly one
    # structure width, which reads as a walkable flat-top wall instead.
    # Sized relative to the output width so it scales with any source image
    # -- but override with --plateau-radius when the source has real fine
    # periodic structure you want preserved rather than smoothed away.
    plateau_radius = args.plateau_radius if args.plateau_radius is not None else max(2, round(upsampled.width * 0.007))
    if plateau_radius > 0:
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
    texture_upsampled = texture_crop.resize(out_size, Image.BICUBIC)
    texture_sharpened = texture_upsampled.filter(
        ImageFilter.UnsharpMask(radius=2, percent=120, threshold=2)
    )
    texture_sharpened.save(OUT_DIR / f"{name}_texture.jpg", quality=92)

    print(f"Wrote {OUT_DIR / f'{name}_height.png'} ({upsampled.size}), plateau_radius={plateau_radius}")
    print(f"Wrote {OUT_DIR / f'{name}_texture.jpg'} ({texture_sharpened.size})")


if __name__ == "__main__":
    main()
