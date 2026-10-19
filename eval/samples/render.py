import argparse
import hashlib
import random
import re
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONTS_COMMIT = "47d54ca1ebb14fd864695f1d39dc734f39017c33"
FONTS = {
    "grundschrift": ("ofl/playwritedegrund/PlaywriteDEGrund%5Bwght%5D.ttf", 40,
                     "47cc063ac4253f46e7e63eec0909004526db4eb863dce601e8632e4a37a72c86"),
    "schulausgangsschrift": ("ofl/playwritedesas/PlaywriteDESAS%5Bwght%5D.ttf", 40,
                             "5c66767e8db56ff661215964bd3372e8d87122a7a9259486d500d791fe328065"),
    "caveat": ("ofl/caveat/Caveat%5Bwght%5D.ttf", 54,
               "0bdb6b660482d31531b3945849fba5916b3ef8695da7024a9e6b9ee3c4157988"),
    "indieflower": ("ofl/indieflower/IndieFlower-Regular.ttf", 46,
                    "ccc94b22b156e9c5dfe50fd051f01b097600b252c24473e624bb43a143140a94"),
}

PAGE = (1240, 1754)
MARGIN_LEFT, MARGIN_RIGHT, TOP = 150, 80, 170
LINE_HEIGHT = 64
PAPER = (247, 246, 240)
RULING = (186, 200, 222)
MARGIN_LINE = (225, 160, 160)
INK = (28, 40, 115)
MARKUP = re.compile(r"\{([^{}|]*)\|[^{}|]*\|[RZG]\}")

HERE = Path(__file__).resolve().parent
CACHE = Path.home() / ".cache" / "rotstift" / "fonts"


def font_file(name: str) -> Path:
    path, _, sha256 = FONTS[name]
    target = CACHE / Path(path.replace("%5B", "[").replace("%5D", "]")).name
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != sha256:
        CACHE.mkdir(parents=True, exist_ok=True)
        url = f"https://raw.githubusercontent.com/google/fonts/{FONTS_COMMIT}/{path}"
        data = urllib.request.urlopen(url, timeout=60).read()
        if hashlib.sha256(data).hexdigest() != sha256:
            raise SystemExit(f"SHA256 mismatch for {url}")
        target.write_bytes(data)
    return target


def written_text(markup: str) -> str:
    return MARKUP.sub(lambda match: match.group(1), markup)


def layout(text: str, font: ImageFont.FreeTypeFont, width: int) -> list[list[str]]:
    lines: list[list[str]] = []
    space = font.getlength(" ")
    for paragraph_line in text.split("\n"):
        words = paragraph_line.split()
        current: list[str] = []
        used = 0.0
        for word in words:
            needed = font.getlength(word) + (space * 1.3 if current else 0)
            if current and used + needed > width:
                lines.append(current)
                current, used = [], 0.0
                needed = font.getlength(word)
            current.append(word)
            used += needed
        lines.append(current)
    return lines


def render(text: str, font_name: str, seed: int) -> Image.Image:
    rng = random.Random(seed)
    _, size, _ = FONTS[font_name]
    font_path = font_file(font_name)
    width = PAGE[0] - MARGIN_LEFT - MARGIN_RIGHT
    while True:
        font = ImageFont.truetype(str(font_path), size)
        lines = layout(text, font, width - 40)
        if TOP + len(lines) * LINE_HEIGHT < PAGE[1] - 60:
            break
        size -= 2

    page = Image.new("RGB", PAGE, PAPER)
    draw = ImageDraw.Draw(page)
    for row in range(TOP, PAGE[1] - 40, LINE_HEIGHT):
        draw.line([(0, row), (PAGE[0], row)], fill=RULING, width=2)
    draw.line([(MARGIN_LEFT - 30, 0), (MARGIN_LEFT - 30, PAGE[1])], fill=MARGIN_LINE, width=2)

    ink = Image.new("L", PAGE, 0)
    ink_draw = ImageDraw.Draw(ink)
    space = font.getlength(" ")
    for index, words in enumerate(lines):
        baseline = TOP + index * LINE_HEIGHT - 6 + rng.uniform(-3, 3)
        x = MARGIN_LEFT + rng.uniform(-6, 10)
        drift = rng.uniform(-0.012, 0.012)
        for word in words:
            word_font = font.font_variant(size=max(10, round(size * rng.uniform(0.94, 1.06))))
            y = baseline + drift * (x - MARGIN_LEFT) + rng.uniform(-2.5, 2.5)
            ink_draw.text((x, y), word, font=word_font, fill=rng.randint(215, 255), anchor="ls")
            x += word_font.getlength(word) + space * rng.uniform(1.0, 1.6)

    ink = ink.filter(ImageFilter.GaussianBlur(0.7))
    page.paste(Image.new("RGB", PAGE, INK), mask=ink)

    noise = Image.effect_noise(PAGE, 10).convert("RGB")
    page = Image.blend(page, noise, 0.06)
    page = page.rotate(rng.uniform(-0.8, 0.8), resample=Image.Resampling.BICUBIC, fillcolor=PAPER)
    return page.filter(ImageFilter.GaussianBlur(0.4))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=HERE / "rendered")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    texts = sorted((HERE / "texts").glob("*.txt"))
    for text_index, text_path in enumerate(texts):
        text = written_text(text_path.read_text(encoding="utf-8").strip())
        for font_index, font_name in enumerate(FONTS):
            image = render(text, font_name, seed=1000 * text_index + font_index)
            target = args.out / f"{text_path.stem}--{font_name}.jpg"
            image.save(target, quality=85)
            print(target.relative_to(HERE.parent.parent))


if __name__ == "__main__":
    main()
