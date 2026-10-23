import argparse
import io
import json
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


import render as r

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / "src" / "pipeline" / "demo-class"
SPAN = re.compile(r"\{([^{}|]*)\|([^{}|]*)\|[RZG]\}")
JPEG_QUALITY = 72

# name, paper, font, pen, ruling, text file, split after paragraph (None = one page), strikes
ARBEITEN = [
    ("Lena Ferien", "liniert", "schulausgangsschrift", "blau", "blau", "ferien", None, 2),
    ("Ben Handys", "kariert", "grundschrift", "blau", "grau", "handy", None, 2),
    ("Mia Brief", "liniert", "indieflower", "schwarz", "blau", "brief", 3, 1),
    ("Jonas Inhaltsangabe", "kariert", "schulausgangsschrift", "schwarz", "kraeftig", "inhaltsangabe", None, 2),
]


def word_pairs(markup: str) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    wrong_word = right_word = ""

    def flush() -> None:
        nonlocal wrong_word, right_word
        if wrong_word:
            pairs.append((wrong_word, right_word))
        wrong_word = right_word = ""

    cursor = 0
    for match in SPAN.finditer(markup):
        for char in markup[cursor:match.start()]:
            if char.isspace():
                flush()
            else:
                wrong_word, right_word = wrong_word + char, right_word + char
        wrong, right = match.group(1).split(" "), match.group(2).split(" ")
        for index, part in enumerate(wrong):
            if index:
                flush()
            if len(wrong) == len(right):
                wrong_word, right_word = wrong_word + part, right_word + right[index]
            else:
                wrong_word += part
                right_word += match.group(2) if index == 0 else ""
        cursor = match.end()
    for char in markup[cursor:]:
        if char.isspace():
            flush()
        else:
            wrong_word, right_word = wrong_word + char, right_word + char
    flush()
    return pairs


def page_lines(lines_meta: list[dict], tokens: list[str], pairs: list[tuple[str, str]]) -> tuple[list[str], list[str]]:
    transcript: list[str] = []
    corrected: list[str] = []
    token_index = pair_index = 0
    for line in lines_meta:
        count = len(line["text"].split())
        shown: list[str] = []
        fixed: list[str] = []
        for token in tokens[token_index:token_index + count]:
            shown.append(token)
            if token.startswith("~~"):
                continue
            wrong, right = pairs[pair_index]
            if wrong != token:
                raise SystemExit(f"Wort {token!r} passt nicht zu {wrong!r}")
            pair_index += 1
            if right:
                fixed.append(right)
        token_index += count
        transcript.append(" ".join(shown))
        corrected.append(" ".join(fixed))
    if token_index != len(tokens) or pair_index != len(pairs):
        raise SystemExit("Zeilen und Text passen nicht zusammen")
    return transcript, corrected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    pages = []
    for index, (name, paper_name, font, pen, ruling, text_name, split, strikes) in enumerate(ARBEITEN):
        markup = (HERE / "texts" / f"{text_name}.txt").read_text(encoding="utf-8").strip()
        paragraphs = markup.split("\n\n")
        parts = [markup] if split is None else ["\n\n".join(paragraphs[:split]), "\n\n".join(paragraphs[split:])]
        for part_number, part in enumerate(parts, start=1):
            seed = 9100 + 10 * index + part_number
            text = r.written_text(part)
            page_text = r.strike_words(text, strikes, random.Random(seed))
            paper = r.PAPERS[paper_name]
            rendered = r.render(page_text, font, seed, paper, pen, ruling)
            edges = [(paper.left, 0), (paper.left, r.PAGE[1]), (r.PAGE[0] - paper.right, 0), (r.PAGE[0] - paper.right, r.PAGE[1])]
            image, lines, _, margin = r.scan(rendered.image, rendered.lines, seed, edges)
            lines = [line for line in lines if line["text"].strip()]
            transcript, corrected = page_lines(lines, page_text.split(), word_pairs(part))
            file_name = f"{text_name}-{paper_name}-{part_number}.jpg"
            buffer = io.BytesIO()
            image.convert("RGB").save(buffer, "JPEG", quality=JPEG_QUALITY, optimize=True)
            (args.out / file_name).write_bytes(buffer.getvalue())
            width, height = image.size
            boxes = [[round(x / width, 4), round(y / height, 4), round(w / width, 4), round(h / height, 4)]
                     for x, y, w, h in (line["bbox"] for line in lines)]
            right = [[round(x / width, 4), round(y / height, 4)] for x, y in margin[2:]] if paper.right else None
            pages.append({"arbeit": name, "file": file_name, "lines": transcript, "corrected": corrected, "boxes": boxes, "margin": right})
            print(file_name, len(buffer.getvalue()))
    (args.out / "pages.json").write_text(json.dumps(pages, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
