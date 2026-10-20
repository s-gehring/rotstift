import argparse
from pathlib import Path

from PIL import Image

JPEG_QUALITY = 90


def fit_within(width: int, height: int, max_edge: int, upscale: bool = False) -> tuple[int, int]:
    scale = max_edge / max(width, height)
    if not upscale:
        scale = min(1.0, scale)
    return max(1, round(width * scale)), max(1, round(height * scale))


def main() -> None:
    parser = argparse.ArgumentParser(description="Shrink page images like modelImage in src/llm/image.ts")
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--max-edge", type=int, required=True)
    parser.add_argument("--upscale", action="store_true", help="also enlarge smaller pages (bicubic)")
    args = parser.parse_args()
    args.target.mkdir(parents=True, exist_ok=True)
    for path in sorted(args.source.iterdir()):
        if path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
            continue
        with Image.open(path) as image:
            canvas = Image.new("RGB", image.size, "white")
            canvas.paste(image.convert("RGBA"), mask=image.convert("RGBA"))
            size = fit_within(*image.size, args.max_edge, args.upscale)
            enlarge = size[0] > image.size[0]
            method = Image.Resampling.BICUBIC if enlarge else Image.Resampling.BILINEAR
            resized = canvas.resize(size, method) if size != image.size else canvas
            resized.save(args.target / f"{path.stem}.jpg", "JPEG", quality=JPEG_QUALITY)


if __name__ == "__main__":
    main()
