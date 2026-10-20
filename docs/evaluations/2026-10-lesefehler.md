# Evaluation: Fehlalarme durch Lesefehler der Texterkennung (Oktober 2026)

Frage: Wie viele Markierungen setzt „Berichtigen“ auf fehlerfreier Handschrift, weil GLM-OCR falsch liest und Gemma 4 E2B den Lesefehler korrigiert, und welche Gegenmittel senken das auf höchstens 1 Fehlalarm je 100 Wörter, ohne echte Schülerfehler deutlich öfter zu übersehen?

## Ergebnis

**Ohne Gegenmittel setzt die Kette auf fehlerfreier Erwachsenenschrift 11,3 Fehlalarme je 100 Wörter (95-%-Intervall 10,0 bis 12,8), fast neun von zehn davon sind Lesefolgefehler.** GLM-OCR liest auf den 20 ScaDS-Seiten 20 % der Wörter falsch (Zeichenfehlerrate 7,1 %), obwohl die Wortzahl fast stimmt. Gemma korrigiert diese Lesefehler zuverlässig, und jede Korrektur wird zur roten Marke. Von 221 Fehlalarmen gehen 197 auf ein falsch gelesenes Wort zurück, 24 hat der Korrektor auf richtig gelesenem Text gesetzt.

**Das wirksamste Gegenmittel ist die Lesesicherheit aus GLM-OCR selbst.** llama-server liefert mit `logprobs: true` je Token die Wahrscheinlichkeit, ohne messbaren Zeitverlust. Wird jede Marke auf einem Wort, dessen unsicherstes Zeichen unter 0,9 liegt, zum Hinweis „unsicher gelesen“ statt zur Fehlermarke, bleiben 1,9 Fehlalarme je 100 Wörter (1,4 bis 2,6), bei 0,95 sind es 1,3 (0,9 bis 2,0), bei 0,98 dann 0,9 (0,5 bis 1,4). 94 % der Hinweise auf ScaDS sitzen tatsächlich auf falsch gelesenen Wörtern. Der Preis: Rund 10 Hinweise je 100 Wörter auf Erwachsenenschrift, und echte Schülerfehler, die GLM-OCR selbst unsicher liest, landen ebenfalls im Hinweis. Auf den gerenderten Schülertexten sinkt der Recall der roten Marken bei 0,9 von 86 % auf 66 %, bei 0,95 auf 61 %. **Verloren geht dabei kein Fehler:** Marken und Hinweise zusammen finden bei jeder Schwelle 86 %.

**Das Ziel von höchstens 1 Fehlalarm je 100 Wörter erreicht auf ScaDS nur die Schwelle 0,98.** Der Rest ist überwiegend der Korrektor selbst: Auf der fehlerfreien Ground Truth (also ohne jeden Lesefehler) setzt Gemma 2,5 Fehlalarme je 100 Wörter (1,9 bis 3,3), vor allem bei lateinischen und englischen Begriffen, Großschreibung in Klammern und Satzzeichen am Zeilenende. Auf den korrigierten Schülertexten sind es 0,0 (0,0 bis 0,75). Für Schülertexte ist das Ziel mit 0,95 also realistisch, für Fachtexte mit Fremdwörtern nicht.

**Die anderen Gegenmittel helfen wenig:**

- **Wörterbuch** (hunspell de_DE, Korrekturen verwerfen, die kein Wort sind): 11,3 → 9,7, zusammen mit der Lesesicherheit 0,9 nur 1,90 → 1,85. Es verwirft aber auch eine echte Korrektur („hinterhergerant“ → „hinterhergerannt“, igerman98 kennt das Wort nicht), Recall auf Schülertext 86 % → 84 %.
- **Prompt mit Hinweis auf die Texterkennung** (`ocr`) und zusätzlich „nur eindeutige Fehler“ (`strict`): 11,3 → 10,7 und 10,4, Recall 86 % → 84 % (je ein Fehler weniger). Alle Unterschiede liegen in den Intervallen.
- **Größeres Bild:** Die ScaDS-Seiten sind fast alle kleiner als 1152 px, die Verkleinerung kostet nichts (Original: 19,3 % statt 20,0 % falsch gelesene Wörter). Vergrößern auf 1536 px senkt die Zeichenfehlerrate von 6,9 % auf 5,7 %, die falsch gelesenen Wörter nur auf 18,7 %, bei 4,5-facher Zeit.
- **Qwen3-VL 4B als Erkennung:** Liest nur 11 % der Wörter falsch (GLM-OCR auf denselben 19 Seiten 20 %), ohne Gegenmittel 4,6 Fehlalarme je 100 Wörter. Mit Lesesicherheit 0,9 sind es 1,9 wie bei GLM-OCR, aber mit einem Viertel der Hinweise (48 statt 176). Kosten: 1,9-mal so lange je Seite, 5,3 statt 2,3 GB Peak-RAM, eine von 20 Seiten endet in einer Wiederholungsschleife.

**Nebenbefund 1, für 0.2.0 wichtig: Die App lässt Gemma denken, und das macht die Korrektur schlechter.** Der Registry-Request schaltet das Denken von Gemma 4 nicht ab. Gemma erzeugt dann im Median 1653 Token je Seite statt rund 230, braucht auf simon-pc 99 s statt 17 s (Mac: 33 bis 49 s statt 6 s), und 3 von 20 ScaDS-Seiten scheitern mit „Die Antwort des Modells war unvollständig“, weil das Denken die 2048 Ausgabe-Token aufbraucht. Auf den getippten Schülertexten sinkt der Recall von 86 % auf 70 % und die Präzision von 97 % auf 70 %, auf ScaDS steigen die Fehlalarme von 11,3 auf 12,4 je 100 Wörter.

**Nebenbefund 2: Gemma setzt Kursiv-Sternchen.** Lateinische und englische Begriffe gibt Gemma als `*cultus*` aus, daraus wurden zwei Auslassungsmarken je Wort. Das waren 11 von 56 Korrektor-Fehlalarmen auf der Ground Truth. `readNumberedLines` verwirft jetzt Sternchen, die die Originalzeile nicht hat (`withoutAddedEmphasis` in `src/correction/llm-corrector.ts`).

## Empfehlung

1. **Denken für das Korrekturmodell abschalten (vor 0.2.0).** In `src-tauri/src/llm/runtime.rs` beim Start des Korrektors `--reasoning off` an den llama-server übergeben (in `b11537` vorhanden), am besten gesteuert über ein neues Feld im `server`-Block des Gemma-Eintrags in `src-tauri/models.json` (etwa `"reasoning": "off"`). Ein Server-Flag ist besser als `chat_template_kwargs` im Request: Es gilt auch für die Reparaturrunde, und die Request-Allowlist bleibt eng. Getestet auf dem Mac mit Gemma 4 E2B: `--reasoning off` und `chat_template_kwargs: {"enable_thinking": false}` liefern dieselbe Antwort (18 Token, leeres `reasoning_content`, ohne Schalter 355 Token). `--reasoning-budget 0` nicht verwenden: Das Denken endet sofort, aber Gemma schreibt dann eine Erklärung in die Antwort.
2. **Sternchen-Fix übernehmen** (in diesem PR, `src/correction/llm-corrector.ts`, getestet): Korrektor-Fehlalarme auf der Ground Truth 2,97 → 2,46 je 100 Wörter.
3. **Lesesicherheit einbauen, Schwelle 0,95 für GLM-OCR.**
   - `src-tauri/src/llm/request.rs`: In `ChatRequest` zusätzlich `logprobs: Option<bool>` erlauben (mit `skip_serializing_if = "Option::is_none"`). `top_logprobs` und `n_probs` sind nicht nötig. Die Antwort reicht `post_chat` schon heute ungefiltert durch.
   - `src/llm/types.ts`: `logprobs` im Request, `choices[].logprobs.content[]` mit `bytes` und `logprob` in `ChatResponse`.
   - `src/pipeline/llm-transcriber.ts`: `logprobs: true` senden und aus der Antwort mit `charProbabilities` und `lineProbabilities` aus `src/correction/reading-confidence.ts` (in diesem PR, getestet) je Transkriptzeile die Zeichenwahrscheinlichkeiten bilden. Speichern genügt je Wort das Minimum, die Token selbst nicht. Ein anderes Wortmaß oder eine Schwelle je Wortlänge trennt nicht besser (siehe [Wortmaß und Wortlänge](#wortmaß-und-wortlänge)).
   - Nach `correctPage`: Marken mit `markConfidence(...) < 0,95` nicht als Fehler zeigen, sondern als Hinweis „unsicher gelesen“ mit dem Korrekturvorschlag. Das Feld gehört zu `src/results`, die Darstellung zu `src/review` und `src/overlay`.
   - **Darstellung:** Hinweise nur in der Prüfansicht und dezent, etwa grau gepunktet unterstrichen, der Vorschlag erst beim Antippen. Ein Klick macht daraus eine rote Marke, ein zweiter verwirft ihn. Nicht im PDF-Export und nicht in der Fehlerstatistik. Im Seitenkopf genügt die Zahl („7 Stellen unsicher gelesen“), damit die Lehrkraft entscheidet, ob sie hinsieht. Mit dieser Darstellung sind 5 bis 10 Hinweise je 100 Wörter vertretbar, als rote Marken wären sie es nicht.
   - Die Zahl der Hinweise lässt sich über die Schwelle kaum senken (0,7: 8,0 statt 10,0 je 100 Wörter, dafür 3,3 statt 1,3 Fehlalarme). Sie folgt aus der Lesefehlerrate: Weniger Hinweise gibt es nur mit einer besseren Erkennung (Qwen3-VL: 2,7 je 100 Wörter).
   - Die Schwelle hängt vom Modell ab (Qwen3-VL ist anders kalibriert) und gehört deshalb in den Transkriptions-Eintrag der Registry, etwa `request.uncertainBelow: 0.95`.
   - Erwartung auf Erwachsenenschrift: 1,3 statt 11,3 Fehlalarme und rund 10 Hinweise je 100 Wörter, auf Schülerschrift weniger Hinweise (gerenderte Seiten: 5 je 100 Wörter).
4. **Kein Wörterbuch einbauen.** Neben der Lesesicherheit bringt es fast nichts und kostet echte Fehler. Falls es später für andere Zwecke gebraucht wird: `dictionary-de` 3.0.0 (igerman98, GPL-2.0 OR GPL-3.0, also GPL-3.0-kompatibel, 1,1 MB) mit dem Rust-Crate `spellbook` 0.3.5 (MPL-2.0, ebenfalls kompatibel) lädt in 8 ms, prüft ein Wort in 7 µs und braucht 7 MB RAM (Mac, M4 Pro).
5. **Prompt nicht ändern.** Die Varianten `ocr` und `strict` liegen im Rauschen und kosten je einen echten Fehler.
6. **Qwen3-VL 4B nicht als Standard**, aber als 16-GB-Option mit dem Argument „deutlich weniger unsichere Stellen“ beschreiben. Seine Schwelle müsste eigens gewählt werden (bei 0,9: 1,9 Fehlalarme und 2,7 Hinweise je 100 Wörter).
7. **`imageMaxEdge` für GLM-OCR bei 1152 lassen.** Weder das Original noch eine Vergrößerung lohnt sich (siehe [Bildgröße](#bildgröße)).
8. **Gemma mit Bild für unsichere Wörter:** Nicht weiterverfolgen. Gemma 4 E2B mit `mmproj` kann ein unsicheres Wort im Bild nachlesen, liest aber nur 3 von 15 falsch gelesenen Wörtern richtig und wiederholt meist die falsche Lesung. Der Hinweis „unsicher gelesen“ ist billiger und ehrlicher.

## Messergebnisse

### Lesefehler der Erkennung

| Erkennung                        | Seiten           | Zeichenfehlerrate | falsch gelesene Wörter           | s/Seite simon-pc (8 Threads) | Peak-RAM simon-pc |
| -------------------------------- | ---------------- | ----------------- | -------------------------------- | ---------------------------- | ----------------- |
| GLM-OCR, ScaDS                   | 20               | 7,1 % (6,7–7,5)   | 20,2 % (18,5–22,1), 401 von 1981 | 21,5                         | 2,3 GB            |
| GLM-OCR, ScaDS ohne 008          | 19               | 6,9 % (6,5–7,3)   | 20,0 % (18,2–21,9)               | 20,8                         |                   |
| Qwen3-VL 4B, ScaDS ohne 008      | 19 (+1 Schleife) | 4,3 % (4,0–4,7)   | 11,1 % (9,8–12,6), 208 von 1868  | 38,9 (Schleife: 251)         | 5,3 GB            |
| GLM-OCR, gerenderte Schülertexte | 16               | 1,1 % (0,9–1,2)   | 5,0 % (4,1–6,0), 102 von 2041    | 27,4                         | 2,1 GB            |

Auf dem Mac (M4 Pro, 4 Threads, nur CPU) braucht GLM-OCR für die Seiten 000 bis 002 16,5, 12,4 und 6,9 s bei 2,7 GB Peak-RAM. Die Linux-Messung ohne `logprobs` ([2026-10-linux-simon-pc.md](2026-10-linux-simon-pc.md)) lag bei 23 s je Seite mit 8 Threads, die Wahrscheinlichkeiten kosten also keine messbare Zeit.

Typische Lesefehler (gekürzt): „Zusammenkunft“ als „Lusammenkunft“, „Geschlecht“ als „Geschoht“, „Personenstandsgesetz“ als „Poisonenstandsgesetz“. Die letzten beiden liest GLM-OCR mit Wahrscheinlichkeit 0,99 bis 1,0, die Lesesicherheit kann sie nicht abfangen.

### Bildgröße

Kostet die Verkleinerung auf 1152 px Lesefehler? Nein: Die ScaDS-Bilder sind schon klein (längste Kante 702 bis 1143 px, nur 008 mit 1342 und 015 mit 1563 px sind größer), die App verkleinert also fast nichts. Geprüft wurden deshalb das Original und eine Vergrößerung auf 1536 px (bikubisch, `eval/resize-pages.py --upscale`). Verglichen auf den 19 Seiten ohne 008, weil GLM-OCR 008 im Original in eine Wiederholungsschleife schickt. simon-pc, 8 Threads.

| Bild                       | Zeichenfehlerrate | falsch gelesene Wörter | s/Seite (Mittel, simon-pc) | Bild-Token (Median) | Peak-RAM simon-pc |
| -------------------------- | ----------------- | ---------------------- | -------------------------- | ------------------- | ----------------- |
| verkleinert auf 1152 (App) | 6,9 % (6,5–7,3)   | 20,0 % (18,2–21,9)     | 21,5                       | 968                 | 2,3 GB            |
| Original                   | 6,7 % (6,3–7,1)   | 19,3 % (17,6–21,1)     | 25,5 (008: Schleife)       | 968                 | 2,4 GB            |
| vergrößert auf 1536        | 5,7 % (5,4–6,1)   | 18,7 % (17,0–20,5)     | 95,7                       | 2151                | 2,6 GB            |

Das Vergrößern senkt die Zeichenfehlerrate messbar, die Zahl falsch gelesener Wörter aber nur um 1,3 Punkte (Intervalle überlappen), bei 4,5-facher Zeit. Ein billiger Hebel ist das nicht. Die hohe Zeichenfehlerrate des Piloten (17 % auf den Seiten 000 bis 002) lag an diesen drei Seiten; auf allen 20 Seiten sind es 7,1 %. Dass die Wortzahl trotzdem fast stimmt, ist kein Widerspruch: GLM-OCR liest fast jedes Wort, aber jedes fünfte falsch.

### Fehlalarme auf ScaDS, GLM-OCR, Prompt der App

20 Seiten, 1951 Wörter, Gemma 4 E2B ohne Denken. „Hinweise“ sind Marken, die zu „unsicher gelesen“ werden; „verworfen“ zählt Marken, die das Wörterbuch streicht. Fünf weitere Marken berühren Abschreibfehler der Vorlage und sind nicht mitgezählt.

| Gegenmittel                       | Fehlalarme je 100 Wörter | davon Lesefolgefehler | davon Korrektor | Hinweise (davon auf Lesefehlern) | verworfen |
| --------------------------------- | ------------------------ | --------------------- | --------------- | -------------------------------- | --------- |
| keines                            | 11,33 (10,00–12,81)      | 197                   | 24              | 0                                | 0         |
| Wörterbuch                        | 9,74 (8,50–11,13)        | 168                   | 22              | 0                                | 31        |
| Lesesicherheit < 0,5              | 5,89 (4,93–7,03)         | 93                    | 22              | 106 (104)                        | 0         |
| Lesesicherheit < 0,7              | 3,33 (2,62–4,22)         | 47                    | 18              | 156 (150)                        | 0         |
| Lesesicherheit < 0,9              | 1,90 (1,38–2,60)         | 24                    | 13              | 184 (173)                        | 0         |
| Wörterbuch + Lesesicherheit < 0,9 | 1,85 (1,34–2,54)         | 23                    | 13              | 154 (145)                        | 31        |
| Lesesicherheit < 0,95             | 1,33 (0,91–1,95)         | 15                    | 12              | 196 (182)                        | 0         |
| Lesesicherheit < 0,98             | 0,87 (0,54–1,39)         | 10                    | 7               | 204 (187)                        | 0         |

### Schwellenkurve

Lesesicherheit allein, Prompt der App. Recall auf den 16 gerenderten Seiten (155 von 172 Fehlern hat GLM-OCR unverändert gelesen und sind damit erreichbar). Mit Hinweisen bleibt der Recall bei jeder Schwelle 86 % (80–91).

| Schwelle | Fehlalarme je 100 Wörter (ScaDS) | Hinweise je 100 Wörter (ScaDS) | Recall rote Marken (gerendert) | Hinweise je 100 Wörter (gerendert) |
| -------- | -------------------------------- | ------------------------------ | ------------------------------ | ---------------------------------- |
| keine    | 11,33 (10,00–12,81)              | 0                              | 86 % (80–91)                   | 0                                  |
| 0,3      | 9,33 (8,12–10,70)                | 2,0                            | 86 % (79–90)                   | 0,1                                |
| 0,5      | 5,89 (4,93–7,03)                 | 5,4                            | 86 % (79–90)                   | 1,0                                |
| 0,6      | 4,31 (3,49–5,30)                 | 7,0                            | 81 % (74–86)                   | 2,0                                |
| 0,7      | 3,33 (2,62–4,22)                 | 8,0                            | 75 % (67–81)                   | 3,0                                |
| 0,8      | 2,61 (1,99–3,42)                 | 8,7                            | 73 % (65–79)                   | 3,5                                |
| 0,85     | 2,31 (1,73–3,07)                 | 9,0                            | 70 % (63–77)                   | 4,0                                |
| 0,9      | 1,90 (1,38–2,60)                 | 9,4                            | 66 % (58–73)                   | 4,4                                |
| 0,95     | 1,33 (0,91–1,95)                 | 10,0                           | 61 % (53–69)                   | 5,2                                |
| 0,98     | 0,87 (0,54–1,39)                 | 10,5                           | 54 % (46–62)                   | 6,0                                |
| 0,99     | 0,77 (0,47–1,26)                 | 10,6                           | 47 % (39–55)                   | 6,7                                |

Bis 0,5 kostet die Schwelle keinen roten Treffer, darüber wandern echte Schülerfehler in die Hinweise: GLM-OCR liest falsch geschriebene Wörter unsicherer als richtige, vermutlich weil sein Sprachwissen die richtige Schreibung erwartet. Auf den gerenderten Seiten liegen bei 0,9 28 % der 121 Fehlerwörter unter der Schwelle, aber nur 10 % der 1890 übrigen Wörter (bei 0,7: 18 % gegenüber 5 %). Beispiele: „vieleicht“ 0,54, „erlaubnis“ 0,65, „nähmlich“ 0,75, dagegen „Schockolade“ und „hinterhergerant“ 1,00. Die Hinweise auf ScaDS wachsen ab 0,7 kaum noch, die Fehlalarme fallen weiter. 0,95 ist der Kompromiss: Fehlalarme nahe am Ziel, etwas mehr Hinweise als bei 0,9.

### Wortmaß und Wortlänge

Trennt eine andere Zusammenfassung der Token-Wahrscheinlichkeiten je Wort besser als das Minimum? Grundlage sind alle Wörter der 20 GLM-OCR-Seiten (1956, davon 400 falsch gelesen) und der 16 gerenderten Seiten (2033, davon 143 mit einem Schülerfehler, gezählt einschließlich Auslassungen am Wort). Gut ist ein Maß, das falsch gelesene Wörter erfasst, richtig gelesene und echte Schülerfehler aber nicht.

| Maß je Wort                                         | AUC falsch gegen richtig gelesen | Schwelle für 70 % der Lesefehler | richtig gelesen darunter | Schülerfehler darunter |
| --------------------------------------------------- | -------------------------------- | -------------------------------- | ------------------------ | ---------------------- |
| Minimum der Token (App-Vorschlag)                   | 0,890                            | 0,70                             | 10 %                     | 15 %                   |
| Produkt der Token (Wortwahrscheinlichkeit)          | 0,896                            | 0,66                             | 10 %                     | 15 %                   |
| geometrisches Mittel je Token                       | 0,884                            | 0,83                             | 11 %                     | 9 %                    |
| Produkt hoch 1/Zeichenzahl                          | 0,894                            | 0,94                             | 10 %                     | 10 %                   |
| Minimum, für Wörter über 6 Zeichen längenkorrigiert | 0,888                            | 0,78                             | 10 %                     | 15 %                   |

Alle Maße liegen innerhalb von 0,012 AUC. Die beiden gemittelten Maße erfassen bei gleicher Lesefehlerquote etwas weniger Schülerfehler (13 bis 14 statt 21 von 143), das ist aber nur ein Unterschied von sieben Wörtern auf vier Texten. Eine Schwelle je Wortlänge hilft nicht: Lange Wörter sind öfter falsch gelesen (30 bis 34 % ab 7 Zeichen gegenüber 8 % bis 3 Zeichen), und unter 0,95 fallen dort sowohl die Lesefehler (90 bis 96 %) als auch viele richtig gelesene Wörter (46 bis 60 %). Eine niedrigere Schwelle für lange Wörter senkt beides gleichmäßig. Das Minimum bleibt, weil es am einfachsten zu erklären ist. Das Mittel je Zeichen ist der Kandidat, den eine Messung auf echter Schülerhandschrift prüfen sollte.

### Prompt-Varianten und Obergrenze ohne Lesefehler

Fehlalarme je 100 Wörter. „Ground Truth“ heißt: Gemma korrigiert die fehlerfreie Vorlage direkt, ohne Erkennung. Das ist die Untergrenze dessen, was der Korrektor allein auf diesen Texten anrichtet.

| Prompt   | ScaDS, GLM-OCR      | ScaDS, GLM-OCR, Lesesicherheit < 0,9 | ScaDS, Ground Truth | ScaDS, Qwen3-VL (19 Seiten) | ScaDS, Qwen3-VL, Lesesicherheit < 0,9 |
| -------- | ------------------- | ------------------------------------ | ------------------- | --------------------------- | ------------------------------------- |
| `app`    | 11,33 (10,00–12,81) | 1,90 (1,38–2,60)                     | 2,46 (1,86–3,25)    | 4,62 (3,73–5,70)            | 1,88 (1,34–2,63)                      |
| `ocr`    | 10,66 (9,37–12,11)  | 1,74 (1,25–2,43)                     | 2,26 (1,68–3,01)    | 3,99 (3,17–5,01)            | 1,54 (1,06–2,23)                      |
| `strict` | 10,35 (9,08–11,78)  | 1,69 (1,21–2,37)                     | 2,41 (1,82–3,19)    | 3,82 (3,02–4,82)            | 1,42 (0,97–2,09)                      |

Ohne den Sternchen-Fix lag die Ground Truth mit `app` bei 2,97 (2,31–3,82). Die übrigen Korrektor-Fehlalarme (Beispiele, gekürzt): „lateinisch“ → „Lateinisch“ nach einer Klammer, „1“ → „ein“, „peer review“ → „Peer Review“, ein Punkt am Ende einer Überschrift, „Ein oder eine Peer-Review“ → „Eine Peer-Review“.

Abschreibfehler der Vorlage, die Gemma richtig korrigiert (sechs Marken, nicht als Fehlalarm gezählt): „Demographei“ → „Demographie“, „tirbt“ → „stirbt“, „FIFA-Weltrangl“ → „FIFA-Weltrangliste“, „Selbstbewussth“ → „Selbstbewusstsein“.

### Recall auf Schülertexten

43 eingebaute Fehler in vier Texten (511 Wörter). Beim Rauschen sind es drei Seeds je Text, 118 Fehler in gültigen Antworten, davon 86 nicht vom Rauschen getroffen.

| Prompt                        | getippt: Recall | getippt: Fehlalarme je 100 Wörter fehlerfrei | gerendert: Recall                | gerendert: Precision | Rauschen: Recall | Rauschen: Fehlalarme je 100 Wörter fehlerfrei |
| ----------------------------- | --------------- | -------------------------------------------- | -------------------------------- | -------------------- | ---------------- | --------------------------------------------- |
| `app`                         | 86 % (73–93)    | 0,00 (0,00–0,75)                             | 86 % (80–91)                     | 61 % (54–67)         | 67 % (57–76)     | 19,9 (18,0–22,0)                              |
| `ocr`                         | 84 % (70–92)    | 0,00 (0,00–0,75)                             | 86 % (79–90)                     | 62 % (55–68)         | 67 % (57–76)     | 19,1 (17,1–21,2)                              |
| `strict`                      | 84 % (70–92)    | 0,00 (0,00–0,75)                             | 86 % (80–91)                     | 62 % (56–69)         | 66 % (56–75)     | 19,4 (17,4–21,5)                              |
| `app` + Wörterbuch            | 84 % (70–92)    | 0,00 (0,00–0,75)                             | 85 % (78–89)                     | 61 % (54–67)         | 67 % (57–76)     | 19,2 (17,3–21,2)                              |
| `app` + Lesesicherheit < 0,9  |                 |                                              | 66 % (58–73), mit Hinweisen 86 % | 78 % (71–85)         |                  |                                               |
| `app` + Lesesicherheit < 0,95 |                 |                                              | 61 % (53–69), mit Hinweisen 86 % | 84 % (76–90)         |                  |                                               |

Das simulierte Rauschen (20 % falsch gelesene Wörter wie GLM-OCR auf ScaDS) senkt den Recall auf die erreichbaren Fehler von 86 % auf 67 %, weil Gemma bei vielen Nicht-Wörtern in der Nähe auch die eigentliche Fehlerstelle anders zuschneidet. Es erzeugt mehr Fehlalarme als die echten Lesefehler (19,9 statt 11,3), weil es die Fehler gleichmäßig verteilt, während echte Lesefehler sich auf schwierigen Seiten häufen und dort zu wenigen langen Marken zusammenfallen. Für den Vergleich der Gegenmittel reicht es: Wörterbuch und Prompt ändern den Recall auch hier nicht.

### Denken an und aus

| Daten                                    | Denken aus                         | Denken an                          |
| ---------------------------------------- | ---------------------------------- | ---------------------------------- |
| ScaDS, GLM-OCR: Fehlalarme je 100 Wörter | 11,3 (10,0–12,8), 20 von 20 Seiten | 12,4 (10,9–14,1), 17 von 20 Seiten |
| davon Lesefolgefehler / Korrektor        | 197 / 24                           | 188 / 19                           |
| ScaDS, GLM-OCR, Lesesicherheit < 0,9     | 1,9 (1,4–2,6)                      | 2,0 (1,4–2,8)                      |
| ScaDS, GLM-OCR, Lesesicherheit < 0,95    | 1,3 (0,9–2,0)                      | 1,6 (1,1–2,3)                      |
| Getippte Schülertexte: Recall            | 86 % (73–93)                       | 70 % (55–81)                       |
| Getippte Schülertexte: Präzision         | 97 % (86–100)                      | 70 % (55–81)                       |

Die drei ungültigen Seiten (002, 009, 015) fehlen in der Spalte „an“ auch im Nenner. Auf ScaDS ändert das Denken wenig, auf den Schülertexten verliert es sieben echte Fehler und setzt 13 Marken, die keine Fehler sind (30 von 43 Marken richtig). Die fehlerfreien Fassungen liefen mit Denken nicht.

### Zeiten des Korrektors

| Rechner    | Threads | Denken | s/Seite (Median)                 | erzeugte Token je Seite                  | Peak-RAM               |
| ---------- | ------- | ------ | -------------------------------- | ---------------------------------------- | ---------------------- |
| simon-pc   | 8       | aus    | 16,9 (ScaDS, GLM-OCR)            | 226                                      | 3,1 GB (`--no-repack`) |
| simon-pc   | 8       | an     | 99,0 (ScaDS, GLM-OCR)            | 1653 (1115 bis 3808, mit Reparaturrunde) | 2,9 GB                 |
| Mac M4 Pro | 4       | aus    | 5,5 bis 7,2 (3 Seiten)           | 229 bis 275                              | 3,1 GB                 |
| Mac M4 Pro | 4       | an     | 33 bis 49 (3 Seiten, 1 ungültig) | 1398 bis 2048                            | 3,1 GB                 |

### Machbarkeit: Gemma mit Bild

Probe auf simon-pc (8 Threads): Gemma 4 E2B mit `mmproj-gemma-4-E2B-it-Q8_0.gguf` (557 MB) bekommt die ganze Seite (wie in der App verkleinert), die gelesene Zeile und das fragliche Wort und soll nur das Wort nennen, das im Bild steht (ohne Denken, höchstens 32 Token).

| Fall                                 | Wörter | richtig nachgelesen                                         |
| ------------------------------------ | ------ | ----------------------------------------------------------- |
| falsch gelesen, Lesesicherheit < 0,9 | 15     | 3 (20 %, 7–45)                                              |
| richtig gelesen, sicher (Gegenprobe) | 6      | 5, das sechste ergänzt den Bindestrich-Teil („Peer-Review“) |

Bei 7 der 15 falsch gelesenen Wörter wiederholt Gemma die Lesung von GLM-OCR, bei weiteren 4 liefert es ein anderes falsches Wort. Je Frage 8,8 s, Peak-RAM 3,8 GB (Modell und Bild-Encoder). Bei rund 10 unsicheren Wörtern je 100 Wörtern wären das auf einer Seite mit 230 Wörtern rund 3 min zusätzlich für etwa 5 korrigierte Lesungen. Technisch machbar (der Registry-Eintrag bräuchte nur `mmproj` und `visionMessage`), lohnt sich aber nicht.

## Methode

- **Fehlalarme:** 20 Seiten (000 bis 019) aus dem [ScaDS.AI German Handwriting Full-Page Dataset](https://doi.org/10.5281/zenodo.18283705) (Thomas Burghardt, Till Nestler, CC BY 4.0), Erwachsenenhandschrift mit Wikipedia-Auszügen, 1951 Wörter laut Ground Truth (gezählt mit `countWords` aus `src/stats`, die Zeichenfehler-Statistik zählt 1981 Wort-Tokens). Die Seiten werden wie in der App verkleinert (`eval/resize-pages.py`, längste Kante `imageMaxEdge`, JPEG-Qualität 90), mit GLM-OCR (Q8_0) und dem Registry-Prompt erkannt, mit `splitTranscript` in Zeilen zerlegt und mit `correctPage` und `createLlmCorrector` aus `src/correction` (System-Prompt aus `src-tauri/models.json`, Reparaturrunde wie in der App) korrigiert. Jede Markierung zählt als Fehlalarm, denn die Vorlage enthält keine Fehler, außer wo die Ground Truth selbst falsch ist (siehe unten).
- **Ursache je Fehlalarm:** `eval/ocr-attribution.ts` richtet die Tokens von Erkennung und Ground Truth per Wort-Levenshtein aus (Tokenisierung aus `src/correction/tokens.ts`). Sind alle Wörter unter einer Markierung exakt richtig gelesen, ist es ein **Korrektor-Fehlalarm**, sonst ein **Lesefolgefehler**. Bei Auslassungen entscheiden die beiden Nachbarwörter.
- **Ground Truth geprüft:** Mit hunspell (de_DE) über alle 20 Seiten, danach von Hand. Sieben Wörter auf vier Seiten sind Abschreibfehler der Vorlage („Weltrangl“, „lönig(in)“, „tirbt“, „rsprungsversionen“, „asmsp“, „Selbstbewussth“, „Demographei“). Markierungen, die eines davon berühren, zählen nicht als Fehlalarm, sondern als „Vorlage fehlerhaft“ (`eval/ocr-truth-slips.ts`). Die Zeichenfehlerrate enthält sie noch, das macht weniger als 0,5 Prozentpunkte aus.
- **Recall:** (a) Die vier selbst geschriebenen Schülertexte (511 Wörter, 43 Fehler) getippt und dieselben Texte korrigiert als fehlerfreier Vergleich. (b) Dieselben Texte mit simuliertem Leserauschen (`eval/ocr-noise.ts`): Anteil falsch gelesener Wörter und die Zeichenänderungen werden aus den 20 GLM-OCR-Seiten gelernt und mit drei Seeds auf die Texte angewandt. Eine verrauschte Fehlerstelle zählt nicht mehr als erreichbar. (c) Die 16 gerenderten Seiten derselben Texte in vier Handschrift-Fonts, echt mit GLM-OCR erkannt, also mit echter Lesesicherheit. Die Soll-Marken werden mit `remapGold` auf das Transkript übertragen.
- **Lesesicherheit:** `ocr-run.ts` fordert zusätzlich `logprobs: true` an. llama-server liefert je erzeugtem Token Bytes und Log-Wahrscheinlichkeit. `src/correction/reading-confidence.ts` ordnet daraus jedem Zeichen der Zeilen die Wahrscheinlichkeit seines Tokens zu (UTF-8-genau) und nimmt je Wort das Minimum. Eine Markierung, deren berührte Wörter (bei Auslassungen die Nachbarwörter) unter der Schwelle liegen, wird zum Hinweis „unsicher gelesen“ statt zur Fehlermarke. Hinweise zählen nicht als Fehlalarm, werden aber getrennt ausgewiesen.
- **Wörterbuch:** Prüfung mit hunspell und `dictionary-de` 3.0.0 (igerman98 von Björn Jacke, GPL-2.0 OR GPL-3.0, `index.dic` 1,1 MB, `index.aff` 19 KB). Eine Markierung wird verworfen, wenn ihre Korrektur ein Wort enthält, das das Wörterbuch nicht kennt (bei Bindestrichwörtern genügt es, wenn alle Teile bekannt sind).
- **Prompt-Varianten (`eval/ocr-prompts.ts`):** `app` ist der System-Prompt aus der Registry. `ocr` ergänzt: Der Text stammt aus einer automatischen Handschrifterkennung, kein Wort durch ein Nicht-Wort ersetzen, unbekannte Namen, Fach- und Fremdwörter unverändert lassen. `strict` ergänzt zusätzlich: Nur eindeutige Fehler korrigieren, im Zweifel unverändert.
- **Denken:** Die App schickt Gemma keinen Schalter für das Denken. Alle Varianten laufen deshalb mit `chat_template_kwargs: {enable_thinking: false}`; der App-Request (mit Denken) läuft einmal zum Vergleich.
- **Qwen3-VL 4B:** Dieselben 20 Seiten mit dem Registry-Eintrag `qwen3-vl-4b-q4` (Bildkante 1536, `--image-max-tokens 1024`), danach Gemma mit allen drei Prompts.
- **Intervalle:** Wilson, 95 %. Bei Fehlalarmen je 100 Wörter ist die Grundgesamtheit die Wortzahl der Ground Truth (nur gültige Seiten), Markierungen werden wie unabhängige Ereignisse behandelt. Die Intervalle sind daher eher zu eng.
- **Rechner:** Gemessen auf simon-pc (AMD Ryzen 7 5700X, 8 Threads, nur CPU: `--n-gpu-layers 0 --device none`, llama.cpp `b11537` wie im App-Bundle, Fedora 44). Der Rechner wird nebenher genutzt (Load Average 1 bis 9), die Sekunden sind daher Obergrenzen. Kontrolllauf auf dem Mac (Apple M4 Pro) nur für Zeiten.

Reproduzieren: Siehe [eval/README.md](../../eval/README.md#lesefehler-der-texterkennung). Datensatzbilder, Transkripte und Modellausgaben bleiben außerhalb des Repos.

## Grenzen

- **Keine echte Schülerhandschrift.** Die Fehlalarme sind auf Erwachsenenschrift mit Wikipedia-Fachtext gemessen, der Recall auf getippten und gerenderten Texten. Schülerschrift dürfte schlechter lesbar sein (mehr Hinweise), Schülertext enthält weniger Fremdwörter und Namen (weniger Korrektor-Fehlalarme). Beides muss ein Lauf mit selbst geschriebenen Scans in `eval/samples/scans` bestätigen, bevor die Schwelle endgültig ist.
- **Die gerenderten Fonts sind für GLM-OCR leicht** (1,1 % Zeichenfehler gegenüber 7,1 % auf ScaDS). Wie viele echte Fehler bei echter Schülerschrift in die Hinweise wandern, kann deutlich höher liegen als die gemessenen 25 Prozentpunkte bei 0,95.
- **Qwen3-VL nur auf der Fehlalarm-Seite gemessen.** Auf den gerenderten Schülertexten lief nur GLM-OCR. Dass Qwen3-VL beim Transkribieren Schülerfehler stillschweigend verbessert (17 % laut [2026-10-handschrift.md](2026-10-handschrift.md)), senkt seinen Recall zusätzlich.
- **Eine Antwort je Seite und Variante**, Temperatur 0. Die Intervalle behandeln Marken als unabhängig, obwohl sie sich auf schwierigen Seiten häufen (die Seiten 002 und 003 tragen zusammen 56 der 226 Marken).
- **Ursachen-Zuordnung per Ausrichtung.** Wo die Erkennung Wörter zusammenzieht oder trennt, gilt die Marke als Lesefolgefehler, auch wenn der Korrektor zusätzlich etwas geändert hat. Abschreibfehler der Vorlage sind von Hand gesucht, nicht vollständig.
- **Rauschen ist eine Näherung.** Es verteilt die gelernten Zeichenänderungen gleichmäßig auf Wörter, echte Lesefehler häufen sich in schwer lesbaren Zeilen.
- **Lesesicherheit nur mit dem Token-Minimum je Wort.** Varianten (Mittel, zweitbestes Token, Abstand zur Alternative) sind nicht gemessen; die zweitbesten Token wurden nicht angefordert.
- **Zeiten auf geteiltem Rechner.** simon-pc war nebenher belastet, der Mac-Lauf umfasst nur drei Seiten.
