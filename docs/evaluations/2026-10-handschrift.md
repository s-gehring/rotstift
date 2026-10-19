# Evaluation: Deutsche Handschrift auf der CPU (Oktober 2026)

Frage: Welches lokale Vision-Modell transkribiert deutsche Handschrift auf einem 8-GB-Laptop ohne GPU so, dass Rotstift die Wörter zuverlässig zählt und Fehler danach noch sieht? Budget: Höchstens etwa 5 GB Peak-RAM für den Server.

## Ergebnis

**Standardmodell: GLM-OCR (Q8_0), Bilder mit höchstens 1152 px langer Kante, ohne Bild-Token-Cap.** Auf allen 77 Seiten echter Handschrift weicht die Wortzahl im Mittel um 1,4 % ab (Maximum 8,0 %, exakt auf 42 % der Seiten), über alle Seiten zusammen zählt es 7627 statt 7556 Wörter (+0,9 %). Die CER liegt bei 7,5 %. Der Server braucht 3,2 GB Peak-RAM und 14,2 s pro Seite. Auf den Font-Proben hat GLM-OCR als einziges Modell keinen der eingebauten Schülerfehler verbessert.

**Stärkere Variante: Qwen3-VL 4B Instruct (Q4_K_M) für Rechner mit 16 GB RAM, nur zum Zählen.** Auf den 25 echten Seiten der Vorauswahl trifft es die Wortzahl am besten (Mittel 0,9 %, Maximum 6,0 %, exakt auf 64 % der Seiten, CER 6,7 %), braucht aber 6,8 GB Peak-RAM und 25 s pro Seite. Auf den Font-Proben verbessert es 17 % der eingebauten Schülerfehler und taugt deshalb nicht für die spätere Fehlermarkierung. Wer auf stärkerer Hardware auch Fehler sehen will, bleibt bei GLM-OCR und erhöht `imageMaxEdge` auf 1536: Auf denselben 25 Seiten sinkt die CER von 8,9 auf 7,4 % und die größte Wortzahl-Abweichung von 8,0 auf 5,0 %, bei dreifacher Rechenzeit.

Für die Anbindung in der App wichtig:

- **Schleifenschutz:** Qwen3-VL 2B mit dem strengen Prompt und dots.ocr gerieten auf echter Handschrift in Wiederholungsschleifen („a. a. a. …“) bis zum Token-Limit, mit bis zu 671 Wörtern zu viel auf einer Seite. GLM-OCR brauchte auf keiner Seite mehr als 304 Ausgabe-Token. Trotzdem gehört ein `max_tokens`-Limit in jede Anfrage, und eine Seite, deren Ausgabe das Limit erreicht, sollte als unzuverlässig markiert werden.
- **Richtung der Abweichung:** GLM-OCR zählt eher zu viele Wörter als zu wenige. Es trennt manche zusammengesetzten Wörter („Anzeige fläche“, „Gruppen selbstbewusstsein.“) und liest eine öffnende Klammer oft als „C“. Auf schwer lesbaren Seiten erfindet es Wörter, statt Zeilen auszulassen.
- **Bildgröße:** Mehr Bild-Token helfen nur mäßig. Dieselben 25 Seiten, auf 1536 px hochskaliert (rund 2100 Bild-Token), senken gegenüber der Registry-Einstellung die CER von 8,9 auf 7,4 % und die größte Wortzahl-Abweichung von 8,0 auf 5,0 %, kosten aber fast das Dreifache an Zeit (40 statt rund 14 s pro Seite) und 0,5 GB mehr RAM. Die mittlere Abweichung ändert sich kaum (1,4 statt 1,7 %).

## Empfehlung für die Registry

Die URLs zeigen auf den Commit, der beim Test aktuell war. SHA256 und Größe stammen aus der Hugging-Face-API, die SHA256 hat `eval/download-models.ts` beim Download geprüft.

### Standard: GLM-OCR (Q8_0)

Entspricht dem Eintrag in `src-tauri/models.json` aus [PR #8](https://github.com/s-gehring/rotstift/pull/8).

| Feld                      | Wert                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`                      | `glm-ocr-q8`                                                                                                             |
| `displayName`             | GLM-OCR (Q8_0)                                                                                                           |
| `license`                 | MIT                                                                                                                      |
| `recommendedRamGb`        | 8 (Peak-RSS des Servers 3,2 GB auf echter Handschrift)                                                                   |
| `files.model.url`         | `https://huggingface.co/ggml-org/GLM-OCR-GGUF/resolve/65a42de1148dbed2297e922b5dbc7d9b70c36578/GLM-OCR-Q8_0.gguf`        |
| `files.model.sha256`      | `45bc244a6446aff850521dc41f18bc8d7105ad5f0c2c8c28af04e7cc4f4d50b1`                                                       |
| `files.model.bytes`       | 950433408                                                                                                                |
| `files.mmproj.url`        | `https://huggingface.co/ggml-org/GLM-OCR-GGUF/resolve/65a42de1148dbed2297e922b5dbc7d9b70c36578/mmproj-GLM-OCR-Q8_0.gguf` |
| `files.mmproj.sha256`     | `9c4b58e33e316ed142eb5dcb41abec3844d3e6e5dc361ffb782c3fa9d175141f`                                                       |
| `files.mmproj.bytes`      | 484403648                                                                                                                |
| `server.contextSize`      | 8192                                                                                                                     |
| `server.imageMaxTokens`   | `null` (Modellstandard; mit 1152 px langer Kante lagen die Prompts bei höchstens 1610 Token)                             |
| `server.threads`          | `null` (getestet mit 4 Threads)                                                                                          |
| `server.gpuLayers`        | `null` (getestet rein auf der CPU)                                                                                       |
| `request.maxOutputTokens` | 2048 (gebraucht wurden höchstens 304 Token pro Seite)                                                                    |
| `request.temperature`     | 0                                                                                                                        |
| `request.imageMaxEdge`    | 1152                                                                                                                     |
| `prompt`                  | `Text Recognition:` (Prompt aus der Modellkarte; das Bild steht vor dem Text in derselben Nachricht)                     |

### Stärker, nur zum Zählen: Qwen3-VL 4B Instruct (Q4_K_M)

Gemessen mit `--image-max-tokens 1024` und Kontext 4096 auf den 25 Seiten der Vorauswahl.

| Feld                      | Wert                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | `qwen3-vl-4b-q4`                                                                                                                              |
| `displayName`             | Qwen3-VL 4B Instruct (Q4_K_M)                                                                                                                 |
| `license`                 | Apache-2.0                                                                                                                                    |
| `recommendedRamGb`        | 16 (Peak-RSS des Servers 6,8 GB auf echter Handschrift, 7,8 GB auf vollen A4-Seiten ohne Token-Cap mit Kontext 8192)                          |
| `files.model.url`         | `https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/1cd86afb9a95c410a6038ab3b40d8b578c892266/Qwen3VL-4B-Instruct-Q4_K_M.gguf`      |
| `files.model.sha256`      | `66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a`                                                                            |
| `files.model.bytes`       | 2497281664                                                                                                                                    |
| `files.mmproj.url`        | `https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/1cd86afb9a95c410a6038ab3b40d8b578c892266/mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf` |
| `files.mmproj.sha256`     | `30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d`                                                                            |
| `files.mmproj.bytes`      | 453974304                                                                                                                                     |
| `server.contextSize`      | 4096                                                                                                                                          |
| `server.imageMaxTokens`   | 1024                                                                                                                                          |
| `server.threads`          | `null` (getestet mit 4 Threads)                                                                                                               |
| `server.gpuLayers`        | `null` (getestet rein auf der CPU)                                                                                                            |
| `request.maxOutputTokens` | 2048 (gebraucht wurden höchstens 260 Token pro Seite)                                                                                         |
| `request.temperature`     | 0                                                                                                                                             |
| `request.imageMaxEdge`    | 1536                                                                                                                                          |
| `prompt`                  | `TRANSCRIBE_PROMPT` aus `eval/models.ts`, siehe unten                                                                                         |

Prompt für Qwen3-VL 4B (`TRANSCRIBE_PROMPT`, vor dem Text steht das Bild in derselben Nachricht):

> Transkribiere den handschriftlichen Text auf dem Bild buchstabengetreu. Korrigiere nichts: Rechtschreibung, Groß- und Kleinschreibung, Grammatik und Zeichensetzung bleiben genau so, wie sie geschrieben sind, auch wenn sie falsch sind. Behalte die Absätze bei. Gib nur den Text aus, ohne Einleitung und ohne Kommentar.

Der strengere `STRICT_PROMPT` ist nicht zu empfehlen: Er treibt Qwen3-VL 2B auf echter Handschrift in Endlosschleifen.

## Echte Handschrift

Quelle: Thomas Burghardt und Till Nestler (ScaDS.AI Dresden/Leipzig), _ScaDS.AI German Handwriting Full-Page Dataset_, Version 1.0, Zenodo 2026, [doi:10.5281/zenodo.18283705](https://doi.org/10.5281/zenodo.18283705), Lizenz [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Der Datensatz liegt nicht im Repo, das Harness liest ihn mit `--dataset`.

77 Seiten moderne deutsche Handschrift von Erwachsenen (Jahrgänge 1957 bis 2004), jeweils ein abgeschriebener Wikipedia-Auszug mit Überschrift und Absätzen, rund 100 Wörter pro Seite, nach `countWords` 7556 Wörter insgesamt. Die Bilder sind klein: Meist etwa 750 × 1050 px, insgesamt zwischen 745 × 380 und 1592 × 1998 px. Es gibt keine eingebauten Fehler, „Fehler korrigiert“ lässt sich hier also nicht messen.

### Vorauswahl auf 25 Seiten

Jede dritte Seite (`000` bis `072`), Kontext 4096, höchstens 1024 Bild-Token (MiniCPM-V ohne Cap), Standard-Prompt bzw. Modell-Prompt. Die letzte Zeile ist GLM-OCR mit auf 1536 px hochskalierten Seiten, ohne Cap und mit Kontext 8192.

| Modell                                | Peak-RAM (GB) | s/Seite (Median) | Wortzahl-Abw. (Mittel) | Wortzahl-Abw. (Max) | Wortzahl exakt |    CER |     WER |
| ------------------------------------- | ------------: | ---------------: | ---------------------: | ------------------: | -------------: | -----: | ------: |
| **GLM-OCR (Q8_0)**                    |          2,61 |             12,5 |                  1,6 % |               8,0 % |           40 % |  8,7 % |  24,6 % |
| Qwen3-VL 2B (Q4_K_M)                  |          3,91 |             12,4 |                  2,4 % |              28,7 % |           36 % |  9,9 % |  19,6 % |
| Qwen3-VL 2B (Q4_K_M), strenger Prompt |          3,92 |             13,4 |                 81,8 % |             706,3 % |           36 % | 76,8 % | 102,4 % |
| MiniCPM-V 4.6 (Q8_0)                  |          2,58 |              7,7 |                  2,7 % |              21,8 % |           36 % | 21,0 % |  45,9 % |
| dots.ocr (Q8_0)                       |          6,42 |             31,8 |                 27,6 % |             657,0 % |           44 % | 29,6 % |  46,8 % |
| Qwen3-VL 4B (Q4_K_M)                  |          6,84 |             25,0 |                  0,9 % |               6,0 % |           64 % |  6,7 % |  15,1 % |
| GLM-OCR (Q8_0), 1536 px               |          3,67 |             40,4 |                  1,4 % |               5,0 % |           32 % |  7,4 % |  22,3 % |

- **Qwen3-VL 4B** liest am besten, liegt mit 6,8 GB aber weit über dem Budget.
- **GLM-OCR** hat im Budget die kleinste Wortzahl-Abweichung, im Mittel wie im Maximum. Die größten Abweichungen kommen von getrennten Komposita und als „C“ gelesenen Klammern. Auf drei sehr kleinen oder schwer lesbaren Seiten (`027`, `045`, `066`) erfindet es Text (CER 25 bis 36 %), die Wortzahl bleibt dort aber innerhalb von 4 %.
- **Qwen3-VL 2B** liest einzelne Wörter etwas besser (niedrigere WER), lässt aber ganze Zeilen aus: Auf `033` fehlen 29 von 101 Wörtern. Für das Zählen ist das der schlimmere Fehler.
- **Strenger Prompt:** Mit `STRICT_PROMPT` gerät Qwen3-VL 2B auf 5 von 25 Seiten in eine Endlosschleife, mit dem Standard-Prompt auf keiner.
- **MiniCPM-V 4.6** ist am schnellsten, liest echte Handschrift aber deutlich schlechter.
- **dots.ocr** liegt über dem Budget und gerät auf `027` in eine Schleife. Ohne diese Seite käme es auf 7,9 % CER.

### GLM-OCR auf allen 77 Seiten

Beide Läufe mit allen 77 Seiten. „Registry“ ist die Konfiguration aus der Tabelle oben: Bilder größer als 1152 px (13 von 77) vorab auf 1152 px verkleinert, kein Token-Cap, Kontext 8192, höchstens 2048 Ausgabe-Token.

| Konfiguration                                 | Peak-RAM (GB) | s/Seite (Median) | Wortzahl-Abw. (Mittel) | Wortzahl-Abw. (Max) | Wortzahl exakt |   CER |    WER |
| --------------------------------------------- | ------------: | ---------------: | ---------------------: | ------------------: | -------------: | ----: | -----: |
| **Registry: 1152 px, ohne Cap, Kontext 8192** |          3,17 |             14,2 |                  1,4 % |               8,0 % |           42 % | 7,5 % | 22,9 % |
| 1024 Bild-Token, Kontext 4096                 |          2,62 |             12,4 |                  1,5 % |               8,0 % |           38 % | 7,5 % | 23,4 % |

Auf 37 Seiten zählt GLM-OCR zu viele Wörter, auf 8 zu wenige, auf 32 genau richtig. Die größten Abweichungen (+8 auf `003` und `034`) kommen von getrennten Komposita und als „C“ gelesenen Klammern. Keine Seite brauchte mehr als 304 Ausgabe-Token.

## Font-Proben

Die Font-Proben sind synthetisch: 4 selbst geschriebene Schülertexte mit 43 eingebauten Fehlern, gesetzt in 4 Handschrift-Fonts (Aufbau unten). Sie messen vor allem, ob ein Modell Fehler stehen lässt, und sind für die Lesbarkeit deutlich zu leicht.

### Alle 16 Seiten

Kontext 8192, Standard-Prompt bzw. Modell-Prompt, ohne Token-Cap. Die beiden letzten Zeilen sind Varianten mit Token-Cap.

| Modell                                                   | Peak-RAM (GB) | s/Seite (Median) | Wortzahl-Abw. (Mittel) | Wortzahl-Abw. (Max) | Wortzahl exakt | Fehler korrigiert | Fehler erhalten |   CER |
| -------------------------------------------------------- | ------------: | ---------------: | ---------------------: | ------------------: | -------------: | ----------------: | --------------: | ----: |
| **GLM-OCR (Q8_0)**                                       |          3,36 |             60,5 |                  0,2 % |               0,8 % |           81 % |             0,0 % |          90,1 % | 0,9 % |
| Qwen3-VL 2B (Q8_0)                                       |          6,11 |             44,7 |                  0,0 % |               0,7 % |           94 % |            15,7 % |          82,6 % | 0,4 % |
| Qwen3-VL 4B (Q4_K_M)                                     |          7,80 |             65,8 |                  0,0 % |               0,7 % |           94 % |            17,4 % |          79,7 % | 0,4 % |
| MiniCPM-V 4.6 (Q8_0)                                     |          2,59 |             11,6 |                  0,5 % |               2,3 % |           56 % |            11,6 % |          68,6 % | 2,0 % |
| LightOnOCR-2 1B (Q8_0)                                   |          3,60 |             42,1 |                  3,6 % |              10,8 % |           38 % |             7,6 % |          86,0 % | 6,3 % |
| Gemma 4 E2B it (Q4_0)                                    |          5,93 |             23,6 |                  0,0 % |               0,0 % |          100 % |            49,4 % |          47,7 % | 1,2 % |
| Gemma 4 E4B it (Q4_0)                                    |          9,17 |             30,0 |                  0,2 % |               0,8 % |           75 % |            54,7 % |          40,7 % | 1,1 % |
| GLM-OCR (Q8_0), Cap 1232 (1200 Bild-Token, etwa 1152 px) |          2,84 |             16,5 |                  0,2 % |               0,8 % |           81 % |             0,0 % |          91,3 % | 1,0 % |
| Qwen3-VL 2B (Q4_K_M), 1024 Bild-Token, Kontext 4096      |          3,72 |             16,1 |                  0,1 % |               0,8 % |           88 % |            22,7 % |          72,7 % | 0,6 % |

PaddleOCR-VL 1.6 und dots.ocr waren zu langsam für alle 16 Seiten und liefen auf 4 Seiten (eine je Text und Schrift):

| Modell                  | Peak-RAM (GB) | s/Seite (Median) | Wortzahl-Abw. (Mittel) | Wortzahl exakt | Fehler korrigiert | Fehler erhalten |   CER |
| ----------------------- | ------------: | ---------------: | ---------------------: | -------------: | ----------------: | --------------: | ----: |
| PaddleOCR-VL 1.6 (BF16) |          2,44 |            324,2 |                  0,2 % |           75 % |             2,3 % |          93,0 % | 0,5 % |
| dots.ocr (Q8_0)         |          6,08 |            149,6 |                  0,0 % |          100 % |             4,7 % |          95,3 % | 0,1 % |

- **Eigenmächtiges Korrigieren** ist das wichtigste Ausschlusskriterium. Gemma 4 trifft die Wortzahl perfekt, verbessert aber die Hälfte der Schülerfehler. Die Wortzahl allein reicht also nicht als Kennzahl. Qwen3-VL verbessert trotz des Prompts jeden sechsten Fehler, meist Rechtschreibung („Schockolade“, „heftich“, „sinvoll“).
- **GLM-OCR** lässt alle Fehler stehen, die es lesen kann. Seine Wortzahl-Abweichungen kommen von „nächstes jahr.“, das es dreimal zu einem Wort zusammenzieht. In der verbundenen Schulausgangsschrift verwechselt es t und s (CER 3,4 % gegenüber 0,0 bis 0,2 % in den anderen Schriften).
- **LightOnOCR-2** gibt den Text als HTML-Tabelle aus (`<table><tr><td>…`). Das bläht die Wortzahl um bis zu 13 Wörter pro Seite auf.

### Budget für Qwen3-VL 2B

Peak-RAM ist der RSS des Servers. Er enthält die per mmap geladenen Gewichte, die Rechenpuffer des Vision-Encoders und den KV-Cache. Bei Qwen3-VL 2B in Q8_0 sind die Gewichte 2,3 GB groß. Der Rest des Peaks von 6,1 GB sind KV-Cache und Rechenpuffer, die mit Kontext und Zahl der Bild-Token wachsen. Eine volle A4-Seite in 1240 × 1754 px ergibt rund 2100 Bild-Token.

Mit Q4_K_M statt Q8_0, höchstens 1024 Bild-Token und Kontext 4096 sinkt der Peak auf 3,7 GB auf den Font-Proben und 3,9 GB auf echter Handschrift. Damit passt Qwen3-VL 2B ins Budget. Auf den Font-Proben bleibt die Wortzahl fast so genau (exakt auf 88 statt 94 % der Seiten, Maximum 0,8 statt 0,7 %), es verbessert aber mehr Fehler (22,7 statt 15,7 %). Auf echter Handschrift lässt es Zeilen aus und liegt bei der Wortzahl hinter GLM-OCR (Maximum 28,7 statt 8,0 %). Die drei Hebel (Quantisierung, Token-Cap, Kontext) sind nur zusammen gemessen, nicht einzeln.

## Aufbau

- **Runtime:** llama.cpp `b11537` (derselbe `llama-server` wie im App-Bundle), rein CPU: `--n-gpu-layers 0 --device none --no-mmproj-offload`, 4 Threads, Temperatur 0, höchstens 1536 Ausgabe-Token (2048 im Registry-Lauf und bei der GLM-Variante mit Cap 1232), Prompt-Cache aus. Kontext und Bild-Token-Cap stehen jeweils an der Tabelle.
- **Hardware:** Apple M4 Pro (8 Performance- und 4 Effizienzkerne), 48 GB RAM, macOS 26.6.2. Die 4 Threads laufen auf Performance-Kernen, die deutlich schneller sind als die CPU eines typischen 8-GB-Laptops. Die Sekunden pro Seite sind deshalb eine Untergrenze. Während eines Teils der Font-Läufe liefen auf den Effizienzkernen Builds mit.
- **Font-Proben:** 4 selbst geschriebene Texte (Ferienerlebnis, Handy-Erörterung, Brief, Inhaltsangabe) mit 511 Wörtern und 43 eingebauten Fehlern (28 Rechtschreibung, 9 Zeichensetzung, 6 Grammatik). Jeder Text ist mit 4 OFL-Schriften aus `google/fonts` gesetzt: Playwrite DE Grund (Grundschrift), Playwrite DE SAS (Schulausgangsschrift, verbunden), Caveat und Indie Flower. Das ergibt 16 Seiten A4 mit 1240 × 1754 px, Lineatur, Randlinie, blauer Tinte, leichtem Zittern, Unschärfe, Rauschen und Drehung, als JPEG.
- **Auftrag:** Deutscher Prompt, der buchstabengetreues Abschreiben ohne Korrektur verlangt (`TRANSCRIBE_PROMPT` in `eval/models.ts`), dazu als Variante ein strengerer Prompt (`STRICT_PROMPT`). Die OCR-Spezialmodelle bekommen stattdessen ihren eigenen Prompt aus der Modellkarte.
- **Kennzahlen:** Die Wortzahl zählt `countWords` aus `src/stats/count-words.ts` auf Transkript und Soll-Text. Die Abweichung ist der Betrag der Differenz relativ zum Soll, gemittelt über die Seiten. CER und WER nach Levenshtein gegen den Text, wie er geschrieben steht (über alle Seiten gepoolt). „Fehler erhalten“ ist der Anteil der eingebauten Fehler, die wörtlich im Transkript stehen, „Fehler korrigiert“ der Anteil, den das Modell eigenmächtig verbessert hat. Peak-RAM ist der höchste RSS des Servers, alle 200 ms abgefragt.

Nachstellen: Siehe [eval/README.md](../../eval/README.md).

## Kandidaten

Alle Dateien kommen aus den offiziellen Repos der Hersteller oder von `ggml-org` (dem llama.cpp-Projekt) auf Hugging Face und sind in `eval/models.ts` per SHA256 gepinnt.

| Modell               | Quelle                               | Quantisierung | Lizenz     |
| -------------------- | ------------------------------------ | ------------- | ---------- |
| Qwen3-VL 2B Instruct | `ggml-org/Qwen3-VL-2B-Instruct-GGUF` | Q8_0          | Apache-2.0 |
| Qwen3-VL 2B Instruct | `Qwen/Qwen3-VL-2B-Instruct-GGUF`     | Q4_K_M        | Apache-2.0 |
| Qwen3-VL 4B Instruct | `Qwen/Qwen3-VL-4B-Instruct-GGUF`     | Q4_K_M        | Apache-2.0 |
| Gemma 4 E2B it       | `ggml-org/gemma-4-E2B-it-GGUF`       | Q4_0          | Apache-2.0 |
| Gemma 4 E4B it       | `ggml-org/gemma-4-E4B-it-GGUF`       | Q4_0          | Apache-2.0 |
| MiniCPM-V 4.6        | `ggml-org/MiniCPM-V-4.6-GGUF`        | Q8_0          | Apache-2.0 |
| GLM-OCR              | `ggml-org/GLM-OCR-GGUF`              | Q8_0          | MIT        |
| PaddleOCR-VL 1.6     | `PaddlePaddle/PaddleOCR-VL-1.6-GGUF` | BF16          | Apache-2.0 |
| LightOnOCR-2 1B      | `ggml-org/LightOnOCR-2-1B-GGUF`      | Q8_0          | Apache-2.0 |
| dots.ocr             | `ggml-org/dots.ocr-GGUF`             | Q8_0          | MIT        |

Nicht getestet:

- **HunyuanOCR:** Die Lizenz schließt die EU aus.
- **Qwen3.5 4B:** Kein offizielles GGUF mit mmproj.
- **Qianfan-OCR:** Schon die kleinste offizielle Quantisierung liegt über 5 GB.

## Grenzen

- **Keine echte Schülerhandschrift:** Die echten Seiten stammen von Erwachsenen und enthalten keine eingebauten Fehler, die Font-Proben enthalten Fehler, sind aber synthetisch. Ob GLM-OCR Fehler in echter Kinderhandschrift stehen lässt, ist nicht gemessen.
- **Bildqualität:** Die Seiten des Datensatzes sind kleiner als ein typischer Scan mit 150 bis 300 dpi. Ob schärfere Scans besser abschneiden, ist nicht gemessen. Schon hochskalierte Seiten senken die CER etwas.
- **Zeiten:** Gemessen auf einem schnellen Rechner. Auf einem typischen 8-GB-Laptop ohne GPU dauert es deutlich länger, gemessen ist das nicht.
- **Ein Lauf je Konfiguration:** Alle Läufe mit Temperatur 0 und je einmal. Die Vorauswahl auf 25 Seiten ist etwas schwerer als der ganze Datensatz (GLM-OCR: CER 8,7 gegenüber 7,5 %).
