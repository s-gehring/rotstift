import argparse
from pathlib import Path

from PIL import Image

JPEG_QUALITY = 90


def fit_within(width: int, height: int, max_edge: int) -> tuple[int, int]:
    scale = min(1.0, max_edge / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def main() -> None:
    parser = argparse.ArgumentParser(description="Shrink page images like modelImage in src/llm/image.ts")
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--max-edge", type=int, required=True)
    args = parser.parse_args()
    args.target.mkdir(parents=True, exist_ok=True)
    for path in sorted(args.source.iterdir()):
        if path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
            continue
        with Image.open(path) as image:
            canvas = Image.new("RGB", image.size, "white")
            canvas.paste(image.convert("RGBA"), mask=image.convert("RGBA"))
            size = fit_within(*image.size, args.max_edge)
            resized = canvas.resize(size, Image.Resampling.BILINEAR) if size != image.size else canvas
            resized.save(args.target / f"{path.stem}.jpg", "JPEG", quality=JPEG_QUALITY)


if __name__ == "__main__":
    main()
