import argparse
import hashlib
import json
import math
import random
import re
import urllib.request
from dataclasses import dataclass, replace
from pathlib import Path
from typing import NamedTuple

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

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
STRIKE_STYLES = ("line", "double", "scribble", "wave")


@dataclass(frozen=True)
class Paper:
    kind: str
    pitch: int
    step: int
    left: int
    right: int
    top: int
    through_margin: bool
    drawn: bool = True


PAPERS = {
    "liniert": Paper("lined", 47, 47, 177, 59, 150, False),
    "liniert-eng": Paper("lined", 41, 41, 148, 40, 140, True),
    "kariert": Paper("grid", 30, 60, 118, 59, 150, False),
}
RULINGS = {"blau": (150, 178, 222), "grau": (176, 176, 182), "kraeftig": (110, 150, 215)}
PENS = {"blau": ((28, 40, 115), (215, 255)), "schwarz": ((24, 24, 30), (215, 255)),
        "bleistift": ((96, 96, 104), (120, 175))}
TABLES = ((92, 70, 52), (176, 150, 118), (58, 60, 66), (204, 200, 190), (70, 96, 84))
LOOKS = ("scan", "photo")
BINDINGS = ("none", "spiral", "holes")
EFFECTS = ("rotation", "keystone", "bend", "table", "spine", "light", "shadow", "blur", "noise", "binding")

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
    if style == "wave":
        height = (bottom - top) * rng.uniform(0.1, 0.18)
        period = rng.uniform(22, 36)
        phase = rng.uniform(0, 2 * math.pi)
        steps = max(2, round((end - start) / 2))
        points = [(start + (end - start) * i / steps,
                   middle + height * math.sin(phase + 2 * math.pi * (end - start) * i / steps / period))
                  for i in range(steps + 1)]
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


class Rendered(NamedTuple):
    image: Image.Image
    struck: list[list[float]]
    styles: list[str]
    lines: list[dict]


def draw_paper(paper: Paper, ruling: str, rng: random.Random) -> Image.Image:
    page = Image.new("RGB", PAGE, (251, 250, 246))
    if not paper.drawn:
        return page
    draw = ImageDraw.Draw(page)
    shade = rng.uniform(0.75, 1.0)
    color = tuple(round(251 + (channel - 251) * shade) for channel in RULINGS[ruling])
    margin_color = (226, 150, 150) if ruling != "grau" else (196, 196, 200)
    left = 0 if paper.through_margin else paper.left
    right = PAGE[0] if paper.through_margin else PAGE[0] - paper.right
    bottom = PAGE[1] - 40
    for y in range(paper.top, bottom, paper.pitch):
        draw.line([(left, y), (right, y)], fill=color, width=2)
    if paper.kind == "grid":
        for x in range(paper.left, right, paper.pitch):
            draw.line([(x, paper.top), (x, bottom - (bottom - paper.top) % paper.pitch)], fill=color, width=2)
    if not paper.through_margin or paper.kind == "grid":
        draw.line([(paper.left, 0), (paper.left, PAGE[1])], fill=margin_color, width=3)
    if paper.right and not paper.through_margin:
        draw.line([(PAGE[0] - paper.right, 0), (PAGE[0] - paper.right, PAGE[1])], fill=margin_color, width=2)
    return page


def render(text: str, font_name: str, seed: int, paper: Paper | None = None, pen: str = "blau",
           ruling: str = "blau", base: Image.Image | None = None) -> Rendered:
    rng = random.Random(seed)
    _, size, _ = FONTS[font_name]
    font_path = font_file(font_name)
    ink_color, ink_range = PENS[pen] if paper else (INK, (215, 255))
    top, step = (TOP, LINE_HEIGHT) if paper is None else (paper.top, paper.step)
    text_left = MARGIN_LEFT if paper is None else paper.left + 18
    text_right = PAGE[0] - (MARGIN_RIGHT if paper is None else paper.right + 8)
    jitter = 3 if paper is None else 2
    if paper is not None:
        size = round(size * step / LINE_HEIGHT * 1.12)
    width = text_right - text_left
    rows = step // (paper.pitch if paper else step)

    def baseline_of(index: int) -> float:
        if paper is None:
            return top + index * step - 6
        return top + (index + 1) * rows * paper.pitch - 5

    while True:
        font = ImageFont.truetype(str(font_path), size)
        lines = layout(text, font, width - 40)
        if (top + len(lines) * step if paper is None else baseline_of(len(lines) - 1)) < PAGE[1] - 60:
            break
        size -= 2

    if paper is None:
        page = Image.new("RGB", PAGE, PAPER)
        draw = ImageDraw.Draw(page)
        for row in range(TOP, PAGE[1] - 40, LINE_HEIGHT):
            draw.line([(0, row), (PAGE[0], row)], fill=RULING, width=2)
        draw.line([(MARGIN_LEFT - 30, 0), (MARGIN_LEFT - 30, PAGE[1])], fill=MARGIN_LINE, width=2)
    else:
        page = draw_paper(paper, ruling, rng) if base is None else base.copy()

    ink = Image.new("L", PAGE, 0)
    ink_draw = ImageDraw.Draw(ink)
    space = font.getlength(" ")
    strikes = seed
    struck: list[tuple[float, float, float, float]] = []
    styles: list[str] = []
    extents: list[tuple[float, float, float, float] | None] = []
    for index, words in enumerate(lines):
        baseline = baseline_of(index) + rng.uniform(-jitter, jitter)
        x = text_left + rng.uniform(-6, 10)
        drift = rng.uniform(-0.012, 0.012)
        extent: tuple[float, float, float, float] | None = None
        for word in words:
            word_font = font.font_variant(size=max(10, round(size * rng.uniform(0.94, 1.06))))
            y = baseline + drift * (x - text_left) + rng.uniform(-2.5, 2.5)
            shown = plain(word)
            ink_draw.text((x, y), shown, font=word_font, fill=rng.randint(*ink_range), anchor="ls")
            left, word_top, right, bottom = ink_draw.textbbox((x, y), shown, font=word_font, anchor="ls")
            extent = (left, word_top, right, bottom) if extent is None else (
                min(extent[0], left), min(extent[1], word_top), max(extent[2], right), max(extent[3], bottom))
            if shown != word:
                _, top_of_x, _, _ = ink_draw.textbbox((x, y), "x", font=word_font, anchor="ls")
                box = (x, top_of_x, x + word_font.getlength(shown), y)
                styles.append(STRIKE_STYLES[strikes % len(STRIKE_STYLES)])
                struck.append(draw_strike(ink_draw, box, styles[-1], rng))
                strikes += 1
            x += word_font.getlength(shown) + space * rng.uniform(1.0, 1.6)
        extents.append(extent)

    ink = ink.filter(ImageFilter.GaussianBlur(0.7))
    page.paste(Image.new("RGB", PAGE, ink_color), mask=ink)
    texts = [" ".join(plain(word) for word in words) for words in lines]
    if paper is not None:
        return Rendered(page, [list(box) for box in struck], styles, line_truth(texts, extents))

    noise = Image.effect_noise(PAGE, 10).convert("RGB")
    page = Image.blend(page, noise, 0.06)
    angle = rng.uniform(-0.8, 0.8)
    page = page.rotate(angle, resample=Image.Resampling.BICUBIC, fillcolor=PAPER)
    boxes = [rotated_box(box, angle) for box in struck]
    truth = line_truth(texts, [None if box is None else tuple(rotated_box(box, angle)) for box in extents])
    return Rendered(page.filter(ImageFilter.GaussianBlur(0.4)), boxes, styles, truth)


def line_truth(texts: list[str], extents: list) -> list[dict]:
    return [{"text": text, "bbox": None if box is None or not text else
             [round(box[0], 1), round(box[1], 1), round(box[2] - box[0], 1), round(box[3] - box[1], 1)]}
            for text, box in zip(texts, extents)]


def rotated_box(box: tuple[float, float, float, float], angle: float) -> list[float]:
    center_x, center_y = PAGE[0] / 2, PAGE[1] / 2
    cos, sin = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    corners = [(x, y) for x in (box[0], box[2]) for y in (box[1], box[3])]
    xs = [center_x + (x - center_x) * cos + (y - center_y) * sin for x, y in corners]
    ys = [center_y - (x - center_x) * sin + (y - center_y) * cos for x, y in corners]
    return [round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)]


def homography(source: list[tuple[float, float]], target: list[tuple[float, float]]) -> list[float]:
    rows = []
    for (x, y), (u, v) in zip(source, target):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y, v])
    for column in range(8):
        pivot = max(range(column, 8), key=lambda row: abs(rows[row][column]))
        rows[column], rows[pivot] = rows[pivot], rows[column]
        rows[column] = [value / rows[column][column] for value in rows[column]]
        for row in range(8):
            if row != column:
                factor = rows[row][column]
                rows[row] = [a - factor * b for a, b in zip(rows[row], rows[column])]
    return [rows[row][8] for row in range(8)]


def project(coefficients: list[float], point: tuple[float, float]) -> tuple[float, float]:
    a, b, c, d, e, f, g, h = coefficients
    x, y = point
    scale = g * x + h * y + 1
    return ((a * x + b * y + c) / scale, (d * x + e * y + f) / scale)


def box_corners(box: list[float]) -> list[tuple[float, float]]:
    x, y, width, height = box
    return [(x, y), (x + width, y), (x + width, y + height), (x, y + height)]


def bounding(points: list[tuple[float, float]]) -> list[float]:
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return [round(min(xs), 1), round(min(ys), 1), round(max(xs) - min(xs), 1), round(max(ys) - min(ys), 1)]


def shade(size: tuple[int, int], angle: float, low: float, high: float) -> Image.Image:
    gradient = Image.linear_gradient("L").rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    side = max(size)
    gradient = gradient.resize((side * 2, side * 2), Image.Resampling.BILINEAR)
    left, top = (gradient.width - size[0]) // 2, (gradient.height - size[1]) // 2
    gradient = gradient.crop((left, top, left + size[0], top + size[1]))
    return gradient.point(lambda value: round(255 * (low + (high - low) * value / 255)))


def bind(canvas: Image.Image, binding: str, origin: tuple[int, int], rng: random.Random) -> None:
    draw = ImageDraw.Draw(canvas)
    left = origin[0]
    if binding == "spiral":
        for y in range(origin[1] + 60, origin[1] + PAGE[1] - 30, 80):
            draw.ellipse([left + 12, y - 9, left + 32, y + 9], fill=(48, 44, 42))
            draw.arc([left - 44, y - 16, left + 28, y + 16], 200, 520, fill=(150, 152, 158), width=7)
            draw.arc([left - 40, y - 12, left + 24, y + 8], 240, 330, fill=(236, 238, 242), width=2)
    if binding == "holes":
        for fraction in (0.27, 0.73):
            y = origin[1] + round(PAGE[1] * fraction)
            draw.ellipse([left + 30, y - 18, left + 66, y + 18], fill=(40, 36, 34))
            draw.arc([left + 28, y - 20, left + 68, y + 20], 20, 160, fill=(120, 116, 110), width=3)


def photograph(page: Image.Image, lines: list[dict], seed: int, binding: str, effects: frozenset[str],
               edge_points: list[tuple[float, float]]) -> tuple[Image.Image, list[dict], int, list[list[float]]]:
    rng = random.Random(seed)
    pad = 110
    table = rng.choice(TABLES) if "table" in effects else (251, 250, 246)
    size = (PAGE[0] + 2 * pad, PAGE[1] + 2 * pad)
    canvas = Image.new("RGB", size, table)
    if "table" in effects:
        canvas = Image.blend(canvas, Image.effect_noise(size, 18).convert("RGB"), 0.12)
    canvas.paste(page.copy(), (pad, pad))
    spine = Image.new("L", PAGE, 0)
    ImageDraw.Draw(spine).rectangle([0, 0, 90, PAGE[1]], fill=rng.randint(40, 90))
    spine = spine.filter(ImageFilter.GaussianBlur(40))
    if "spine" in effects:
        canvas.paste(Image.new("RGB", PAGE, (20, 20, 20)), (pad, pad), spine)
    if "binding" in effects:
        bind(canvas, binding, (pad, pad), rng)

    amplitude = rng.uniform(5, 22) if "bend" in effects else 0.0
    curve_at = rng.uniform(0.0, 0.35)

    def drop(x: float) -> float:
        return amplitude * (1 - min(1.0, max(0.0, (x / size[0] - curve_at) / (1 - curve_at)))) ** 2

    cell = 40
    mesh = []
    for x0 in range(0, size[0], cell):
        x1 = min(x0 + cell, size[0])
        mesh.append(((x0, 0, x1, size[1]),
                     (x0, -drop(x0), x0, size[1] - drop(x0), x1, size[1] - drop(x1), x1, -drop(x1))))
    canvas = canvas.transform(size, Image.Transform.MESH, mesh, Image.Resampling.BICUBIC, fillcolor=table)

    angle = math.radians(rng.uniform(-3.5, 3.5)) if "rotation" in effects else 0.0
    cx, cy = size[0] / 2, size[1] / 2
    corners = [(0.0, 0.0), (size[0], 0.0), (size[0], size[1]), (0.0, size[1])]
    out_width = 1440
    out_height = round(out_width * size[1] / size[0])
    jitter_x, jitter_y = (0.05 * out_width, 0.035 * out_height) if "keystone" in effects else (0.0, 0.0)
    target = []
    for x, y in corners:
        rx = cx + (x - cx) * math.cos(angle) - (y - cy) * math.sin(angle)
        ry = cy + (x - cx) * math.sin(angle) + (y - cy) * math.cos(angle)
        target.append((rx * out_width / size[0] + rng.uniform(-jitter_x, jitter_x),
                       ry * out_height / size[1] + rng.uniform(-jitter_y, jitter_y)))
    forward = homography(corners, target)
    inverse = homography(target, corners)
    canvas = canvas.transform((out_width, out_height), Image.Transform.PERSPECTIVE, inverse,
                              Image.Resampling.BICUBIC, fillcolor=table)

    moved = []
    for line in lines:
        if line["bbox"] is None:
            moved.append(line)
            continue
        points = [(x + pad, y + pad + drop(x + pad)) for x, y in box_corners(line["bbox"])]
        moved.append({"text": line["text"], "bbox": bounding([project(forward, point) for point in points])})

    edges = [[round(v, 1) for v in project(forward, (x + pad, y + pad + drop(x + pad)))] for x, y in edge_points]
    light = shade(canvas.size, rng.uniform(0, 360), rng.uniform(0.72, 0.92), rng.uniform(1.0, 1.1))
    if "light" in effects:
        canvas = ImageChops.multiply(canvas, Image.merge("RGB", (light,) * 3))
    if rng.random() < 0.7 and "shadow" in effects:
        blob = Image.new("L", canvas.size, 255)
        bx, by = rng.uniform(0, canvas.width), rng.uniform(0, canvas.height)
        radius = rng.uniform(0.25, 0.5) * canvas.width
        ImageDraw.Draw(blob).ellipse([bx - radius, by - radius * 1.4, bx + radius, by + radius * 1.4],
                                     fill=rng.randint(150, 215))
        canvas = ImageChops.multiply(canvas, Image.merge("RGB", (blob.filter(ImageFilter.GaussianBlur(radius / 2)),) * 3))
    warmth = rng.uniform(-0.06, 0.06)
    if "light" in effects:
        red, green, blue = canvas.split()
        red = red.point(lambda value: min(255, round(value * (1 + warmth))))
        blue = blue.point(lambda value: min(255, round(value * (1 - warmth))))
        canvas = Image.merge("RGB", (red, green, blue))
        canvas = Image.blend(canvas, Image.new("RGB", canvas.size, (128, 128, 128)), rng.uniform(0.0, 0.12))
    blur = rng.uniform(0.7, 1.6)
    if "blur" in effects:
        canvas = canvas.filter(ImageFilter.GaussianBlur(blur))
    grain = rng.uniform(0.04, 0.09)
    if "noise" in effects:
        canvas = Image.blend(canvas, Image.effect_noise(canvas.size, 14).convert("RGB"), grain)
    return canvas, moved, rng.randint(55, 80), edges


def scan(page: Image.Image, lines: list[dict], seed: int,
         edge_points: list[tuple[float, float]]) -> tuple[Image.Image, list[dict], int, list[list[float]]]:
    rng = random.Random(seed)
    angle = rng.uniform(-0.9, 0.9)
    page = page.rotate(angle, resample=Image.Resampling.BICUBIC, fillcolor=(236, 236, 234))
    moved = []
    for line in lines:
        if line["bbox"] is None:
            moved.append(line)
            continue
        x, y, width, height = line["bbox"]
        x0, y0, x1, y1 = rotated_box((x, y, x + width, y + height), angle)
        moved.append({"text": line["text"], "bbox": [x0, y0, round(x1 - x0, 1), round(y1 - y0, 1)]})
    if rng.random() < 0.6:
        edge = Image.new("L", page.size, 0)
        ImageDraw.Draw(edge).rectangle([0, 0, rng.randint(20, 60), page.height], fill=rng.randint(30, 80))
        page.paste(Image.new("RGB", page.size, (30, 30, 30)), mask=edge.filter(ImageFilter.GaussianBlur(25)))
    page = Image.blend(page, Image.effect_noise(page.size, 10).convert("RGB"), 0.06)
    edges = [rotated_box((x, y, x, y), angle)[:2] for x, y in edge_points]
    return page.filter(ImageFilter.GaussianBlur(0.5)), moved, 85, edges


def load_paper(path: Path) -> Image.Image:
    with Image.open(path) as source:
        image = source.convert("RGB")
    scale = max(PAGE[0] / image.width, PAGE[1] / image.height)
    image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left, top = (image.width - PAGE[0]) // 2, (image.height - PAGE[1]) // 2
    return image.crop((left, top, left + PAGE[0], top + PAGE[1]))


def render_heft(out: Path, only: set[str], strike: int, seed: int, paper_image: Path | None = None,
                geometry: tuple[int, int, int] | None = None, effects: frozenset[str] = frozenset(EFFECTS)) -> None:
    for sub in ("images", "ground_truth", "markup", "lines"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    fonts, pens, rulings = list(FONTS), list(PENS), list(RULINGS)
    texts = sorted((HERE / "texts").glob("*.txt"))
    count = 0
    papers = dict(PAPERS)
    base = None
    if paper_image is not None:
        base = load_paper(paper_image)
        top, pitch, left = geometry or (PAPERS["liniert"].top, PAPERS["liniert"].pitch, PAPERS["liniert"].left)
        papers = {paper_image.stem: Paper("lined", pitch, pitch, left, PAPERS["liniert"].right, top, False, drawn=False)}
    for paper_index, (paper_name, paper) in enumerate(papers.items()):
        for look_index, look in enumerate(LOOKS):
            for text_index, text_path in enumerate(texts):
                variant = paper_index + 3 * look_index + text_index
                name = f"{text_path.stem}--{paper_name}-{look}"
                if only and paper_name not in only and look not in only:
                    continue
                markup = text_path.read_text(encoding="utf-8").strip()
                text = written_text(markup)
                page_seed = 7000 + 100 * paper_index + 10 * look_index + text_index + 1000 * seed
                page_text = strike_words(text, strike, random.Random(page_seed)) if strike else text
                font_name = fonts[variant % len(fonts)]
                pen = "bleistift" if variant % 7 == 6 else pens[variant % 2]
                rendered = render(page_text, font_name, page_seed, paper, pen, rulings[variant % 3], base)
                binding = BINDINGS[(variant % 3)] if look == "photo" else "none"
                rand = [(paper.left, 0), (paper.left, PAGE[1]), (PAGE[0] - paper.right, 0), (PAGE[0] - paper.right, PAGE[1])]
                if look == "photo":
                    image, lines, quality, edges = photograph(rendered.image, rendered.lines, page_seed, binding, effects, rand)
                else:
                    image, lines, quality, edges = scan(rendered.image, rendered.lines, page_seed, rand)
                image.save(out / "images" / f"{name}.jpg", quality=quality)
                (out / "ground_truth" / f"{name}.txt").write_text(page_text + "\n", encoding="utf-8")
                (out / "markup" / f"{name}.txt").write_text(markup + "\n", encoding="utf-8")
                meta = {"paper": paper_name, "look": look, "font": font_name, "pen": pen, "binding": binding,
                        "size": list(image.size), "margin": {"left": edges[:2], "right": edges[2:] if paper.right else None},
                        "lines": lines}
                (out / "lines" / f"{name}.json").write_text(json.dumps(meta, ensure_ascii=False) + "\n", encoding="utf-8")
                count += 1
                print(out / "images" / f"{name}.jpg")
    print(f"{count} pages")


def render_class(out: Path) -> None:
    fonts = list(FONTS)
    for index, path in enumerate(sorted((HERE / "content-form").glob("*.txt"))):
        body = path.read_text(encoding="utf-8").split("\n---\n", 1)[1].strip().split("\n")
        half = (len(body) + 1) // 2
        for part, lines in enumerate((body[:half], body[half:]), start=1):
            image, *_ = render(written_text("\n".join(lines)), fonts[index % len(fonts)], seed=100 * index + part)
            target = out / f"{path.stem}-{part}.jpg"
            image.save(target, quality=85)
            print(target)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=HERE / "rendered")
    parser.add_argument("--strike", type=int, default=0)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--content-form", action="store_true")
    parser.add_argument("--lines", action="store_true")
    parser.add_argument("--heft", nargs="*", metavar="FILTER")
    parser.add_argument("--effects", default=",".join(EFFECTS))
    parser.add_argument("--paper-image", type=Path)
    parser.add_argument("--paper-geometry", nargs=3, type=int, metavar=("TOP", "PITCH", "LEFT"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    if args.heft is not None:
        render_heft(args.out, set(args.heft), args.strike, args.seed, args.paper_image,
                    tuple(args.paper_geometry) if args.paper_geometry else None,
                    frozenset(filter(None, args.effects.split(","))))
        return
    if args.content_form:
        render_class(args.out)
        return
    texts = sorted((HERE / "texts").glob("*.txt"))
    for text_index, text_path in enumerate(texts):
        text = written_text(text_path.read_text(encoding="utf-8").strip())
        for font_index, font_name in enumerate(FONTS):
            seed = 1000 * text_index + font_index + 10 * args.seed
            page_text = strike_words(text, args.strike, random.Random(seed)) if args.strike else text
            image, struck, styles, lines = render(page_text, font_name, seed=seed)
            target = args.out / f"{text_path.stem}--{font_name}.jpg"
            image.save(target, quality=85)
            if args.lines:
                (args.out / "lines").mkdir(exist_ok=True)
                meta = {"size": list(image.size), "lines": lines}
                (args.out / "lines" / f"{target.stem}.json").write_text(json.dumps(meta, ensure_ascii=False) + "\n", encoding="utf-8")
                (args.out / "ground_truth").mkdir(exist_ok=True)
                (args.out / "ground_truth" / f"{target.stem}.txt").write_text(page_text + "\n", encoding="utf-8")
            if args.strike:
                target.with_suffix(".txt").write_text(page_text + "\n", encoding="utf-8")
                boxes = {"width": PAGE[0], "height": PAGE[1], "boxes": struck, "styles": styles}
                target.with_suffix(".strikes.json").write_text(json.dumps(boxes) + "\n", encoding="utf-8")
            print(target)


if __name__ == "__main__":
    main()
