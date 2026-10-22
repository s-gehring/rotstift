import argparse
import hashlib
import json
import os
import re
import threading
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(os.environ.get("ROTSTIFT_DATASETS", Path.home() / ".cache" / "rotstift" / "datasets"))
MAX_EDGE = 2400
CHUNK = 4 * 1024 * 1024

SOURCES = {
    "ru-schulaufsaetze": {
        "url": "https://data.mendeley.com/public-files/datasets/vs44v8r3nf/files/3a105c2e-02e9-4fc5-91e2-4d828ceb2d90/file_downloaded",
        "file": "handwritten_essay.zip",
        "sha256": "274bd7e4be4c63f68d8f39d88ca89414bf30858d27b49731d58cc161481391ff",
        "size": 149070116,
    },
    "bressay": {
        "url": "https://zenodo.org/api/records/11637681/files/bressay.zip/content",
        "file": "bressay.zip",
        "md5": "e4a4093304efff8322b605c8b79aa957",
        "size": 1496017418,
    },
    "gnhk": {
        "hf": "aryaman27/goodnotes-handwritten-dataset",
        "revision": "904297760a9fec813fdc1ecb5f8055cb1ca03550",
    },
}

GNHK_SPECIAL = re.compile(r"^%\w*%?\.?$")
GNHK_RULED = {
    'eng_AF_044', 'eng_AF_069', 'eng_AF_090', 'eng_AF_094', 'eng_AF_109', 'eng_AF_117',
    'eng_AS_017', 'eng_AS_022', 'eng_AS_023', 'eng_AS_028', 'eng_AS_030', 'eng_AS_031',
    'eng_AS_034', 'eng_AS_039', 'eng_AS_040', 'eng_AS_042', 'eng_AS_043', 'eng_AS_046',
    'eng_AS_047', 'eng_AS_050', 'eng_AS_051', 'eng_AS_052', 'eng_AS_057', 'eng_AS_061',
    'eng_AS_064', 'eng_AS_069', 'eng_AS_089', 'eng_AS_093', 'eng_AS_096', 'eng_EU_005',
    'eng_EU_019', 'eng_EU_027', 'eng_EU_036', 'eng_EU_070', 'eng_EU_206', 'eng_EU_208',
    'eng_EU_210', 'eng_EU_211', 'eng_EU_216', 'eng_EU_219', 'eng_EU_227', 'eng_EU_250',
    'eng_EU_257', 'eng_EU_259', 'eng_EU_272', 'eng_EU_277', 'eng_EU_285', 'eng_EU_318',
    'eng_NA_003', 'eng_NA_017', 'eng_NA_028', 'eng_NA_031', 'eng_NA_043', 'eng_NA_047',
    'eng_NA_074', 'eng_NA_083', 'eng_NA_088', 'eng_NA_096', 'eng_NA_127', 'eng_NA_132', 'eng_NA_133',
}


def request(url: str, headers: dict[str, str] | None = None) -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (rotstift-eval)", **(headers or {})})


def digest(path: Path, algorithm: str) -> str:
    hasher = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            hasher.update(block)
    return hasher.hexdigest()


def download(url: str, target: Path, size: int, workers: int = 16) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    probe = urllib.request.urlopen(request(url, {"Range": "bytes=0-0"}), timeout=60)
    final = probe.geturl()
    total = int(probe.headers["Content-Range"].split("/")[1]) if probe.headers.get("Content-Range") else size
    if total != size:
        raise SystemExit(f"{url}: expected {size} bytes, server says {total}")
    descriptor = os.open(target, os.O_RDWR | os.O_CREAT)
    os.ftruncate(descriptor, total)
    done = [0]
    lock = threading.Lock()

    def fetch(span: tuple[int, int]) -> None:
        start, end = span
        for _ in range(8):
            try:
                data = urllib.request.urlopen(request(final, {"Range": f"bytes={start}-{end}"}), timeout=60).read()
                if len(data) != end - start + 1:
                    raise OSError("short read")
                os.pwrite(descriptor, data, start)
                with lock:
                    done[0] += len(data)
                    print(f"\r{target.name}: {100 * done[0] // total} %", end="", flush=True)
                return
            except OSError:
                continue
        raise SystemExit(f"{url}: chunk at {start} failed")

    spans = [(start, min(start + CHUNK, total) - 1) for start in range(0, total, CHUNK)]
    with ThreadPoolExecutor(workers) as pool:
        list(pool.map(fetch, spans))
    os.close(descriptor)
    print()


def fetch_zip(name: str) -> Path:
    source = SOURCES[name]
    target = ROOT / "_raw" / name / source["file"]
    algorithm = "sha256" if "sha256" in source else "md5"
    if not target.exists() or target.stat().st_size != source["size"]:
        download(source["url"], target, source["size"])
    if digest(target, algorithm) != source[algorithm]:
        raise SystemExit(f"{target}: {algorithm} mismatch")
    return target


def extract(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            if not (root / member.filename).resolve().is_relative_to(root):
                raise SystemExit(f"{archive}: unsafe path {member.filename}")
        bundle.extractall(destination)


def save_page(image: Image.Image, target: Path) -> None:
    image = ImageOps.exif_transpose(image).convert("RGB")
    scale = min(1.0, MAX_EDGE / max(image.size))
    if scale < 1.0:
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    image.save(target, "JPEG", quality=92)


def folders(name: str) -> tuple[Path, Path, Path]:
    base = ROOT / name
    images, truth = base / "images", base / "ground_truth"
    images.mkdir(parents=True, exist_ok=True)
    truth.mkdir(parents=True, exist_ok=True)
    return base, images, truth


def prepare_ru() -> None:
    raw = ROOT / "_raw" / "ru-schulaufsaetze" / "x"
    extract(fetch_zip("ru-schulaufsaetze"), raw)
    _, images, truth = folders("ru-schulaufsaetze")
    count = 0
    for split in ("train", "test"):
        for essay in sorted((raw / split).iterdir(), key=lambda path: int(path.name)):
            pages = sorted(essay.glob("*.png"))
            if len(pages) != 1:
                continue
            name = f"ru-{split}-{essay.name}"
            with Image.open(pages[0]) as image:
                save_page(image, images / f"{name}.jpg")
            text = " ".join((essay / "text.txt").read_text(encoding="utf-8").split())
            (truth / f"{name}.txt").write_text(text + "\n", encoding="utf-8")
            count += 1
    print(f"ru-schulaufsaetze: {count} single-page essays")


def prepare_gnhk() -> None:
    source = SOURCES["gnhk"]
    raw = ROOT / "_raw" / "gnhk"
    revision = source["revision"]
    listing = json.load(urllib.request.urlopen(request(f"https://huggingface.co/api/datasets/{source['hf']}/revision/{revision}"), timeout=60))
    names = [item["rfilename"] for item in listing["siblings"] if item["rfilename"].endswith((".jpg", ".json"))]

    def fetch(name: str) -> None:
        target = raw / name
        if target.exists():
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://huggingface.co/datasets/{source['hf']}/resolve/{revision}/{urllib.parse.quote(name)}"
        target.write_bytes(urllib.request.urlopen(request(url), timeout=120).read())

    with ThreadPoolExecutor(6) as pool:
        list(pool.map(fetch, names))
    _, images, truth = folders("gnhk")
    _, ruled_images, ruled_truth = folders("gnhk-liniert")
    count = 0
    for image_path in sorted(raw.glob("*/*/*.jpg")):
        words = [word for word in json.loads(image_path.with_suffix(".json").read_text(encoding="utf-8"))
                 if word["type"] == "H" and not GNHK_SPECIAL.match(word["text"])]
        rows: dict[int, list[dict]] = {}
        for word in words:
            rows.setdefault(word["line_idx"], []).append(word)
        text = "\n".join(
            " ".join(word["text"] for word in sorted(row, key=lambda word: word["polygon"]["x0"]))
            for _, row in sorted(rows.items(), key=lambda item: sum(w["polygon"]["y0"] for w in item[1]) / len(item[1])))
        targets = [(images, truth)] + ([(ruled_images, ruled_truth)] if image_path.stem in GNHK_RULED else [])
        for image_folder, truth_folder in targets:
            with Image.open(image_path) as image:
                save_page(image, image_folder / f"{image_path.stem}.jpg")
            (truth_folder / f"{image_path.stem}.txt").write_text(text + "\n", encoding="utf-8")
        count += 1
    print(f"gnhk: {count} pages")


def bressay_text(markup: str) -> str:
    text = re.sub(r"##(.+?)##", r"\1", markup)
    return re.sub(r"--(.+?)--", lambda match: " ".join(f"~~{word}~~" for word in match.group(1).split()), text)


def prepare_bressay() -> None:
    raw = ROOT / "_raw" / "bressay" / "x"
    extract(fetch_zip("bressay"), raw)
    _, images, truth = folders("bressay")
    count = 0
    for folder in sorted((raw / "bressay" / "data" / "pages").iterdir()):
        page, text_file = folder / f"{folder.name}.png", folder / f"{folder.name}.txt"
        if not page.exists() or not text_file.exists():
            continue
        with Image.open(page) as image:
            save_page(image, images / f"bressay-{folder.name}.jpg")
        text = bressay_text(text_file.read_text(encoding="utf-8").strip())
        (truth / f"bressay-{folder.name}.txt").write_text(text + "\n", encoding="utf-8")
        count += 1
    print(f"bressay: {count} pages")


PREPARE = {"ru-schulaufsaetze": prepare_ru, "gnhk": prepare_gnhk, "bressay": prepare_bressay}


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch and prepare test datasets under ~/.cache/rotstift/datasets")
    parser.add_argument("names", nargs="*", choices=list(PREPARE), default=[])
    args = parser.parse_args()
    for name in args.names or list(PREPARE):
        PREPARE[name]()


if __name__ == "__main__":
    main()
