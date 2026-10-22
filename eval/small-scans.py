import argparse
from pathlib import Path

from PIL import Image

JPEG_QUALITY = 90
MODEL_EDGE = 1152


def flat(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    canvas = Image.new("RGB", image.size, "white")
    canvas.paste(rgba, mask=rgba)
    return canvas


def to_model_edge(image: Image.Image, upscale: bool) -> Image.Image:
    scale = MODEL_EDGE / max(image.size)
    if scale >= 1 and not upscale:
        return image
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    method = Image.Resampling.BICUBIC if scale > 1 else Image.Resampling.BILINEAR
    return image.resize(size, method)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Make low-resolution variants of page scans and the model input with and without enlargement"
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--widths", default="500,700,900")
    parser.add_argument("--pages", help="comma separated file stems; default all")
    args = parser.parse_args()
    wanted = args.pages.split(",") if args.pages else None
    for width in (int(w) for w in args.widths.split(",")):
        for variant in ("before", "after"):
            (args.target / f"w{width}" / variant).mkdir(parents=True, exist_ok=True)
        for path in sorted(args.source.iterdir()):
            if path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                continue
            if wanted and path.stem not in wanted:
                continue
            with Image.open(path) as original:
                page = flat(original)
            if page.width > width:
                page = page.resize((width, round(page.height * width / page.width)), Image.Resampling.LANCZOS)
            for variant, upscale in (("before", False), ("after", True)):
                to_model_edge(page, upscale).save(
                    args.target / f"w{width}" / variant / f"{path.stem}.jpg", "JPEG", quality=JPEG_QUALITY
                )


if __name__ == "__main__":
    main()
