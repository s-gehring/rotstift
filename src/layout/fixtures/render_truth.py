import argparse
import importlib.util
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
EVAL_SAMPLES = HERE.parents[2] / "eval" / "samples"

spec = importlib.util.spec_from_file_location("render", EVAL_SAMPLES / "render.py")
render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)

THRESHOLD = 40


def truth_boxes(text: str, font_name: str, seed: int):
    rng = random.Random(seed)
    _, size, _ = render.FONTS[font_name]
    font_path = render.font_file(font_name)
    width = render.PAGE[0] - render.MARGIN_LEFT - render.MARGIN_RIGHT
    while True:
        font = ImageFont.truetype(str(font_path), size)
        lines = render.layout(text, font, width - 40)
        if render.TOP + len(lines) * render.LINE_HEIGHT < render.PAGE[1] - 60:
            break
        size -= 2

    masks = []
    space = font.getlength(" ")
    for index, words in enumerate(lines):
        mask = Image.new("L", render.PAGE, 0)
        mask_draw = ImageDraw.Draw(mask)
        baseline = render.TOP + index * render.LINE_HEIGHT - 6 + rng.uniform(-3, 3)
        x = render.MARGIN_LEFT + rng.uniform(-6, 10)
        drift = rng.uniform(-0.012, 0.012)
        for word in words:
            word_font = font.font_variant(size=max(10, round(size * rng.uniform(0.94, 1.06))))
            y = baseline + drift * (x - render.MARGIN_LEFT) + rng.uniform(-2.5, 2.5)
            _ = rng.randint(215, 255)
            mask_draw.text((x, y), word, font=word_font, fill=255, anchor="ls")
            x += word_font.getlength(word) + space * rng.uniform(1.0, 1.6)
        masks.append(mask)

    angle = rng.uniform(-0.8, 0.8)
    result = []
    for words, mask in zip(lines, masks):
        mask = mask.filter(ImageFilter.GaussianBlur(0.7))
        mask = mask.rotate(angle, resample=Image.Resampling.BICUBIC, fillcolor=0)
        box = mask.point(lambda v: 255 if v >= THRESHOLD else 0).getbbox()
        if not words or box is None:
            result.append({"text": "", "bbox": None})
        else:
            x0, y0, x1, y1 = box
            result.append({"text": " ".join(words), "bbox": [x0, y0, x1 - x0, y1 - y0]})
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=HERE / "rendered-truth.json")
    args = parser.parse_args()
    pages = {}
    for text_index, text_path in enumerate(sorted((EVAL_SAMPLES / "texts").glob("*.txt"))):
        text = render.written_text(text_path.read_text(encoding="utf-8").strip())
        for font_index, font_name in enumerate(render.FONTS):
            pages[f"{text_path.stem}--{font_name}"] = truth_boxes(
                text, font_name, seed=1000 * text_index + font_index
            )
    args.out.write_text(json.dumps(pages, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
