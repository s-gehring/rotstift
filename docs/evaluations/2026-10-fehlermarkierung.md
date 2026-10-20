# Evaluation: Fehlermarkierung mit lokalen Text-Modellen (Oktober 2026)

Frage: Welches lokale Text-Modell setzt in deutschen Schülertexten die Korrekturzeichen aus ADR 0002, läuft auf einem 8-GB-Laptop ohne GPU nacheinander nach GLM-OCR und bleibt dabei bei höchstens etwa 5 GB Peak-RAM? Die Schwere eines Fehlers ist nicht Teil der Frage.

## Ergebnis

**Das ADR-Format direkt vom Modell zu verlangen, funktioniert mit keinem getesteten Modell.** Mit dem Prompt aus `buildSpecification` (und mit einer erweiterten Variante samt Beispiel) setzt kein Modell nennenswert Marken. Das beste erreicht 1 von 43 Fehlern (Qwen3 4B Instruct 2507, 2,3 % Recall), die meisten kopieren die Zeilen unverändert oder verbessern den Text still, und bis zu 100 % der Antworten sind nicht parsbar. Auch ein JSON-Fehlerlisten-Format (schemaerzwungen) liefert höchstens 37 % Recall mit erfundenen Einträgen.

**Was funktioniert: Das Modell korrigiert den Text, der Code leitet die Marken per Wortvergleich ab.** Das Modell bekommt die nummerierten Zeilen und gibt dieselben Zeilen korrigiert zurück. Ein Vergleich von Original und Korrektur (`eval/correct-diff.ts`) erzeugt daraus `<rs-error>` und `<rs-missing>` samt `fix`, die Art (R, Z, G) bestimmt eine einfache Regel, die Grammatikfehler schlecht trifft (siehe unten). Der Original-Text ist damit per Konstruktion erhalten, und `parseTranscript` akzeptiert jede abgeleitete Ausgabe.

**Empfehlung: Gemma 4 E2B it (Q4_0), 2,84 GB, Apache-2.0.** Auf den vier Schülertexten (511 Wörter, 43 Fehler) findet es 36 Fehler (Recall 83,7 % mit 95-%-Intervall 70,0 bis 91,9 %, Precision 94,7 % mit 82,7 bis 98,5 %; nur 43 Fehler, ein Lauf je Modell), jede gefundene Korrektur ist richtig (100 %), nach Anwenden aller Markierungen bleiben 6 statt 45 Wortfehler. Auf fehlerfreiem Text setzt es 0,0 Marken je 100 Wörter (korrigierte Schülertexte). Auf Erwachsenenschrift aus dem ScaDS-Datensatz sind es 2,8, von denen viele echte Tippfehler der Vorlage sind. 95 % der Antworten sind beim ersten Versuch gültig, 100 % nach einer Reparatur. Der Server braucht auf dem Mac 4,7 GB Peak-RAM und rund 4,7 s je Seite von etwa 100 Wörtern (mit `--no-repack` 3,4 GB bei etwa 30 bis 50 % mehr Zeit). Auf einem Ryzen 7 5700X (simon-pc) mit 4 Threads sind es 4,1 GB und 24,7 s je Seite, mit 8 Threads 16,1 s, mit `--no-repack` 3,1 GB und 17,8 s.

**Zweiter Platz: Gemma 4 E4B it (Q4_0).** Etwas besser (Recall 86,0 %, Z-Fehler 100 %, 4 Restfehler), aber mit 8,1 GB Peak-RAM weit über dem Budget, doppelt so langsam (9,1 s je Seite) und mit mehr Fehlalarmen (3,1 auf ScaDS, 0,6 auf Schülertext). Nur für Rechner mit 16 GB sinnvoll.

**Ein Modell für beide Schritte: nur eingeschränkt.** GLM-OCR (Recall 0 %) und Qwen3-VL 2B (0 %) können den Schritt nicht. Qwen3-VL 4B (Q4_K_M) kann beide (Recall 76,7 %, Precision 86,8 %, 5,9 GB Peak-RAM, 10,1 s je Seite), liegt aber über dem 5-GB-Budget und ist bei der Fehlererkennung schlechter als Gemma E2B. Es verbessert außerdem beim Transkribieren 17 % der Schülerfehler (siehe [2026-10-handschrift.md](2026-10-handschrift.md)), das passt nicht zu einer Fehlermarkierung. Gemma 4 verbessert beim Transkribieren sogar die Hälfte der Fehler. Zwei Modelle nacheinander sind die bessere Lösung.

**Grammatik: Die Modelle finden einen Teil, die Regel für die Fehlerart macht R daraus.** Gemma 4 E2B korrigiert 2 der 6 Grammatikfehler an der richtigen Stelle (E4B 3), die einfache Regel in `eval/correct-diff.ts` führt jeden Ein-Wort-Tausch mit Editierabstand bis 2 aber als R. „möchte“ statt „möchten“, „ihn“ statt „ihm“, „dem“ statt „des“ und „Regen“ statt „Regens“ werden so zu R, obwohl das Modell sie korrekt verbessert (4 der 6 Soll-Fälle landen auch bei perfekter Korrektur nicht bei G). Der G-Recall von 0 % in den Tabellen misst deshalb die Regel, nicht das Modell. Nur an der Stelle gemessen liegt der G-Recall bei 33,3 % (E2B) und 50,0 % (E4B). Rechtschreibung (R: 100 %) und Zeichensetzung (Z: 88,9 %) funktionieren. A, Sb, T, Bz und W kann das Verfahren nicht liefern, weil ein Textvergleich keine Fehlerart wie Ausdruck oder Stil ableiten kann.

**Ende-zu-Ende mit OCR-Text:** Mit den Transkripten von GLM-OCR auf den 16 Font-Seiten (172 Fehler, davon 156 vom OCR-Text unverändert erhalten) trifft Gemma E2B 129 der 156 Fehler (Recall 82,7 %, Precision 57,6 %). Die Precision sinkt, weil die OCR eigene Fehler macht (vor allem t und s in der Schulausgangsschrift), die das Modell korrigiert und die als Markierung auftauchen: 5,9 falsche Marken je Seite, bei der Schulausgangsschrift bis zu 29.

Für die Anbindung in der App wichtig:

- **Das Format ändern:** Das Modell darf nicht die Marken ausgeben, sondern den korrigierten Text. Die Marken entstehen im Code (Abschnitt „Vorschlag für `src/`“).
- **Reparatur:** Beim Gemma-E2B-Lauf war 1 von 20 Antworten beim ersten Versuch ungültig (die Ausgabe brach nach Zeile 7 ab, die Zeilen 8 bis 12 fehlten). Die Wiederholung mit der Liste der fehlenden Zeilen genügte immer.
- **Fehlalarme:** Auf den korrigierten Schülertexten setzt Gemma E2B keine einzige Marke. Auf den 12 ScaDS-Seiten sind es 34 (17 R, 9 Z, 8 G), darunter echte Tippfehler der Vorlage und unlesbare Fachwörter („AwtoWAS“).
- **Arbeitsspeicher:** Auf macOS liegt der Peak etwa beim Doppelten der Gewichte, weil llama.cpp sie für die CPU umpackt. `--no-repack` senkt Gemma E2B von 4,7 auf 3,4 GB (auf dem Ryzen von 4,1 auf 3,1 GB). Auf dem Mac kostet das Zeit, auf dem Ryzen war es nicht langsamer.

## Empfehlung für die Registry

Die URLs zeigen auf den Commit, der beim Test aktuell war. SHA256 und Größe stammen aus der Hugging-Face-API, die SHA256 hat `eval/download-models.ts` beim Download geprüft.

### Korrektor: Gemma 4 E2B it (Q4_0)

| Feld                      | Wert                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | `gemma-4-e2b-q4`                                                                                                                |
| `displayName`             | Gemma 4 E2B it (Q4_0)                                                                                                           |
| `license`                 | Apache-2.0                                                                                                                      |
| `recommendedRamGb`        | 8 (Peak-RSS des Servers 4,7 GB, 3,4 GB mit `--no-repack`)                                                                       |
| `files.model.url`         | `https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/6938c58e698502037401a5f19f6905f2fb2f7dee/gemma-4-E2B-it-Q4_0.gguf` |
| `files.model.sha256`      | `8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52`                                                              |
| `files.model.bytes`       | 2841481184                                                                                                                      |
| `files.mmproj`            | nicht vorhanden (reines Text-Modell, die Bild-Teile der Datei bleiben ungenutzt)                                                |
| `server.contextSize`      | 4096 (größter Prompt in den Läufen 1002 Token, größte Ausgabe 409 Token, beides bei Seiten von etwa 100 Wörtern)                |
| `server.imageMaxTokens`   | entfällt                                                                                                                        |
| `server.threads`          | `null` (getestet mit 4 Threads)                                                                                                 |
| `server.gpuLayers`        | `null` (getestet rein auf der CPU)                                                                                              |
| `server.cpuRepack`        | `false` auf Rechnern mit 8 GB (`--no-repack`), sonst `true`                                                                     |
| `request.maxOutputTokens` | 2048                                                                                                                            |
| `request.temperature`     | 0                                                                                                                               |
| `request.imageMaxEdge`    | entfällt                                                                                                                        |
| `prompt`                  | Siehe „Prompt“, `{subject}` ist das Fach aus dem Profil                                                                         |

Stärker, aber nur für Rechner mit 16 GB: `gemma-4-e4b-q4` (Gemma 4 E4B it, Q4_0, Apache-2.0), `https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/a69f018d7678a2b9f5e705f8903d6fb29b9b25dc/gemma-4-E4B-it-Q4_0.gguf`, SHA256 `a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2`, 4590807392 Bytes, Peak-RSS 8,1 GB, sonst dieselben Werte.

### Vorschlag: zweite Rolle in `src-tauri/models.json`

Heute beschreibt jeder Eintrag ein Vision-Modell, das ein Bild transkribiert. Ein Korrektor braucht keine Bilder und keinen `mmproj`. Vorschlag, ohne die bestehenden Einträge zu ändern:

```json
{
  "models": [
    {
      "id": "glm-ocr-q8",
      "role": "transcriber",
      "...": "unverändert"
    },
    {
      "id": "gemma-4-e2b-q4",
      "role": "corrector",
      "displayName": "Gemma 4 E2B it (Q4_0)",
      "license": "Apache-2.0",
      "recommendedRamGb": 8,
      "files": {
        "model": {
          "name": "gemma-4-E2B-it-Q4_0.gguf",
          "url": "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/6938c58e698502037401a5f19f6905f2fb2f7dee/gemma-4-E2B-it-Q4_0.gguf",
          "sha256": "8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52",
          "bytes": 2841481184
        }
      },
      "server": {
        "contextSize": 4096,
        "threads": null,
        "gpuLayers": null,
        "cpuRepack": false
      },
      "request": { "maxOutputTokens": 2048, "temperature": 0 },
      "prompt": "Du korrigierst die Fehler in einer Schülerarbeit. Fach: {subject}. …"
    }
  ],
  "defaults": { "transcriber": "glm-ocr-q8", "corrector": "gemma-4-e2b-q4" }
}
```

- **`role`:** `transcriber` oder `corrector`. Die Auswahl in der App filtert danach, jede Rolle hat ein eigenes Standardmodell (`defaults`).
- **Pflichtfelder je Rolle:** Beim `transcriber` bleiben `files.mmproj`, `server.imageMaxTokens` und `request.imageMaxEdge` wie bisher Pflicht. Beim `corrector` entfallen sie (sie sind nicht vorhanden statt `null`), `files.model` genügt.
- **`server.cpuRepack`:** Boolean, `false` startet `llama-server` mit `--no-repack`. Gebraucht für Rechner mit 8 GB. Auf dem Mac kostet es 30 bis 50 % Zeit, auf dem Ryzen war es nicht langsamer, und es spart 1 bis 1,3 GB Peak-RAM. Freie Argumente sind nicht nötig.
- **`prompt`:** Eine Vorlage mit `{subject}`, aus dem Profil befüllt. Der Prompt ist nicht an das Modell gebunden, aber an das Verfahren.
- **Nacheinander laden:** Die App startet den Transkriptions-Server, wartet auf die Seite, stoppt ihn und startet dann den Korrektur-Server. Es läuft nie beides gleichzeitig, der Peak ist der größere der beiden (hier 4,7 GB), nicht die Summe. Die Ladezeit des Korrektors lag bei 2,5 s.
- **Download:** Beide Modelle zusammen sind 4,3 GB (GLM-OCR 1,4 GB, Gemma E2B 2,8 GB). Die App kann den Korrektor erst beim ersten Klick auf „Berichtigen“ laden.

## Vorschlag für `src/` (nicht umgesetzt)

`src/` wurde nicht geändert. Die Evaluation legt nahe:

- **Das Verfahren ändern, nicht den Parser.** `serializeTranscript`, `parseTranscript` und das Marken-Modell passen. Neu ist nur ein Schritt vor dem Parser: Das Modell gibt die korrigierten Zeilen (`n: Text`) aus, und eine Funktion (`diffMarks` in `eval/correct-diff.ts`) erzeugt daraus `<rs-error>` und `<rs-missing>`. Das Ergebnis geht durch `parseTranscript` mit dem Profil und dem Quelltext, wie vorgesehen.
- **`buildSpecification`** bleibt für das Zielformat richtig, wird aber nicht mehr an das Modell geschickt. Wer das ADR-Format später wieder direkt verlangen will (stärkere Modelle), kann es dort lassen.
- **Reparatur:** Es genügt eine Wiederholung, die alle fehlenden Zeilen auflistet.
- **Art der Marke:** Z, wenn nur Satzzeichen abweichen, R bei Groß- und Kleinschreibung, Leerzeichen oder einem einzelnen Wort mit Abstand höchstens 2, sonst G. Ob das für Lehrkräfte als Schätzung genügt, ist offen (4,7 % Falschtyp bei Gemma E2B).
- **Block-Größe:** Die Ableitung verwirft Änderungsblöcke, in denen auf einer Seite des Vergleichs mehr als 3 Wörter stehen (Umformulierungen), damit das Modell nichts umschreibt. Die Grenze gilt je Block, nicht je Seite. Gemma E2B verwarf auf allen 20 Texten (2219 Wörter) 12 solche Blöcke (0,5 je 100 Wörter), E4B 2, Qwen3-VL 4B 14.

## Prompt

Der Prompt, mit dem alle Zahlen gemessen sind (`diffMessages` in `eval/correct-diff.ts`), System-Nachricht:

```text
Du korrigierst die Fehler in einer Schülerarbeit. Fach: Deutsch.
Die Eingabe besteht aus nummerierten Zeilen. Gib genau dieselben Zeilen mit derselben Nummerierung aus, in denen die Fehler behoben sind: Rechtschreibung (auch Groß- und Kleinschreibung und Getrennt- und Zusammenschreibung), Zeichensetzung (fehlende oder falsche Kommas und andere Satzzeichen) und Grammatik (Fall, Zahl, Artikel, Verbform).
Ändere sonst nichts: keine Umformulierung, keine Stiländerung, keine neuen Sätze. Zeilen ohne Fehler bleiben unverändert. Gib nur die Zeilen aus, ohne Erklärung.
```

Benutzer-Nachricht: Die Zeilen als `1: Text`, `2: Text`, …, eine je Zeile. Der Text ist wortgleich der Transkript-Text, der Zeilenumbruch kommt von der OCR oder (hier) aus dem Umbruch bei 60 Zeichen.

Reparatur bei fehlenden Zeilen, als zusätzliche Runde (Assistent-Antwort wiederholt, dann):

```text
Die Ausgabe ist nicht gültig:
- Zeile 7 fehlt in der Ausgabe.
Gib alle Zeilen noch einmal mit ihrer Nummer aus.
```

Eine Variante mit Checkliste („Achte besonders auf: das/dass, fehlende Kommas …“) brachte bei Gemma E2B keinen Gewinn und steht nicht in der Empfehlung.

## Messergebnisse

Die Zahlen stehen mit Dezimalkomma, die Zeiten der Haupttabellen sind vom Mac (Zeiten vom zweiten Rechner stehen in einem eigenen Abschnitt). Kontext 4096, 4 Threads, nur CPU, Temperatur 0, höchstens 2048 Ausgabe-Token, Prompt-Cache aus. 20 Texte: 4 Schülertexte mit Fehlern (511 Wörter, 43 Fehler), dieselben 4 korrigiert (510 Wörter), 12 Seiten Erwachsenenschrift aus ScaDS (1198 Wörter, ohne Marken im Soll).

### Hauptlauf: Korrigieren und vergleichen

Alle Modelle mit demselben Prompt und derselben Ableitung.

| Modell                         | Dateien (GB) | Peak-RAM (GB) | s/Seite (Median) | gültig (1. Versuch) | gültig (nach Reparatur) | Recall | Precision | Korrektur richtig | Fehlalarme je 100 Wörter (Schülertext / ScaDS) | Wortfehler vorher → nachher |
| ------------------------------ | -----------: | ------------: | ---------------: | ------------------: | ----------------------: | -----: | --------: | ----------------: | ---------------------------------------------: | --------------------------: |
| **Gemma 4 E2B it (Q4_0)**      |         2,84 |          4,74 |              4,7 |              95,0 % |                 100,0 % | 83,7 % |    94,7 % |           100,0 % |                                      0,0 / 2,8 |                      45 → 6 |
| Gemma 4 E4B it (Q4_0)          |         4,59 |          8,08 |              9,1 |             100,0 % |                 100,0 % | 86,0 % |    90,2 % |            97,3 % |                                      0,6 / 3,1 |                      45 → 4 |
| Qwen3-VL 4B (Q4_K_M), nur Text |         2,50 |          5,85 |             10,1 |             100,0 % |                 100,0 % | 76,7 % |    86,8 % |           100,0 % |                                      0,2 / 2,2 |                     45 → 13 |
| Granite 4.1 3B (Q4_K_M)        |         2,10 |          4,75 |              8,6 |              90,0 % |                 100,0 % | 48,8 % |    63,6 % |            95,2 % |                                      0,4 / 1,8 |                     45 → 27 |
| Ministral 3 3B (Q4_K_M)        |         2,15 |          4,94 |             15,4 |              40,0 % |                 100,0 % | 41,9 % |    81,8 % |            66,7 % |                                      2,2 / 4,8 |                     45 → 35 |
| Qwen3 4B Instruct 2507 (Q8_0)  |         4,28 |          9,32 |             11,8 |              55,0 % |                 100,0 % | 39,5 % |   100,0 % |           100,0 % |                                      0,8 / 1,3 |                     45 → 28 |
| SmolLM3 3B (Q4_K_M)            |         1,92 |          4,36 |             17,6 |              35,0 % |                 100,0 % | 20,9 % |    64,3 % |           100,0 % |                                      1,2 / 1,9 |                     45 → 42 |
| Qwen3 4B (Q4_K_M)              |         2,50 |          5,82 |             10,8 |              85,0 % |                 100,0 % |  7,0 % |   100,0 % |           100,0 % |                                      0,0 / 0,6 |                     45 → 42 |
| Qwen3 1.7B (Q8_0)              |         1,83 |          4,32 |              4,3 |              95,0 % |                 100,0 % |  2,3 % |   100,0 % |           100,0 % |                                      0,0 / 0,0 |                     45 → 44 |
| Qwen3.5 0.8B (Q8_0)            |         0,83 |          1,99 |              2,1 |              70,0 % |                 100,0 % |  2,3 % |   100,0 % |           100,0 % |                                      0,6 / 0,3 |                     45 → 44 |
| Qwen3-VL 2B (Q4_K_M), nur Text |         1,11 |          2,89 |              4,6 |             100,0 % |                 100,0 % |  0,0 % |     n. v. |             n. v. |                                      0,2 / 0,3 |                     45 → 45 |
| GLM-OCR (Q8_0), nur Text       |         0,95 |          1,68 |             19,3 |               0,0 % |                 100,0 % |  0,0 % |     0,0 % |             n. v. |                                      0,2 / 0,0 |                     45 → 46 |

„Seite“ ist ein Text von etwa 100 bis 140 Wörtern (13 bis 16 Zeilen). „Text erhalten“ liegt bei diesem Verfahren immer bei 100 %. Wortfehler vorher: Wörter, die sich im Eingabetext vom korrigierten Text unterscheiden. Nachher: derselbe Vergleich nach Anwenden aller Modell-Marken.

Recall je Fehlerart und Falschtyp-Anteil:

| Modell                         | Recall R (28) | Recall Z (9) | Recall G (6) | strenger Recall | Falscher Typ |
| ------------------------------ | ------------: | -----------: | -----------: | --------------: | -----------: |
| Gemma 4 E2B it (Q4_0)          |       100,0 % |       88,9 % |        0,0 % |          79,1 % |        4,7 % |
| Gemma 4 E4B it (Q4_0)          |       100,0 % |      100,0 % |        0,0 % |          81,4 % |        7,0 % |
| Qwen3-VL 4B (Q4_K_M), nur Text |        92,9 % |       77,8 % |        0,0 % |          72,1 % |        4,7 % |
| Granite 4.1 3B (Q4_K_M)        |        60,7 % |       44,4 % |        0,0 % |          44,2 % |       11,6 % |
| Ministral 3 3B (Q4_K_M)        |        50,0 % |       44,4 % |        0,0 % |          41,9 % |        4,7 % |
| Qwen3 4B Instruct 2507 (Q8_0)  |        53,6 % |       22,2 % |        0,0 % |          34,9 % |        0,0 % |
| SmolLM3 3B (Q4_K_M)            |        28,6 % |       11,1 % |        0,0 % |          20,9 % |        0,0 % |

Die Art der Marke bestimmt eine Regel im Code, kein Modell: Z, wenn nur Satzzeichen abweichen, R bei Groß- und Kleinschreibung, Leerzeichen oder einem einzelnen Wort mit Editierabstand bis 2, sonst G. Die Spalte „Recall G“ misst deshalb die Regel: Gemma E2B findet 2 der 6 Grammatikfehler an der richtigen Stelle (E4B 3), die Regel macht daraus R. Die folgende Tabelle trennt Stelle und Art, die Precision je Fehlerart zählt die Marken nach der Art, die die Regel vergeben hat.

| Modell                                  | Recall nur Stelle R | Recall nur Stelle Z | Recall nur Stelle G | Precision R | Precision Z | Precision G |
| --------------------------------------- | ------------------- | ------------------- | ------------------- | ----------- | ----------- | ----------- |
| Gemma 4 E2B it (Q4_0)                   | 100,0 %             | 88,9 %              | 33,3 %              | 93,3 %      | 100,0 %     | n. v.       |
| Gemma 4 E4B it (Q4_0)                   | 100,0 %             | 100,0 %             | 50,0 %              | 87,5 %      | 100,0 %     | n. v.       |
| Granite 4,1 3B (Q4_K_M)                 | 71,4 %              | 44,4 %              | 33,3 %              | 85,0 %      | 100,0 %     | 0,0 %       |
| Ministral 3 3B Instruct (Q4_K_M)        | 53,6 %              | 44,4 %              | 16,7 %              | 93,3 %      | 66,7 %      | 0,0 %       |
| Qwen3 4B Instruct 2507 (Q8_0)           | 53,6 %              | 22,2 %              | 0,0 %               | 100,0 %     | 100,0 %     | n. v.       |
| Qwen3-VL 4B Instruct (Q4_K_M), nur Text | 92,9 %              | 77,8 %              | 33,3 %              | 92,9 %      | 77,8 %      | 0,0 %       |

Konfidenzintervalle (Wilson, 95 %) für die drei führenden Modelle bei 43 Soll-Fehlern und 6 Grammatikfehlern. Die Unterschiede zwischen E2B und E4B liegen weit innerhalb der Intervalle:

| Modell                                  | Recall (95 %-Intervall)    | Precision (95 %-Intervall) | Recall G (95 %-Intervall) |
| --------------------------------------- | -------------------------- | -------------------------- | ------------------------- |
| Gemma 4 E2B it (Q4_0)                   | 83,7 % (70,0 % bis 91,9 %) | 94,7 % (82,7 % bis 98,5 %) | 0,0 % (0,0 % bis 39,0 %)  |
| Gemma 4 E4B it (Q4_0)                   | 86,0 % (72,7 % bis 93,4 %) | 90,2 % (77,5 % bis 96,1 %) | 0,0 % (0,0 % bis 39,0 %)  |
| Qwen3-VL 4B Instruct (Q4_K_M), nur Text | 76,7 % (62,3 % bis 86,8 %) | 86,8 % (72,7 % bis 94,2 %) | 0,0 % (0,0 % bis 39,0 %)  |

Verworfene Blöcke je Modell (Umformulierungen, die die Ableitung nicht in Marken umsetzt), über alle 20 Texte:

| Modell                                  | Verworfene Blöcke | je 100 Wörter |
| --------------------------------------- | ----------------- | ------------- |
| Gemma 4 E2B it (Q4_0)                   | 12                | 0,5           |
| Gemma 4 E4B it (Q4_0)                   | 2                 | 0,1           |
| GLM-OCR (Q8_0), nur Text                | 8                 | 0,4           |
| Granite 4,1 3B (Q4_K_M)                 | 1                 | 0,0           |
| Ministral 3 3B Instruct (Q4_K_M)        | 120               | 5,4           |
| Qwen3 1,7B (Q8_0)                       | 1                 | 0,0           |
| Qwen3 4B Instruct 2507 (Q8_0)           | 14                | 0,6           |
| Qwen3 4B (Q4_K_M)                       | 0                 | 0,0           |
| Qwen3-VL 2B Instruct (Q4_K_M), nur Text | 0                 | 0,0           |
| Qwen3-VL 4B Instruct (Q4_K_M), nur Text | 14                | 0,6           |
| Qwen3,5 0,8B (Q8_0)                     | 9                 | 0,4           |
| SmolLM3 3B (Q4_K_M)                     | 160               | 7,2           |

Der „strenge Recall“ verlangt dieselbe Textstelle statt nur eine Überschneidung. „Falscher Typ“ zählt Marken an der richtigen Stelle mit falscher Fehlerart (bei Gemma 2 bis 3 von 43 Fehlern).

Treffer je Text (richtig / Soll, falsche Marken):

| Text          | Gemma 4 E2B | Gemma 4 E4B | Qwen3-VL 4B |
| ------------- | ----------: | ----------: | ----------: |
| Brief         |     9/10, 0 |    10/10, 0 |     9/10, 1 |
| Ferien        |    10/11, 0 |    10/11, 2 |    10/11, 0 |
| Handy         |    10/11, 1 |    10/11, 1 |    10/11, 2 |
| Inhaltsangabe |     7/11, 1 |     7/11, 1 |     4/11, 2 |

### Peak-RAM von Gemma 4 E2B mit und ohne `--no-repack`

Je vier Seiten (Schülertexte), Kontext 2048, nacheinander auf demselben Rechner, zweimal wiederholt. Der Rechner war ausgelastet (Load Average 8 bis 11), die Zeiten schwanken.

| Einstellung   | Peak-RAM (GB) | Sekunden je Seite (zwei Läufe)                   |
| ------------- | ------------: | ------------------------------------------------ |
| Standard      |          4,70 | 4,4 / 4,1 / 5,5 / 5,0 und 4,4 / 4,2 / 5,2 / 6,3  |
| `--no-repack` |          3,37 | 5,6 / 5,3 / 6,7 / 6,5 und 6,7 / 8,7 / 10,1 / 8,0 |

Die Ergebnisse (Marken) sind in beiden Fällen identisch (Recall 83,7 %, Precision 94,7 %). Batch-Größen (`--batch-size`, `--ubatch-size`) änderten den RAM nicht, Kontext 2048 statt 8192 senkte ihn nur leicht.

### Zeiten auf einem zweiten Rechner (simon-pc)

AMD Ryzen 7 5700X (8 Kerne), Fedora, x86_64, llama.cpp `b11537` für Linux, rein CPU. Der Rechner wird von anderen genutzt (12 angemeldete Nutzer, Load Average 3 bis 6), die Zeiten schwanken. Gemessen mit den 4 Schülertexten und den 4 korrigierten Versionen (8 Seiten, ohne ScaDS), Kontext 4096. Die Sekunden sind zwischen Mac und Ryzen nicht vergleichbar, Genauigkeit und RAM schon.

| Modell                         | Threads | Peak-RAM (GB) | s/Seite (Median) | Recall | Precision |
| ------------------------------ | ------: | ------------: | ---------------: | -----: | --------: |
| Gemma 4 E2B it (Q4_0)          |       4 |          4,11 |             24,7 | 83,7 % |    94,7 % |
| Gemma 4 E2B it (Q4_0)          |       8 |          4,14 |             16,1 | 83,7 % |    94,7 % |
| Gemma 4 E2B it (Q4_0)          |       4 |          3,10 |             17,8 | 83,7 % |    94,7 % |
| Gemma 4 E4B it (Q4_0)          |       4 |          7,08 |             42,3 | 86,0 % |    90,2 % |
| Qwen3-VL 4B (Q4_K_M), nur Text |       4 |          4,99 |             37,4 | 72,1 % |    75,6 % |

Die dritte Zeile läuft mit `--no-repack`. Die Marken von Gemma E2B und E4B sind auf beiden Rechnern identisch, Qwen3-VL 4B weicht ab (Recall 72,1 gegenüber 76,7 %, Precision 75,6 gegenüber 86,8 %), weil die Rechenreihenfolge anders ist. Eine Seite dauert auf dem Ryzen etwa das Fünffache wie auf dem Mac. Eine Lehrkraft mit einem Laptop dieser Klasse wartet für einen Text von 100 Wörtern also rund 15 bis 25 s.

### Ende-zu-Ende: GLM-OCR-Transkripte der Font-Seiten

Die 16 Transkripte (4 Texte in 4 Schriften) aus `run.ts` mit GLM-OCR gehen in dasselbe Verfahren. Das Soll wird per Wortzuordnung auf die OCR-Zeilen abgebildet. Nur Fehler, die die OCR unverändert gelassen hat, zählen (156 von 172, also 90,7 %).

| Modell                         | Treffer | Recall | Precision | Korrektur richtig | falsche Marken je Seite | Wortfehler vorher → nachher | s/Seite |
| ------------------------------ | ------: | -----: | --------: | ----------------: | ----------------------: | --------------------------: | ------: |
| Gemma 4 E2B it (Q4_0)          |     129 | 82,7 % |    57,6 % |           100,0 % |                     5,9 |                   163 → 107 |     5,9 |
| Gemma 4 E4B it (Q4_0)          |     134 | 85,9 % |    56,8 % |            97,0 % |                     6,4 |                   163 → 112 |    10,8 |
| Qwen3-VL 4B (Q4_K_M), nur Text |     117 | 75,0 % |    52,2 % |            96,6 % |                     6,7 |                   163 → 150 |    13,1 |

Die falschen Marken stammen zum Großteil aus OCR-Fehlern (wörtlich falsch gelesene Wörter, die das Modell richtig „korrigiert“), nicht aus Fehlentscheidungen des Modells. Sie sind in der Schulausgangsschrift am höchsten (bis 29 je Seite), in der Grundschrift und den anderen beiden Schriften zwischen 1 und 6.

### Direkte Ausgabe der Marken (ADR-Format)

Prompt `spec` (`buildSpecification` mit dem Profil Deutsch), die 4 Schülertexte und ihre 4 korrigierten Versionen. Alle 12 Modelle:

| Modell                         | gültig (1. Versuch) | gültig (nach Reparatur) | Recall | Text erhalten | s/Seite |
| ------------------------------ | ------------------: | ----------------------: | -----: | ------------: | ------: |
| Gemma 4 E2B it (Q4_0)          |              62,5 % |                  62,5 % |  0,0 % |        78,3 % |    13,0 |
| Gemma 4 E4B it (Q4_0)          |              62,5 % |                  87,5 % |  0,0 % |       100,0 % |    22,7 |
| Qwen3-VL 4B (Q4_K_M), nur Text |             100,0 % |                 100,0 % |  0,0 % |       100,0 % |    26,3 |
| Qwen3 4B Instruct 2507 (Q8_0)  |              25,0 % |                  37,5 % |  2,3 % |        65,8 % |    48,2 |
| Qwen3 4B (Q4_K_M)              |              87,5 % |                  87,5 % |  0,0 % |        99,2 % |    25,6 |
| Granite 4.1 3B (Q4_K_M)        |               0,0 % |                   0,0 % |  0,0 % |        70,0 % |    38,6 |
| Ministral 3 3B (Q4_K_M)        |               0,0 % |                   0,0 % |  0,0 % |        24,2 % |    55,9 |
| SmolLM3 3B (Q4_K_M)            |              50,0 % |                  50,0 % |  0,0 % |        93,3 % |    28,0 |
| Qwen3 1.7B (Q8_0)              |              37,5 % |                  75,0 % |  0,0 % |        95,8 % |    25,5 |
| Qwen3-VL 2B (Q4_K_M), nur Text |              75,0 % |                  87,5 % |  0,0 % |        99,2 % |    11,9 |
| Qwen3.5 0.8B (Q8_0)            |              75,0 % |                  75,0 % |  0,0 % |        80,0 % |     4,5 |
| GLM-OCR (Q8_0), nur Text       |               0,0 % |                   0,0 % |  0,0 % |         0,0 % |    30,7 |

Mit dem erweiterten Prompt (zusätzliche Regeln und ein Beispiel) bleibt der Recall bei Gemma E2B und E4B bei 0,0 % (gültig 75,0 % bzw. 62,5 bis 75,0 %). Die übrigen Modelle liefen mit dieser Variante nicht, weil schon die beiden stärksten bei 0,0 % Recall lagen. Typische Fehlerbilder: Das Modell gibt die Zeilen ohne Marken zurück, schreibt den Text still korrigiert ab, baut `<rs-error>` mit einem `fix` gleich dem Original, oder lässt Zeilen aus.

### Fehlerliste als JSON

Das Modell gibt `{"errors":[{"n","type","kind","text","fix"}]}` aus (per JSON-Schema erzwungen), der Code macht Marken daraus (`eval/correct-list.ts`). Nur die drei aussichtsreichsten Modelle, 8 Texte:

| Modell                        | gültig (1. Versuch) | gültig (nach Reparatur) | Recall | Precision | Korrektur richtig | Fehlalarme je 100 Wörter (Schülertext) | s/Seite |
| ----------------------------- | ------------------: | ----------------------: | -----: | --------: | ----------------: | -------------------------------------: | ------: |
| Gemma 4 E2B it (Q4_0)         |              50,0 % |                 100,0 % | 18,6 % |    42,1 % |           100,0 % |                                    1,2 |    12,9 |
| Gemma 4 E4B it (Q4_0)         |              25,0 % |                 100,0 % | 37,2 % |    57,1 % |            81,3 % |                                    3,5 |    32,3 |
| Qwen3 4B Instruct 2507 (Q8_0) |              25,0 % |                 100,0 % | 27,9 % |    63,2 % |            91,7 % |                                    1,4 |    28,6 |

Die Modelle erfinden Einträge, die im Text nicht stehen, oder tragen unveränderte Wörter als `fix` ein. Der Code verwirft beides und führt es als Problem in der Reparatur-Runde auf.

## Aufbau

- **Runtime:** llama.cpp `b11537` (derselbe `llama-server` wie im App-Bundle), rein CPU: `--n-gpu-layers 0 --device none`, 4 Threads, `--parallel 1`, `--cache-ram 0`, Temperatur 0, `chat_template_kwargs: {enable_thinking: false}`, Prompt-Cache aus.
- **Hardware:** Zwei Rechner. Hauptlauf: Apple M4 Pro (8 Performance- und 4 Effizienzkerne), 48 GB RAM, macOS 26.6.2. Die 4 Threads laufen auf Performance-Kernen, die deutlich schneller sind als die CPU eines typischen 8-GB-Laptops. Während der Läufe liefen auf dem Rechner weitere Prozesse mit (Load Average 6 bis 11), die Zeiten sind Näherungen und eine Untergrenze.
- **Soll-Daten:** Die Schülertexte aus `eval/samples/texts/*.txt` mit `{geschrieben|richtig|Art}`-Markierung. `eval/gold.ts` macht daraus den Eingabetext (Zeilen bei höchstens 60 Zeichen, Fehlerstellen werden nie zerschnitten) und die Soll-Marken (R 28, Z 9, G 6). Dieselben Texte mit den korrekten Varianten sind der fehlerfreie Text. Die ScaDS-Seiten werden aus `~/.cache/rotstift/datasets/scads-fullpage/extracted/ground_truth/` in place gelesen und nie kopiert.
- **Kennzahlen:**
  - Gültig: Anteil der Antworten, die `parseTranscript` mit dem Profil Deutsch und dem Quelltext annimmt. Nach höchstens einer Wiederholung, die alle Probleme auflistet.
  - Recall und Precision: Eine Marke trifft, wenn Art und Textstelle sich überschneiden (Auslassungen: gleiche Stelle, Leerräume zählen nicht). Der strenge Recall verlangt dieselbe Stelle.
  - Korrektur richtig: Der Text nach Anwenden der Modell-Marke gleicht dem nach Anwenden der Soll-Marke.
  - Fehlalarme: Marken auf fehlerfreiem Text je 100 Wörter.
  - Text erhalten: Zeilen, deren Text außerhalb der Marken dem Original gleicht (nur beim ADR-Format relevant).
  - Peak-RAM: höchster RSS des Servers, alle 200 ms abgefragt.
- **Messen und Tests:** `eval/correct.ts` führt aus, `eval/correct-summary.ts` baut die Tabellen aus den Ergebnisdateien. Die Ableitung und die Bewertung haben Unit-Tests (`eval/*.test.ts`). Das Nachstellen steht in [eval/README.md](../../eval/README.md).

## Kandidaten

Alle Dateien kommen aus den offiziellen Repos der Hersteller oder von `ggml-org` auf Hugging Face und sind in `eval/correct-models.ts` mit Commit und SHA256 gepinnt.

| Modell                  | Quelle                                        | Quantisierung | Größe (GB) | Lizenz     |
| ----------------------- | --------------------------------------------- | ------------- | ---------: | ---------- |
| Gemma 4 E2B it          | `ggml-org/gemma-4-E2B-it-GGUF`                | Q4_0          |       2,84 | Apache-2.0 |
| Gemma 4 E4B it          | `ggml-org/gemma-4-E4B-it-GGUF`                | Q4_0          |       4,59 | Apache-2.0 |
| Qwen3-VL 4B Instruct    | `Qwen/Qwen3-VL-4B-Instruct-GGUF`              | Q4_K_M        |       2,50 | Apache-2.0 |
| Qwen3-VL 2B Instruct    | `Qwen/Qwen3-VL-2B-Instruct-GGUF`              | Q4_K_M        |       1,11 | Apache-2.0 |
| GLM-OCR                 | `ggml-org/GLM-OCR-GGUF`                       | Q8_0          |       0,95 | MIT        |
| Qwen3 4B Instruct 2507  | `ggml-org/Qwen3-4B-Instruct-2507-Q8_0-GGUF`   | Q8_0          |       4,28 | Apache-2.0 |
| Qwen3 4B                | `Qwen/Qwen3-4B-GGUF`                          | Q4_K_M        |       2,50 | Apache-2.0 |
| Qwen3 1.7B              | `Qwen/Qwen3-1.7B-GGUF`                        | Q8_0          |       1,83 | Apache-2.0 |
| Qwen3.5 0.8B            | `ggml-org/Qwen3.5-0.8B-GGUF`                  | Q8_0          |       0,83 | Apache-2.0 |
| Ministral 3 3B Instruct | `mistralai/Ministral-3-3B-Instruct-2512-GGUF` | Q4_K_M        |       2,15 | Apache-2.0 |
| SmolLM3 3B              | `ggml-org/SmolLM3-3B-GGUF`                    | Q4_K_M        |       1,92 | Apache-2.0 |
| Granite 4.1 3B          | `ibm-granite/granite-4.1-3b-GGUF`             | Q4_K_M        |       2,10 | Apache-2.0 |

Die Vision-Modelle (GLM-OCR, Qwen3-VL) laufen ohne `mmproj` als reine Text-Modelle. Nicht getestet:

- **Phi-4-mini:** Es gibt kein offizielles GGUF (Microsoft bietet nur Phi-4 mit 14 Mrd. Parametern, MIT).
- **Llama 3.2 3B:** Kein GGUF vom Hersteller oder von `ggml-org`, und die Llama-Community-Lizenz enthält Nutzungsbeschränkungen.
- **Gemma 3:** Die Gemma-Nutzungsbedingungen sind keine Standardlizenz (Gemma 4 steht unter Apache-2.0).
- **LFM2.5, Nemotron-3-Nano-4B, Tiny Aya:** Lizenz „other“, NVIDIA Open Model License bzw. CC-BY-NC-4.0, nicht mit GPL-3.0 verträglich oder nicht frei nutzbar.
- **Qwen3.5 2B und 4B:** Kein offizielles GGUF gefunden, nur 0,8B bei `ggml-org`.
- **Gemma 4 12B, Ministral 3 8B:** Zu groß für das Budget.

## Grenzen

- **Stichprobe:** Ein Lauf je Modell mit Temperatur 0. 43 Fehler in 4 selbst geschriebenen Texten, davon 28 R, 9 Z und 6 G.
- **Kleine Fehlerzahl:** 43 Fehler in 4 Texten (511 Wörter). Ein Fehler mehr oder weniger bewegt Recall und Precision um 2 bis 3 Prozentpunkte. Die Unterschiede zwischen Gemma E2B und E4B liegen innerhalb dieser Schwankung.
- **Grammatik:** Die 6 Grammatikfehler sind zu wenige für eine Aussage über die Modelle (Intervall für G-Recall 0 bis 39 %), und die Regel für die Fehlerart trifft sie schlecht (siehe oben). Ob eine bessere Einordnung (geschlossene Wortklassen wie Artikel und Pronomen, Flexionsendungen) den G-Recall hebt, ist nicht gemessen. Das Verfahren erzeugt außerdem nur R, Z und G, nicht A, Sb, T, Bz oder W.
- **Synthetische Texte:** Die Schülertexte sind selbst geschrieben und die Fehler eingebaut, keine echte Kinderhandschrift. Der Zeilenumbruch bei 60 Zeichen ist künstlich, echte OCR-Zeilen sind kürzer, länger und unregelmäßiger.
- **ScaDS:** Die Seiten stammen aus dem ScaDS.AI German Handwriting Full-Page Dataset (CC BY 4.0, Quelle und DOI in [2026-10-handschrift.md](2026-10-handschrift.md)) und werden nur gelesen, nicht ins Repo kopiert. Die Vorlagen sind Erwachsenentexte, die Fehlalarme dort sind überschätzt. Etwa 10 der 34 Marken von Gemma E2B treffen echte Tippfehler der Vorlage („Demographei“, „Begrif“, „epileps“, „abgeleit“, abgeschnittene Wörter).
- **OCR-Fehler:** Im Ende-zu-Ende-Lauf mischen sich Lese-Fehler der OCR in die Zahlen. Die Precision ist nicht die des Korrektors allein.
- **Seitenlänge:** Die Seiten hatten etwa 100 bis 140 Wörter. Eine volle A4-Seite (300 bis 400 Wörter) braucht proportional länger (nahezu linear in der Ausgabe-Länge) und größeren Kontext. Gemessen ist das nicht.
- **Zeiten:** Gemessen auf einem schnellen Rechner mit anderen laufenden Prozessen. Der Ryzen 7 5700X ist ein Näherungswert für einen Laptop ohne GPU, ein 8-GB-Laptop mit schwächerer CPU ist langsamer. Der Prompt-Cache ist aus.
- **Ableitung per Wortvergleich:** Wörter, die das Modell umformuliert (mehr als drei Wörter in einem Block), verwirft die Ableitung. Die Art der Marke ist eine Schätzung.
- **Art der Marke:** Gemessen ist nur die Regel im Code (Z, R, G). Ob das Modell die Art je Änderung selbst angeben kann und ob das besser ist, ist nicht gemessen, ebenso wenig, wie oft Umformulierungen verworfen werden.
- **Ein Lauf je Konfiguration:** Alle Läufe mit Temperatur 0 und je einmal.
