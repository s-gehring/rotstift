import argparse
import hashlib
import json
import math
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
STRUCK = re.compile(r"^~~(.+)~~$")
STRIKE_STYLES = ("line", "double", "scribble")

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


def plain(word: str) -> str:
    match = STRUCK.match(word)
    return match.group(1) if match else word


def misspell(word: str, rng: random.Random) -> str:
    if len(word) < 4:
        return word[:-1] or word
    at = rng.randrange(1, len(word) - 1)
    return word[:at] + word[at + 1:] if rng.random() < 0.5 else word[:at] + word[at + 1] + word[at] + word[at + 2:]


def strike_words(text: str, count: int, rng: random.Random) -> str:
    lines = [line.split() for line in text.split("\n")]
    slots = [(row, col) for row, words in enumerate(lines) for col in range(len(words)) if row or col]
    pool = [re.sub(r"\W", "", word) for words in lines for word in words]
    pool = [word for word in pool if 2 <= len(word) <= 8]
    for row, col in sorted(rng.sample(slots, min(count, len(slots))), reverse=True):
        following = re.sub(r"\W", "", lines[row][col])
        if len(following) >= 4 and rng.random() < 0.5:
            struck = misspell(following, rng)
        else:
            struck = rng.choice(pool)
        lines[row].insert(col, f"~~{struck}~~")
    return "\n".join(" ".join(words) for words in lines)


def draw_strike(draw: ImageDraw.ImageDraw, box: tuple[float, float, float, float], style: str,
                rng: random.Random) -> tuple[float, float, float, float]:
    left, top, right, bottom = box
    middle = top + (bottom - top) * rng.uniform(0.45, 0.6)
    fill = rng.randint(220, 255)
    width = rng.choice((3, 4))
    start, end = left - rng.uniform(2, 8), right + rng.uniform(2, 8)
    if style == "scribble":
        height = (bottom - top) * 0.3
        step = rng.uniform(7, 11)
        points, x, up = [], start, True
        while x < end:
            points.append((x, middle + (-height if up else height) + rng.uniform(-2, 2)))
            x, up = x + step, not up
        draw.line(points, fill=fill, width=width, joint="curve")
        return (start, top, end, bottom)
    tilt = rng.uniform(-4, 4)
    offsets = (-0.12, 0.12) if style == "double" else (0.0,)
    for offset in offsets:
        y = middle + offset * (bottom - top)
        draw.line([(start, y - tilt), (end, y + tilt)], fill=fill, width=width)
    return (start, top, end, bottom)


def layout(text: str, font: ImageFont.FreeTypeFont, width: int) -> list[list[str]]:
    lines: list[list[str]] = []
    space = font.getlength(" ")
    for paragraph_line in text.split("\n"):
        words = paragraph_line.split()
        current: list[str] = []
        used = 0.0
        for word in words:
            needed = font.getlength(plain(word)) + (space * 1.3 if current else 0)
            if current and used + needed > width:
                lines.append(current)
                current, used = [], 0.0
                needed = font.getlength(plain(word))
            current.append(word)
            used += needed
        lines.append(current)
    return lines


def render(text: str, font_name: str, seed: int) -> tuple[Image.Image, list[list[float]]]:
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
    strikes = seed
    struck: list[tuple[float, float, float, float]] = []
    for index, words in enumerate(lines):
        baseline = TOP + index * LINE_HEIGHT - 6 + rng.uniform(-3, 3)
        x = MARGIN_LEFT + rng.uniform(-6, 10)
        drift = rng.uniform(-0.012, 0.012)
        for word in words:
            word_font = font.font_variant(size=max(10, round(size * rng.uniform(0.94, 1.06))))
            y = baseline + drift * (x - MARGIN_LEFT) + rng.uniform(-2.5, 2.5)
            shown = plain(word)
            ink_draw.text((x, y), shown, font=word_font, fill=rng.randint(215, 255), anchor="ls")
            if shown != word:
                _, top, _, _ = ink_draw.textbbox((x, y), "x", font=word_font, anchor="ls")
                box = (x, top, x + word_font.getlength(shown), y)
                struck.append(draw_strike(ink_draw, box, STRIKE_STYLES[strikes % len(STRIKE_STYLES)], rng))
                strikes += 1
            x += word_font.getlength(shown) + space * rng.uniform(1.0, 1.6)

    ink = ink.filter(ImageFilter.GaussianBlur(0.7))
    page.paste(Image.new("RGB", PAGE, INK), mask=ink)

    noise = Image.effect_noise(PAGE, 10).convert("RGB")
    page = Image.blend(page, noise, 0.06)
    angle = rng.uniform(-0.8, 0.8)
    page = page.rotate(angle, resample=Image.Resampling.BICUBIC, fillcolor=PAPER)
    return page.filter(ImageFilter.GaussianBlur(0.4)), [rotated_box(box, angle) for box in struck]


def rotated_box(box: tuple[float, float, float, float], angle: float) -> list[float]:
    center_x, center_y = PAGE[0] / 2, PAGE[1] / 2
    cos, sin = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    corners = [(x, y) for x in (box[0], box[2]) for y in (box[1], box[3])]
    xs = [center_x + (x - center_x) * cos + (y - center_y) * sin for x, y in corners]
    ys = [center_y - (x - center_x) * sin + (y - center_y) * cos for x, y in corners]
    return [round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=HERE / "rendered")
    parser.add_argument("--strike", type=int, default=0)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    texts = sorted((HERE / "texts").glob("*.txt"))
    for text_index, text_path in enumerate(texts):
        text = written_text(text_path.read_text(encoding="utf-8").strip())
        for font_index, font_name in enumerate(FONTS):
            seed = 1000 * text_index + font_index
            page_text = strike_words(text, args.strike, random.Random(seed)) if args.strike else text
            image, struck = render(page_text, font_name, seed=seed)
            target = args.out / f"{text_path.stem}--{font_name}.jpg"
            image.save(target, quality=85)
            if args.strike:
                target.with_suffix(".txt").write_text(page_text + "\n", encoding="utf-8")
                boxes = {"width": PAGE[0], "height": PAGE[1], "boxes": struck}
                target.with_suffix(".strikes.json").write_text(json.dumps(boxes) + "\n", encoding="utf-8")
            print(target)


if __name__ == "__main__":
    main()
