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

## Lesefehler der Texterkennung

Misst, wie viele Markierungen auf fehlerfreier Handschrift durch Lesefehler der Texterkennung entstehen und welche Gegenmittel sie senken. Der Bericht steht in [docs/evaluations/2026-10-lesefehler.md](../docs/evaluations/2026-10-lesefehler.md).

```bash
python3 -I eval/resize-pages.py <Datensatz>/images <Ordner-1152> --max-edge 1152
node --experimental-transform-types eval/ocr-run.ts --model glm-ocr-q8 --images <Ordner-1152> --pages 000,001 --out <Ergebnisse>/ocr-glm.json
node --experimental-transform-types eval/ocr-correct.ts --prompt app --no-thinking --ocr <Ergebnisse>/ocr-glm.json --out <Ergebnisse>/scads-glm-app.json
node --experimental-transform-types eval/ocr-score.ts --dataset <Datensatz> --ocr <Ergebnisse>/ocr-glm.json --scads <Ergebnisse>/scads-glm-app.json --dictionary <Ergebnisse>/dictionary.json --hunspell <Pfad ohne Endung zu de_DE.aff/.dic>
```

- `resize-pages.py` verkleinert die Seiten wie `modelImage` in der App (längste Kante `imageMaxEdge` aus `src-tauri/models.json`, JPEG-Qualität 90).
- `ocr-run.ts` startet das Erkennungsmodell mit den Einstellungen aus `src-tauri/models.json` (oder aus `ocr-candidates.json`, siehe unten), schickt die Seite wie `visionMessage` und fordert zusätzlich `logprobs` an. Gespeichert werden Text, Zeit und je Token Bytes und Log-Wahrscheinlichkeit. Für andere Bildgrößen die Seiten mit `resize-pages.py` (bei Bedarf `--upscale`) vorbereiten und `--max-edge <Kante>` angeben, damit die Größe im Ergebnis steht.
- `ocr-correct.ts` korrigiert mit `correctPage` und `createLlmCorrector` aus `src/correction` (Prompt aus der Registry, Reparaturrunde wie in der App). Quellen: `--ocr` (Transkripte aus `ocr-run.ts`), `--truth <Datensatz> --pages …` (Ground Truth), `--texts fehler,fehlerfrei` (Schülertexte, mit `--noise-from <ocr.json> --dataset <Datensatz> --seeds 1,2,3` zusätzlich mit Lesefehlern in der gemessenen Verteilung). `--prompt` ist `app`, `ocr` (Hinweis auf die Texterkennung) oder `strict` (zusätzlich nur eindeutige Fehler), `--no-thinking` schickt `chat_template_kwargs: {enable_thinking: false}`.
- `ocr-score.ts` leitet die Markierungen mit `deriveMarks` ab und bewertet sie: Fehlalarme je 100 Wörter auf den Datensatzseiten, getrennt nach Lesefolgefehler (das markierte Wort wurde falsch gelesen) und Korrektor (richtig gelesen und trotzdem markiert), Recall auf den Schülertexten. Gegenmittel sind Nachfilter: `Lesesicherheit < s` macht aus Markierungen auf Wörtern, deren unsicherstes Zeichen eine Token-Wahrscheinlichkeit unter `s` hat, einen Hinweis „unsicher gelesen“; `Wörterbuch` verwirft Markierungen, deren Korrektur ein Wort enthält, das hunspell nicht kennt (Cache in `--dictionary`). `--curve <scads.json>,<gerendert.json>` gibt die Schwellenkurve aus und nennt die Schwelle nach der Regel unten, `--examples <lauf.json>` listet alle Markierungen eines Laufs. Welche Erkennung zu einem Korrekturlauf gehört, steht in dessen Feld `ocrModel`. Für gerenderte Seiten zeigt die Übersicht zusätzlich, wie viele eingebaute Fehler die Erkennung wörtlich erhalten und wie viele sie eigenmächtig verbessert hat.
- `ocr-word-measures.ts --ocr <ocr-glm.json> --dataset <Datensatz> --rendered <ocr-glm-rendered.json>` vergleicht Maße der Lesesicherheit je Wort (Minimum, Produkt, Mittel je Token und je Zeichen, längenkorrigiert) und die Trennung nach Wortlänge.
- `ocr-calibration.ts --dataset <Datensatz> --ocr <ocr.json> …` zeigt je Erkennung, wie gut die Lesesicherheit zur Wirklichkeit passt: Wörter je Sicherheitsbereich, Anteil falsch gelesener Wörter darin, AUC und den Kalibrierungsfehler (gewichtetes Mittel des Abstands zwischen Sicherheit und Anteil richtig gelesener Wörter).

### Kandidaten für die Erkennung

`ocr-candidates.json` enthält Erkennungsmodelle im Format der Registry, die (noch) nicht in der App stehen. `ocr-run.ts`, `ocr-threshold.ts` und `download-models.ts` finden sie unter ihrer `id`, etwa:

```bash
node --experimental-transform-types eval/download-models.ts --models lightonocr-3-0.8b-q8
```

Steht im Eintrag `"reasoning": "off"`, startet der Server wie in der App mit `--reasoning off`.

### Schwelle der Lesesicherheit

Die Schwelle `request.uncertainBelow` ist je Modell die kleinste, bei der das 95-%-Intervall der Fehlalarme auf fehlerfreien Seiten 1 je 100 Wörter erreicht (`chooseThreshold` in `ocr-score.ts`). Auf ScaDS ergibt das für GLM-OCR 0,95.

Echte Schülerhandschrift fehlt bisher. Selbst geschriebene Seiten gehören nach `~/Rotstift-Testdaten/eigene-schrift/`, nie ins Repo, im Format von [`samples/scans/`](samples/scans): Je Seite ein Foto oder Scan (`.jpg`, `.jpeg`, `.png`) und daneben eine gleichnamige `.txt` mit dem Text Wort für Wort, wie er auf der Seite steht, eingebaute Fehler als `{geschrieben|richtig|Art}`. Seiten ohne Fehlermarke zählen als fehlerfrei. Durchgestrichenes steht nicht in der `.txt`. Welche Seiten gebraucht werden, steht in [docs/evaluations/2026-10-erkennung-genauer.md](../docs/evaluations/2026-10-erkennung-genauer.md#eigene-handschrift-für-die-schwelle). Dann läuft die ganze Prüfung mit einem Befehl:

```bash
node --experimental-transform-types eval/ocr-threshold.ts --scans ~/Rotstift-Testdaten/eigene-schrift --models glm-ocr-q8,lightonocr-3-0.8b-q8
```

Der Befehl verkleinert die Seiten je Modell auf `imageMaxEdge` (mit `eval/.venv`, siehe oben), erkennt sie mit Lesesicherheit, korrigiert sie mit Gemma wie in der App und schreibt nach `~/.cache/rotstift/eval/eigene-schrift/` (`--out` ändert das) die Zwischenstände und `bericht.md`: Lesefehler, Kalibrierung und je Schwelle Recall der roten Marken, Recall mit Hinweisen, Hinweise und Fehlalarme je 100 Wörter, dazu die Schwelle nach der Regel und den Wert aus der Registry. Ein abgebrochener Lauf setzt beim nächsten Aufruf fort. `--threads` (Standard 8) und `--thresholds` lassen sich ändern.

## Durchgestrichenes

Misst, wie viele durchgestrichene Wörter erkannt werden, wie viele normale Wörter fälschlich als gestrichen gelten und wie sich das auf die Wortzahl auswirkt. Der Bericht steht in [docs/evaluations/2026-10-durchgestrichen.md](../docs/evaluations/2026-10-durchgestrichen.md).

```bash
eval/.venv/bin/python -I eval/samples/render.py --strike 4 --out <Ordner>
eval/.venv/bin/python -I eval/resize-pages.py <Ordner> <Ordner-1152> --max-edge 1152
node --experimental-transform-types eval/ocr-run.ts --model glm-ocr-q8 --images <Ordner-1152> --out <Ergebnisse>/strike.json
node --experimental-transform-types eval/strike.ts --ocr <Ergebnisse>/strike.json --images <Ordner-1152> --truth <Ordner> --method ink
```

- `render.py --strike N` fügt je Seite N gestrichene Wörter in den Text ein (ein falsch geschriebenes Folgewort oder ein Wort aus dem Text) und streicht sie abwechselnd mit einem Strich, zwei Strichen oder Gekritzel. Die `.txt` neben dem Bild enthält sie als `~~Wort~~`, die `.strikes.json` ihre Boxen. Ohne `--strike` bleiben die Bilder wie bisher.
- `ocr-run.ts --prompt <Text>` ersetzt den Prompt der Registry, etwa um eine Markierung wie `<del>` zu verlangen.
- `strike.ts` vergleicht das Ergebnis mit der Wahrheit (`--truth` mit `.txt` je Seite, auch ein ScaDS-Ordner `ground_truth`, der kein Gestrichenes enthält). `--method none` wertet das Transkript, wie es ist, `prompt` liest `<del>`, `<s>`, `<strike>` und `~~` im Transkript als gestrichen, `ink` sucht die Striche mit `findStruckWords` aus der App im Bild, `both` vereint beides. Ausgabe: Gestrichene Wörter (erkannt, ungekennzeichnet abgeschrieben, ausgelassen), Fehlalarme, Wortzahl gegen die Wahrheit, Wortfehlerrate ohne Gestrichenes und Zeit je Seite. `--verbose` zeigt jede Seite.

## Korrekturprofile (Fremdsprachen und Sachfach)

Misst die App-Kette ab dem Text für ein Profil: Prompt aus der Registry, `createLlmCorrector`, `correctPage`, `deriveMarks`. Der Bericht steht in [docs/evaluations/2026-10-profile.md](../docs/evaluations/2026-10-profile.md).

```bash
node --experimental-transform-types eval/profiles.ts --set fr --out <Ergebnis.json>
```

- **Proben:** `samples/profiles/<fr|es|en|sachfach>/*.txt` im Format `{geschrieben|richtig|Art}`. Art ist `R`, `Z`, `G` oder `W` (Wortwahl), im Englischen `sp`, `p`, `gr` oder `voc`. `--set de` nimmt die deutschen Texte aus `samples/texts`. Jeder Text läuft einmal mit Fehlern und einmal korrigiert (Fehlalarme).
- **Optionen:** `--set` (fr, es, en, de, sachfach), `--model` (Standard `gemma-4-e2b-q4`), `--threads` (4), `--variant` (`app` ist der Prompt der Registry, `plain` lässt die Sätze zur Sprache weg), `--only` (Textnamen), `--out`. `PROFILES_DEBUG=1` gibt die Antworten des Modells aus.
- **Ausgabe:** Eine JSON-Datei mit allen Marken und Werten je Seite und die Kennzahlen auf der Konsole: Recall und Precision je nach Stelle sowie Art und Stelle, Korrektur richtig, Wortfehler vorher und nachher, Fehlalarme je 100 Wörter und die Zählung je Art.
- `profiles.test.ts` prüft ohne Modell, dass eine perfekte Korrektur der Proben jede Marke an die richtige Stelle setzt und wie viele die vorgesehene Art bekommen.

## Hinweise „unsicher gelesen“ und Groß- und Kleinschreibung

Misst Marken und Hinweise genau wie die App: `correctPage` mit der gespeicherten Antwort des Korrekturmodells, dann `separateUncertain` mit der Lesesicherheit je Wort. Der Bericht steht in [docs/evaluations/2026-10-gross-klein.md](../docs/evaluations/2026-10-gross-klein.md).

```bash
node --experimental-transform-types eval/ocr-correct.ts --prompt app --no-thinking --ocr <Ergebnisse>/ocr-glm.json --out <Ergebnisse>/scads-app.json
node --experimental-transform-types eval/hints.ts --ocr <Ergebnisse>/ocr-glm.json --corrections <Ergebnisse>/scads-app.json
node --experimental-transform-types eval/profiles.ts --set gross-klein --out <Ergebnis.json>
```

- `hints.ts` nimmt Erkennungen (`--ocr`, mehrfach) und Korrekturläufe (`--corrections`, mehrfach) aus `ocr-run.ts` und `ocr-correct.ts`. Seiten mit `--` im Namen sind gerenderte Schülertexte und werden gegen ihre Fehlermarken gewertet (Recall ohne und mit Hinweisen), die übrigen sind fehlerfreie Seiten aus dem Datensatz. Ausgabe: Marken und Hinweise je 100 Wörter. `--threshold` ersetzt die Schwelle 0,95, `--list` gibt jeden Hinweis mit Art, Sicherheit, Wortzahl, Editierabstand und Treffer aus (nur lokal ansehen, enthält Text der Seiten).
- `samples/profiles/gross-klein/` enthält zwei Texte mit falsch großgeschriebenen Adjektiven und Verben, kleingeschriebenen Substantiven und vielen Namen.

## Inhalt und Form

Misst, ob das Korrekturmodell Mängel bei Inhalt und Form einer Arbeit als kurze Randkommentare und einen Schlusskommentar benennt. Ein Durchlauf je Arbeit über den ganzen Text, Textform und Aufgabenstellung stehen bereinigt (ohne `<` und `>`, Steuerzeichen und Zeilenumbrüche, höchstens 2000 Zeichen) zwischen `<aufgabe>` und `</aufgabe>` im System-Prompt.

```bash
pnpm eval:content-form --variant features --runs 3 --out eval/results/content-form/features.json
pnpm eval:content-form --list eval/results/content-form/features.json
```

- **Proben:** `samples/content-form/` enthält zehn selbst geschriebene Arbeiten, acht mit eingebauten Mängeln und zwei saubere. Im Kopf stehen `Fach`, `Form`, `Aufgabe` und je Mangel eine Zeile `Mangel: <content|form> | <Stichwort> | <Schlüsselwörter> | @<Anker>`. Der Anker ist ein Textstück der Zeile, `@first`, `@last` oder `@*` (ganzer Text). Nach `---` folgt der Text, eine Zeile je Zeile wie aus der Transkription.
- **Varianten (`--variant`):** Freie Kommentare im Format `<rs-comment n="ZEILE" kind="content|form">…</rs-comment>` und `<rs-summary>…</rs-summary>` mit `base` (nur Regeln), `example` (mit Beispiel), `strict` (Beispiel, höchstens 4 Kommentare, ausdrücklich keine vagen Urteile), `checklist` (das Modell nennt zuerst die Merkmale der Textform, sie stehen dann im Prompt). `features` stellt stattdessen je Merkmal der Textform (feste Liste in `content-form-features.ts`) und zu Thema und Vorgaben der Aufgabe eine Ja-Nein-Frage, die Antwort ist per JSON-Schema erzwungen (`erfuellt`, `zeile`, bei den Aufgabenfragen `kommentar`). Nicht erfüllte Merkmale werden zu Kommentaren mit festem Wortlaut, ein weiterer Aufruf schreibt den Schlusskommentar zu diesen Feststellungen. `--verify` fragt bei den freien Varianten je Kommentar nach, ob er zutrifft, und verwirft die verneinten.
- **Aufgabe und Form (`--task`):** `keep` (Standard), `no-assignment` (ohne Aufgabenstellung), `no-form` (ohne Formname) oder `swap` (jede Arbeit bekommt Form und Aufgabe der nächsten, erwartet ist dann nur der Mangel „Passt nicht zur Aufgabe“). So lässt sich prüfen, ob das Modell Aufgabe und Form überhaupt aufgreift. `--defects` zeigt beim Auswerten je Mangel, in wie vielen Läufen jede Ergebnisdatei ihn trifft.
- **Optionen:** `--runs` (Standard 3, Seed je Lauf 1, 2, 3), `--temperature` (Standard aus der Registry, 0), `--threads` (Standard 8), `--samples` (Teile von Namen), `--model-file` (anderes GGUF), `--label`. Mit Ergebnisdateien statt `--out` gibt das Skript nur die Tabelle aus, `--list` zusätzlich jeden Kommentar mit der kommentierten Zeile.
- **Treffer:** Ein Mangel gilt als getroffen, wenn ein Randkommentar höchstens 2 Zeilen vom Anker entfernt (bei `@*` überall) eines seiner Schlüsselwörter enthält. Schlüsselwörter ab 5 Zeichen zählen als Teilwort, kürzere nur am Wortanfang. „Treffer mit Schluss“ zählt zusätzlich Mängel, die nur der Schlusskommentar nennt. Die Schlüsselwörter sind großzügig; die Zahlen im PR sind deshalb zusätzlich von Hand geprüft.
- **Unbelegt:** Randkommentare, die zu keinem Mangel passen. Auf den sauberen Arbeiten ist jeder Kommentar unpassend, auf den anderen ist ein Teil davon berechtigt und wird von Hand eingeordnet.
- **Format gültig:** Nur `rs-comment` mit gültiger Zeile und `kind` sowie genau ein nicht leeres `rs-summary`, kein Text daneben, Antwort mit `finish_reason` `stop`. „kind optional“ lässt ein fehlendes `kind` zu.
- **Zeit:** Wandzeit je Arbeit inklusive aller Aufrufe der Variante, Server wie in der App (`--reasoning off`, `--no-repack`, nur CPU, Kontext 4096).

## Modellwahl je Schritt

Misst Kandidaten für jeden Schritt der Kette mit den Evals oben, damit sie als Auswahl in den Einstellungen stehen können ([ADR 0008](../docs/adr/0008-modellwahl-je-schritt.md)).

```bash
node --experimental-transform-types eval/download-models.ts --models gemma-4-e4b-text,granite-4.2-3b,qwen3.5-4b,minicpm-v-4.7-1b-q4,granite-vision-4.1-4b-q4
node --experimental-transform-types eval/profiles.ts --set de --model gemma-4-e4b-q4 --threads 8 --out <Ergebnisse>/profiles-de-e4b.json
pnpm eval:content-form --variant features --runs 3 --model gemma-4-e4b-q4 --out <Ergebnisse>/cf-e4b.json
node --experimental-transform-types eval/ocr-run.ts --model minicpm-v-4.7-1b-q4 --images <Ordner-1536> --max-edge 1536 --out <Ergebnisse>/ocr-minicpm.json
node --experimental-transform-types eval/model-load.ts --models glm-ocr-q8,gemma-4-e2b-q4,gemma-4-e4b-q4
```

- `model-candidates.ts` beschreibt Textmodelle, die (noch) nicht in der App stehen. Sie übernehmen Prompt und Parameter des Vorgabe-Korrektors aus `src-tauri/models.json` und tauschen nur die Datei, so wie ein eigenes Modell in der App. `profiles.ts` und `content-form.ts` finden sie unter ihrer `id`. Die Erkennungskandidaten stehen wie bisher in `ocr-candidates.json`, mit dem allgemeinen Transkriptionsauftrag.
- `model-load.ts` startet jedes Modell mehrmals mit den Serverparametern der App und misst die Zeit bis `/health` antwortet (Median, Datei im Seitencache) und den RSS des Servers nach dem Laden. Das ist die Zeit, die ein Modellwechsel zwischen zwei Schritten mindestens kostet.
