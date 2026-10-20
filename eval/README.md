# Modell-Evaluation

Misst, wie gut lokale Vision-Modelle deutsche Handschrift transkribieren, rein auf der CPU. Die Ergebnisse stehen in [docs/evaluations](../docs/evaluations).

## Ablauf

```bash
pnpm fetch:runtime
python3 -m venv eval/.venv && eval/.venv/bin/pip install -r eval/requirements.txt
eval/.venv/bin/python eval/samples/render.py
node eval/download-models.ts
node eval/run.ts
```

- `render.py` setzt die Texte aus `samples/texts/` mit vier OFL-Handschriften auf liniertes Papier und speichert sie als JPEG unter `samples/rendered/`. Die Schriften kommen gepinnt aus `github.com/google/fonts` nach `~/.cache/rotstift/fonts`.
- `download-models.ts` lädt die Kandidaten aus `models.ts` von Hugging Face nach `~/.cache/rotstift/models` (oder `ROTSTIFT_MODELS_DIR`) und prüft die SHA256. `--verify` prüft auch vorhandene Dateien, `--models a,b` wählt aus.
- `run.ts` startet je Modell den llama-server aus `src-tauri/binaries` mit `-ngl 0`, `--device none` und 4 Threads, schickt jede Seite mit dem Transkriptionsauftrag und schreibt pro Modell eine JSON-Datei und `summary.md` nach `eval/results/<Zeitstempel>/`. Optionen: `--models`, `--samples` (Teile von Dateinamen), `--threads`, `--ctx-size`, `--max-tokens`, `--image-max-tokens`, `--prompt` (`standard`, `strict` oder `strict-en`, nur für die allgemeinen Modelle), `--dataset` (siehe unten), `--out` (vorhandene Modell-Ergebnisse darin werden übernommen).
- `summarize.ts <Ordner …>` fasst mehrere Ergebnisordner in einer Tabelle zusammen, etwa Varianten mit anderem Kontext oder Prompt.

## Proben

Die Texte sind selbst geschrieben und enthalten eingebaute Schülerfehler in der Form `{geschrieben|richtig|Art}`, Art ist `R` (Rechtschreibung), `Z` (Zeichensetzung) oder `G` (Grammatik). Gemessen wird gegen den Text, wie er geschrieben steht, denn Rotstift muss die Fehler sehen, nicht verbessern.

Echte Scans gehören nach [`samples/scans/`](samples/scans): Bild (`.jpg`, `.jpeg`, `.png`) und daneben eine gleichnamige `.txt` mit dem Text im selben Format. Nur selbst geschriebene Seiten, nie Arbeiten von Schülerinnen und Schülern.

Fremde Datensätze bleiben außerhalb des Repos. `--dataset <Ordner>` liest stattdessen `images/<name>.jpg` und `ground_truth/<name>.txt` (Klartext ohne Fehlermarken), etwa den [ScaDS.AI German Handwriting Full-Page Dataset](https://doi.org/10.5281/zenodo.18283705) (CC BY 4.0) nach dem Entpacken.

## Kennzahlen

- **Wortzahl-Abweichung:** Betrag der Differenz zwischen den Wortzahlen von Transkript und Soll-Text, gezählt mit `countWords` aus `src/stats`, relativ zum Soll. Die Übersicht zeigt Mittel und Maximum über die Seiten und den Anteil der Seiten mit exakter Wortzahl.
- **CER/WER:** Zeichen- bzw. Wortfehlerrate nach Levenshtein. Leerraum wird zusammengefasst, typografische Anführungszeichen und Striche vereinheitlicht, Groß- und Kleinschreibung und Satzzeichen zählen.
- **Fehler erhalten:** Anteil der eingebauten Fehler, die wörtlich im Transkript stehen. **Fehler korrigiert** zählt die, die das Modell eigenmächtig verbessert hat.
- **s/Seite:** Wandzeit pro Seite inklusive Bildkodierung und Ausgabe. **Peak-RAM:** Höchster RSS des Servers, abgefragt alle 200 ms.

## Fehlermarkierung (Text-Modelle)

Misst, welches lokale Text-Modell in deutschen Schülertexten Korrekturzeichen setzt. Die Ergebnisse stehen in [docs/evaluations](../docs/evaluations).

```bash
node eval/download-models.ts --models gemma-4-e2b-text,qwen3-4b
node --experimental-transform-types eval/correct.ts --models gemma-4-e2b-text --format diff --groups fehler,fehlerfrei,scads
```

Die Ergebnisse je Modell liegen als JSON in `results/<Ordner>/`. `correct-summary.ts` baut daraus die Tabellen des Berichts:

```bash
node --experimental-transform-types eval/correct-summary.ts eval/results/korrektur-diff
```

Für den Lauf mit OCR-Text zuerst die gerenderten Proben mit GLM-OCR transkribieren und das Ergebnis übergeben (Bild-Token-Cap wie im Bericht zur Handschrift):

```bash
node eval/run.ts --models glm-ocr --image-max-tokens 1232 --out eval/results/ocr-glm
node --experimental-transform-types eval/correct.ts --models gemma-4-e2b-text --format diff --groups ocr --ocr eval/results/ocr-glm/glm-ocr.json
```

`correct.ts` braucht `--experimental-transform-types`, weil es den Parser aus `src/annotations` lädt. Ohne `--models` lädt `download-models.ts` alle Kandidaten, auch die Vision-Modelle.

- **Eingabe:** Aus den Texten in `samples/texts/` entstehen Zeilen von höchstens 60 Zeichen (`--line-chars`, Fehlermarken werden nie zerschnitten). Der geschriebene Text ist die Eingabe, die Marken sind der Soll-Wert. Die Gruppen: `fehler` (die vier Texte mit 43 Fehlern), `fehlerfrei` (dieselben Texte korrigiert), `scads` (`--scads-count` Seiten Erwachsenenschrift aus dem Datensatz unter `--scads`, ohne Fehlermarken, nur gelesen) und `ocr` (Transkripte aus `--ocr <Ordner>/glm-ocr.json`, erzeugt mit `run.ts`; Soll-Marken nur dort, wo die OCR den Fehler stehen ließ).
- **Formate (`--format`):** `tags` ist das Format aus ADR 0002, das Modell gibt die Zeilen mit `<rs-error>` und `<rs-missing>` zurück (`--prompt spec` ist `buildSpecification`, `--prompt extended` ergänzt Regeln und ein Beispiel). `list` lässt das Modell eine JSON-Liste der Fehler ausgeben (erzwungen per JSON-Schema), `diff` lässt es den Text korrigieren und leitet die Marken per Wortvergleich ab (`correct-diff.ts`).
- **Reparatur:** Ist die Antwort ungültig, folgt höchstens eine Wiederholung mit der Liste aller Probleme (`--no-repair` schaltet sie ab).
- **Server:** Wie `run.ts` (4 Threads, nur CPU), Kontext 4096. `--server-args="--no-repack"` hängt Argumente an den llama-server, `--batch-size` und `--ubatch-size` setzen die Batch-Größen.
- **Kennzahlen:**
  - Gültig: Anteil der Antworten, die `parseTranscript` mit dem Profil Deutsch und dem Quelltext annimmt (1. Versuch, nach Reparatur).
  - Recall und Precision: Eine Marke trifft, wenn Art und Textstelle sich überschneiden (Auslassungen: gleiche Stelle). „Strenger Recall“ verlangt dieselbe Textstelle. „Korrektur richtig“ vergleicht den Text nach Anwenden von Modell-Marke und Soll-Marke.
  - Fehlalarme je 100 Wörter: Marken auf fehlerfreiem Text (korrigierte Schülertexte / Seiten aus dem Datensatz).
  - Text erhalten: Zeilen, deren Text außerhalb der Marken unverändert ist (nur `tags`, bei den anderen Formaten ist der Text per Konstruktion erhalten).
  - Wortfehler vorher und nachher: Wortabstand zum korrigierten Text, vor und nach Anwenden der Modell-Marken.
