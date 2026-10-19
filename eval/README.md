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
- `run.ts` startet je Modell den llama-server aus `src-tauri/binaries` mit `-ngl 0`, `--device none` und 4 Threads, schickt jede Seite mit dem Transkriptionsauftrag und schreibt pro Modell eine JSON-Datei und `summary.md` nach `eval/results/<Zeitstempel>/`. Optionen: `--models`, `--samples` (Teile von Dateinamen), `--threads`, `--ctx-size`, `--max-tokens`, `--out` (vorhandene Modell-Ergebnisse darin werden übernommen).

## Proben

Die Texte sind selbst geschrieben und enthalten eingebaute Schülerfehler in der Form `{geschrieben|richtig|Art}`, Art ist `R` (Rechtschreibung), `Z` (Zeichensetzung) oder `G` (Grammatik). Gemessen wird gegen den Text, wie er geschrieben steht, denn Rotstift muss die Fehler sehen, nicht verbessern.

Echte Scans gehören nach [`samples/scans/`](samples/scans): Bild (`.jpg`, `.jpeg`, `.png`) und daneben eine gleichnamige `.txt` mit dem Text im selben Format. Nur selbst geschriebene Seiten, nie Arbeiten von Schülerinnen und Schülern.

## Kennzahlen

- **CER/WER:** Zeichen- bzw. Wortfehlerrate nach Levenshtein. Leerraum wird zusammengefasst, typografische Anführungszeichen und Striche vereinheitlicht, Groß- und Kleinschreibung und Satzzeichen zählen.
- **Fehler erhalten:** Anteil der eingebauten Fehler, die wörtlich im Transkript stehen. **Fehler korrigiert** zählt die, die das Modell eigenmächtig verbessert hat.
- **s/Seite:** Wandzeit pro Seite inklusive Bildkodierung und Ausgabe. **Peak-RAM:** Höchster RSS des Servers, abgefragt alle 200 ms.
