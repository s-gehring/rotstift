# Evaluation: Gründlicher Modus (Oktober 2026)

Frage: Was bringt mehr Rechenzeit oder ein größeres Modell je Schritt (Erkennung, Rechtschreibung und Grammatik, Inhalt und Form), wenn der Rechner 8 GB RAM und keine GPU hat und eine Seite auf einer schwachen CPU höchstens etwa 3 min dauern darf? Simons Rahmen: 100 Seiten in 4 bis 5 Stunden.

Stand: Die Qualität ist vollständig gemessen. Zeit je Seite und Verhalten unter einem Speicherdeckel stehen aus, weil simon-pc während der Messung durch einen anderen Rechenjob belegt war. Sie folgen in einem eigenen Nachtrag. Alle Zellen mit „ausstehend“ betrifft das.

## Ergebnis

**Für Rechtschreibung und Grammatik bringt nur ein größeres Gemma mehr Qualität.** Gemma 4 E4B statt E2B hebt den Recall von 86,9 auf 91,8 %, die Precision von 94,6 auf 98,2 % und halbiert die Wortfehler, die nach der Korrektur im Text bleiben (10 statt 5 von 62). Gemma 4 26B A4B (MoE, 3,8 Mrd. aktive Parameter) schafft 93,4 % und lässt 3 Wortfehler stehen, braucht aber 14,5 bis 15,3 GB. Q8_0 statt Q4_0 bringt bei beiden kleinen Modellen nichts.

**Mehr Rechenzeit mit demselben Modell bringt nichts.** Denken (`--reasoning on`) verschlechtert E4B auf 72,1 % Recall bei etwa 50-facher Zeit. Ein zweiter Durchgang über die eigene Korrektur findet bei E2B einen Fehler mehr und bei E4B keinen. Selbstkonsistenz (drei Stichproben bei Temperatur 0,7, Mehrheit) ist so gut wie ein Durchgang mit Temperatur 0, die Vereinigung der Stichproben kauft Recall mit Precision. Die Vereinigung von E2B und E4B ist so gut wie E4B allein.

**Inhalt und Form: Kein Modell ist messbar besser.** Auf 24 eingebauten Mängeln treffen E2B 18, E4B 17, 26B A4B 16 und Qwen3.6 35B A3B 19. Denken bringt auf 5 Arbeiten einen Treffer mehr für die neunfache Zeit.

**Erkennung: Eine zweite Lesung mit LightOnOCR-3 0.8B halbiert die Fehlalarme aus Lesefehlern.** Rot bleibt eine Marke nur, wenn LightOn das Wort gleich liest und GLM-OCR sich zu mindestens 0,8 sicher ist, sonst wird sie zum Hinweis „unsicher gelesen“. Auf 20 Seiten echter Handschrift sinken die roten Marken von 1,4 auf 0,7 je 100 Wörter, auf den gerenderten Seiten steigt der Anteil echter Fehler, die rot markiert werden, von 60 auf 63 %. Die Hinweise nehmen leicht zu (5,6 auf 6,0 je 100 Wörter).

**Spekulatives Dekodieren ändert die Marken nicht.** Mit Temperatur 0 sind die Marken mit dem MTP-Kopf von Gemma identisch, 91 % der vorgeschlagenen Token werden angenommen. Wie viel Zeit das spart, steht aus.

## Empfehlung

Vorläufig, bis die Zeiten auf simon-pc gemessen sind:

- **8 GB, gründlich:** GLM-OCR mit zweiter Lesung durch LightOnOCR-3 0.8B (Regel 0,8 / unbestätigt immer Hinweis), Rechtschreibung und Grammatik mit Gemma 4 E4B Q4_0, Inhalt und Form mit demselben Modell. E4B passt mit 5,2 GB Peak nicht in die 4,5 GiB, die die Registry auf 8 GB für das Modell lässt. Es läuft nur, wenn die Gewichte unter einem Deckel aus der Datei nachgeladen werden (mmap ohne Repack). Ob das schnell genug ist, zeigt der Nachtrag. Wenn nicht, bleibt E2B, und der gründliche Modus besteht aus der zweiten Lesung.
- **16 GB:** Dasselbe mit E4B ohne Deckel. Gemma 4 26B A4B ist mit 14,5 bis 15,3 GB Peak zu groß für 16 GB. Ob es unter einem Deckel von 12 GiB brauchbar läuft, steht aus.
- **Dauer (Schätzung):** Heute braucht eine Seite auf simon-pc mit 4 Threads etwa 57 s. Die zweite Lesung kostet weniger als eine weitere Erkennung (LightOnOCR braucht auf ScaDS-Seiten 9,9 statt 15,5 s wie GLM-OCR, auf Klassenseiten geschätzt 20 bis 25 s), E4B rechnet geschätzt 1,6- bis 2-mal so lange wie E2B (16 s je Seite heute). Gründlich sind das etwa 90 bis 100 s je Seite, für 100 Seiten rund 2,5 bis 2,8 Stunden auf simon-pc und 4 bis 5,5 Stunden auf einem schwachen Laptop (Faktor 1,5 bis 2). Das liegt am Rand des Rahmens von 3 min je Seite.

## Rahmen und Zeitbudget

Heute braucht eine Seite auf simon-pc mit 4 Threads rund 31 s Erkennung, 16 s Rechtschreibung und Grammatik und 10 s Inhalt und Form (20 s je Arbeit mit 2 Seiten), zusammen etwa 57 s ([Messung schwacher Rechner](../messung-schwacher-rechner.md)). Ein schwacher Laptop braucht nach derselben Messung das 1,5- bis 2-Fache. 3 min je Seite auf dem Laptop entsprechen also 90 bis 120 s je Seite auf simon-pc mit 4 Threads, der gründliche Modus darf dort 35 bis 60 s je Seite zusätzlich kosten. 100 Seiten in 4 bis 5 Stunden sind 144 bis 180 s je Seite.

Auf 8 GB bleiben für das Modell etwa 4,5 GiB (4,8 GB): Die Registry hält 3,5 GiB für System, App und WebView frei (`RESERVED_RAM` in `src/models/registry.ts`). Es läuft immer nur ein Modell zur Zeit.

## Rechtschreibung und Grammatik

Proben: Die 8 deutschen Texte aus `eval/samples/texts` und die 4 aus `eval/samples/profiles/gross-klein`, jeweils mit Fehlern und fehlerfrei (24 Seiten, 61 Soll-Fehler, 775 fehlerfreie Wörter). Recall und Precision zählen Art und Stelle, in Klammern das 95-%-Intervall nach Wilson. „Wortfehler danach“ sind die Fehler, die nach der Korrektur im Text bleiben (vorher 62). Peak-RAM ist der größte RSS des llama-server.

| Variante                     | Recall         | Precision | Fehlalarme je 100 Wörter | Wortfehler danach | s/Seite (4 / 8 Threads) | Peak-RAM     | passt in 8 GB              |
| ---------------------------- | -------------- | --------- | ------------------------ | ----------------- | ----------------------- | ------------ | -------------------------- |
| Gemma 4 E2B Q4_0 (heute)     | 86,9 % (76–93) | 94,6 %    | 0,3                      | 10                | ausstehend              | 3,4 GB       | ja                         |
| Gemma 4 E4B Q4_0             | 91,8 % (82–96) | 98,2 %    | 0,6                      | 5                 | ausstehend              | 5,2 GB       | nur mit Deckel, ausstehend |
| Gemma 4 26B A4B Q4_0         | 93,4 % (84–97) | 98,3 %    | 0,3                      | 3                 | ausstehend              | 14,5–15,3 GB | nein, Deckel ausstehend    |
| Gemma 4 E2B Q8_0             | 86,9 % (76–93) | 96,4 %    | 0,1                      | 8                 | nicht gemessen          | 5,5 GB       | nein                       |
| Gemma 4 E4B Q8_0             | 91,8 % (82–96) | 98,2 %    | 0,4                      | 4                 | nicht gemessen          | 8,6 GB       | nein                       |
| E2B, 3 Stichproben, Mehrheit | 86,9 % (76–93) | 93,0 %    | 0,3                      | 11                | 3-mal E2B               | 3,4 GB       | ja                         |
| E2B, 3 Stichproben vereinigt | 91,8 % (82–96) | 91,8 %    | 0,6                      | 8                 | 3-mal E2B               | 3,4 GB       | ja                         |
| E4B, 3 Stichproben, Mehrheit | 91,8 % (82–96) | 98,2 %    | 0,8                      | 5                 | 3-mal E4B               | 5,2 GB       | wie E4B                    |

Die Stichproben laufen mit Temperatur 0,7 (`profiles.ts --temperature 0.7`) und werden mit `gruendlich-union.ts --votes 2` (Mehrheit) oder `--votes 1` (Vereinigung) zusammengeführt. Einzeln liegen die drei E2B-Stichproben bei 83,6 bis 88,5 % Recall, die drei E4B-Stichproben alle bei 91,8 %.

Nur die 8 deutschen Texte (43 Soll-Fehler, 510 fehlerfreie Wörter, Wortfehler vorher 45):

| Variante                                   | Recall | Precision | Fehlalarme je 100 Wörter | Wortfehler danach | Rechenzeit                   |
| ------------------------------------------ | ------ | --------- | ------------------------ | ----------------- | ---------------------------- |
| E2B, ein Durchgang                         | 86,0 % | 97,4 %    | 0,0                      | 6                 | 1                            |
| E2B, zwei Durchgänge (`--passes 2`)        | 88,4 % | 97,4 %    | 0,0                      | 5                 | 2                            |
| E4B, ein Durchgang                         | 90,7 % | 97,5 %    | 1,0                      | 4                 | 1                            |
| E4B, zwei Durchgänge                       | 90,7 % | 97,5 %    | 1,0                      | 4                 | 2                            |
| E4B mit Denken                             | 72,1 % | 96,9 %    | 1,2                      | 14                | etwa 50                      |
| Marken von E2B und E4B vereinigt           | 90,7 % | 97,5 %    | 1,0                      | 3                 | E2B plus E4B                 |
| Qwen3.6 35B A3B Q4_K_M (MoE, 3 Mrd. aktiv) | 86,0 % | 97,4 %    | 0,0                      | 6                 | nicht gemessen, 17,9 GB Peak |

Rechenzeit relativ zu einem Durchgang desselben Modells. Mit Denken schreibt E4B vor jeder Antwort mehrere Tausend Token, braucht dafür 12288 Token Kontext und 8192 Ausgabe-Token (Kandidat `gemma-4-e4b-q4-denken`) und übersieht danach mehr Fehler, vor allem bei Getrennt- und Zusammenschreibung (5 statt 9 von 9) und Grammatik (2 statt 3 von 6).

Einordnung: Die Intervalle von E2B und E4B überlappen. Für E4B spricht, dass es in jeder Teilmenge und jeder Stichprobe vorne liegt, halb so viele Fehler im Text stehen lässt und in fehlerhaften Texten präziser markiert (98,2 statt 94,6 %). Auf fehlerfreien Texten setzt es etwas mehr Fehlalarme (0,6 statt 0,3 je 100 Wörter). 26B A4B ist nochmals etwas besser, der Abstand zu E4B (2 Fehler von 61) liegt aber im Rauschen.

## Spekulatives Dekodieren

Gemma 4 bringt eigene MTP-Köpfe (Multi-Token-Prediction) als kleine GGUF-Dateien mit (60 MB für E2B und E4B, 250 MB für 26B A4B). llama-server schlägt damit mehrere Token vor und prüft sie in einem Schritt (`--spec-type draft-mtp --model-draft <Kopf>`). Ohne Zusatzdatei geht `--spec-type ngram-simple`, das Token aus dem bisherigen Text vorschlägt. Korrigierter Text wiederholt den Eingabetext fast wörtlich, das ist der günstigste Fall für beide.

Bei Temperatur 0 ändert keine der beiden Varianten die Ausgabe: Die Marken eines E4B-Laufs mit MTP sind mit denen ohne identisch, die Annahmequote lag bei 91 %. Die Zeit je Seite steht aus.

| Variante                   | s/Seite (4 / 8 Threads) | Beschleunigung | Peak-RAM   |
| -------------------------- | ----------------------- | -------------- | ---------- |
| E2B                        | ausstehend              | 1              | 3,4 GB     |
| E2B mit `ngram-simple`     | ausstehend              | ausstehend     | ausstehend |
| E4B                        | ausstehend              | 1              | 5,2 GB     |
| E4B mit `ngram-simple`     | ausstehend              | ausstehend     | ausstehend |
| E4B mit MTP                | ausstehend              | ausstehend     | ausstehend |
| 26B A4B mit `ngram-simple` | ausstehend              | ausstehend     | ausstehend |

## Modelle größer als der Speicher

Mit `--no-repack` liest llama.cpp die Gewichte per mmap direkt aus der Datei. Sie liegen dann als Seiten der Datei im Speicher, die der Kernel unter Druck verwerfen und bei Bedarf neu lesen kann, statt das Programm zu beenden. Ein Modell kann so auch mit weniger Speicher laufen, als die Datei groß ist, auf Kosten von Lesezugriffen. Bei MoE-Modellen wie 26B A4B braucht jedes Token nur einen Teil der Experten, das ist der günstigste Fall.

Gemessen wird das auf simon-pc mit einem Deckel aus systemd (`MemoryMax`, ohne Swap), siehe [eval/README.md](../../eval/README.md#gründlicher-modus). Ein Probelauf mit E2B unter 3 GiB lief ohne Abbruch durch, der Deckel griff (379 Mal), und 3,7 GB wurden von der SSD gelesen, bei 2,8 GB Dateigröße. Der Probelauf lief parallel zu einem fremden Job, seine Zeit zählt nicht.

| Modell und Deckel               | s/Seite    | gegenüber ohne Deckel | von SSD gelesen | Abbruch    |
| ------------------------------- | ---------- | --------------------- | --------------- | ---------- |
| E4B, 4,5 GiB (8-GB-Rechner)     | ausstehend | ausstehend            | ausstehend      | ausstehend |
| E4B, 3,5 GiB                    | ausstehend | ausstehend            | ausstehend      | ausstehend |
| E2B, 3,5 GiB                    | ausstehend | ausstehend            | ausstehend      | ausstehend |
| 26B A4B, 12 GiB (16-GB-Rechner) | ausstehend | ausstehend            | ausstehend      | ausstehend |
| 26B A4B, 4,5 GiB                | ausstehend | ausstehend            | ausstehend      | ausstehend |

## Inhalt und Form

Proben: Die 10 Arbeiten aus `eval/samples/content-form` mit 24 eingebauten Mängeln, Variante `features`, ein Lauf mit Temperatur 0. „Treffer“ zählt erkannte Mängel am Rand.

| Variante                            | Treffer                      | Art richtig   | Kommentare je saubere Arbeit | s je Arbeit (4 / 8 Threads) | Peak-RAM | passt in 8 GB              |
| ----------------------------------- | ---------------------------- | ------------- | ---------------------------- | --------------------------- | -------- | -------------------------- |
| Gemma 4 E2B Q4_0 (heute)            | 75 % (18/24)                 | 89 %          | 0,0                          | ausstehend                  | 3,4 GB   | ja                         |
| Gemma 4 E4B Q4_0                    | 71 % (17/24)                 | 88 %          | 0,0                          | ausstehend                  | 5,2 GB   | nur mit Deckel, ausstehend |
| Gemma 4 26B A4B Q4_0                | 67 % (16/24)                 | 94 %          | 0,0                          | ausstehend                  | 14,5 GB  | nein                       |
| Qwen3.6 35B A3B Q4_K_M              | 79 % (19/24)                 | 89 %          | 0,5                          | nicht gemessen              | 17,9 GB  | nein                       |
| E4B ohne und mit Denken, 5 Arbeiten | 69 % (9/13) und 77 % (10/13) | 78 % und 80 % | 0,0                          | 9-mal so lang mit Denken    | 5,3 GB   | wie E4B                    |

Kein Modell ist hier messbar besser. 24 Mängel trennen Unterschiede von 3 Treffern nicht vom Zufall, und das größte Gemma trifft am wenigsten. Inhalt und Form sollte darum das Modell der Korrektur nutzen, dann entfällt ein Modellwechsel.

## Erkennung

Ein größeres Erkennungsmodell gibt es für 8 GB nicht: Qwen3-VL 4B braucht 16 GB, und unter den kleineren Kandidaten liest nur LightOnOCR-3 0.8B genauer als GLM-OCR, verbessert dabei aber eigenmächtig echte Schülerfehler ([Erkennung genauer](2026-10-erkennung-genauer.md)). Als alleiniges Erkennungsmodell taugt es darum nicht, als zweiter Leser schon: Es entscheidet nur, ob eine Marke rot bleibt. Mehr Rechenzeit kann hier nur eine zweite Lesung derselben Seite sein. LightOnOCR-3 0.8B (Apache 2.0, 1,0 GB mit Bildteil) liest die Seite unabhängig ein zweites Mal, `gruendlich-zweite-lesung.ts` richtet beide Lesungen Wort für Wort aus. Eine Regel `a / b` macht eine Marke zum Hinweis „unsicher gelesen“, wenn ein berührtes Wort von LightOn bestätigt ist und seine Lesesicherheit bei GLM-OCR unter `a` liegt, oder unbestätigt ist und unter `b` liegt.

Proben: 20 Seiten echter Handschrift aus ScaDS.AI (Erwachsene, kaum echte Fehler, jede rote Marke ist fast immer ein Lesefehler) und 16 gerenderte Seiten mit 4 Handschriften und eingebauten Fehlern. Erkannt mit GLM-OCR bei 1152 px und LightOnOCR bei 1536 px, korrigiert mit E2B. „Recall rot“ ist der Anteil der eingebauten Fehler mit roter Marke, „mit Hinweisen“ zählt auch Hinweise.

| Regel                                | rote Marken je 100 Wörter, ScaDS | Hinweise je 100 Wörter, ScaDS | Hinweise, gerendert | Recall rot       | Recall mit Hinweisen |
| ------------------------------------ | -------------------------------- | ----------------------------- | ------------------- | ---------------- | -------------------- |
| 0,95 / 0,95 (App heute, eine Lesung) | 1,4 (0,9–2,0)                    | 5,6                           | 4,2                 | 60 % (52–67)     | 86 %                 |
| 0,98 / 0,98 (eine Lesung, strenger)  | 1,0 (0,7–1,6)                    | 5,9                           | 4,8                 | 53 % (45–61)     | 86 %                 |
| 0 / 1,01 (nur bestätigte Wörter rot) | 1,4 (0,9–2,0)                    | 5,7                           | 3,9                 | 68 % (61–75)     | 86 %                 |
| **0,8 / 1,01**                       | **0,7 (0,4–1,2)**                | **6,0**                       | **4,4**             | **63 % (55–70)** | **86 %**             |
| 0,95 / 1,01                          | 0,5 (0,3–0,9)                    | 6,2                           | 5,0                 | 54 % (46–62)     | 86 %                 |

Mit einer Lesung kostet jede Senkung der Fehlalarme Recall (0,98 statt 0,95: 1,0 statt 1,4 Fehlalarme, aber 53 statt 60 % Recall). Die zweite Lesung senkt beides in die richtige Richtung: Halb so viele Fehlalarme und mehr rote Treffer. Was rot wird und was Hinweis, verschiebt sich nur, verloren geht kein Fehler (Recall mit Hinweisen bleibt 86 %).

| Modell                          | s/Seite (4 / 8 Threads)       | Peak-RAM | passt in 8 GB |
| ------------------------------- | ----------------------------- | -------- | ------------- |
| GLM-OCR Q8_0, 1152 px           | 27,6 (26,9–28,5) / ausstehend | 2,3 GB   | ja            |
| LightOnOCR-3 0.8B Q8_0, 1536 px | ausstehend                    | 1,7 GB   | ja            |

GLM-OCR mit 4 Threads auf den 20 Seiten der Klassenmessung (1240 × 1754 px). Die beiden Modelle laufen nacheinander, nie gleichzeitig.

## Verworfene Hebel

| Hebel                                    | Grund                                                                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q8_0 statt Q4_0 (E2B, E4B)               | Gleicher Recall, 2,1 bzw. 3,4 GB mehr Speicher                                                                                                                                |
| Denken (E4B)                             | Recall 72 statt 91 %, etwa 50-fache Zeit                                                                                                                                      |
| Zweiter Durchgang                        | E2B ein Fehler mehr, E4B keiner, doppelte Zeit                                                                                                                                |
| Selbstkonsistenz                         | Mehrheit wie ein Durchgang, Vereinigung kostet Precision                                                                                                                      |
| Vereinigung E2B und E4B                  | Wie E4B allein, kostet zusätzlich die E2B-Zeit                                                                                                                                |
| KV-Cache in q8_0 (`-ctk q8_0 -ctv q8_0`) | Spart bei E2B 16 MB und bei E4B 28 MB, der Kontext ist klein                                                                                                                  |
| Qwen3.6 35B A3B                          | Schlechter als E4B im Deutschen (86 %), 17,9 GB Peak                                                                                                                          |
| Qwen3.5 9B                               | Nicht gemessen: Qwen3.5 4B lag im Deutschen in der [Modellwahl](../adr/0008-modellwahl-je-schritt.md) mit 79 % deutlich hinter Gemma, und selbst Qwen3.6 35B erreicht nur E2B |
| gpt-oss-20b                              | Nicht gemessen: Denkt immer, 12 GB in MXFP4                                                                                                                                   |
| Gemma 4 31B (dicht)                      | Nicht gemessen: Rechnet je Token alle 31 Mrd. Parameter, etwa achtmal so viel wie 26B A4B                                                                                     |

## Modelle und Lizenzen

Alle Kandidaten stehen unter Apache 2.0 und dürfen weitergegeben werden. Dateien und Prüfsummen stehen in `eval/model-candidates.ts`.

| Modell                 | Datei                                                  | Größe                 | Quelle                     |
| ---------------------- | ------------------------------------------------------ | --------------------- | -------------------------- |
| Gemma 4 E2B Q4_0       | `gemma-4-E2B-it-Q4_0.gguf`                             | 2,8 GB                | ggml-org (in der App)      |
| Gemma 4 E4B Q4_0       | `gemma-4-E4B-it-Q4_0.gguf`                             | 4,6 GB                | ggml-org (in der App)      |
| Gemma 4 26B A4B Q4_0   | `gemma-4-26B-A4B-it-Q4_0.gguf`                         | 14,6 GB               | ggml-org                   |
| Gemma 4 E2B / E4B Q8_0 | `gemma-4-E2B-it-Q8_0.gguf`, `gemma-4-E4B-it-Q8_0.gguf` | 5,0 / 8,0 GB          | ggml-org                   |
| MTP-Köpfe              | `mtp-gemma-4-*-it-Q4_0.gguf`                           | 0,06 / 0,06 / 0,25 GB | ggml-org                   |
| Qwen3.6 35B A3B Q4_K_M | `Qwen3.6-35B-A3B-Q4_K_M.gguf`                          | 20,4 GB               | ggml-org                   |
| Qwen3.5 9B Q4_K_M      | `Qwen3.5-9B-Q4_K_M.gguf`                               | 5,7 GB                | unsloth                    |
| LightOnOCR-3 0.8B Q8_0 | `LightOnOCR-3-0.8B.Q8_0.gguf` und Bildteil             | 1,0 GB                | `eval/ocr-candidates.json` |

## Methode und Testumgebung

- **Qualität** auf dem Mac (Apple M4 Pro), llama.cpp b11551, nur CPU (`--device none --n-gpu-layers 0`), Gemma mit `--no-repack` und `--reasoning off`, Temperatur 0, wo nicht anders angegeben. Der Mac war durch parallele Sitzungen stark belastet (Load bis über 100), Zeiten von dort zählen darum nicht. Die Marken hängen davon nicht ab.
- **Zeit und Speicher** auf simon-pc (AMD Ryzen 7 5700X, 8 Kerne, 62 GB, Fedora 44), dieselbe llama.cpp-Version, 4 und 8 Threads, ein Server zur Zeit. Vor jedem Lauf wirft ein Skript alle Modelldateien aus dem Seitencache, startet den Lauf in einem eigenen systemd-Scope (mit oder ohne Deckel) und schreibt `memory.peak`, `memory.events`, Refaults und gelesene Bytes mit. Läuft parallel ein fremder Prozess mit mehr als 10 % CPU, wird der Lauf wiederholt.
- **Neue Werkzeuge** in `eval/`: `profiles.ts --passes` und `--temperature`, `EVAL_SERVER_ARGS` für zusätzliche Server-Argumente, `EVAL_MAX_TOKENS` für `content-form.ts`, `gruendlich-union.ts` (Vereinigung und Mehrheit von Marken) und `gruendlich-zweite-lesung.ts` (zweite Lesung). Beschrieben in [eval/README.md](../../eval/README.md#gründlicher-modus).

## Grenzen

- Kleine Proben: 61 Fehler für die Korrektur, 24 Mängel für Inhalt und Form. Unterschiede unter etwa 5 Prozentpunkten sind nicht belastbar.
- Selbst geschriebene Texte, keine echten Schülerarbeiten. Die Probentexte sind mit rund 130 Wörtern etwas kürzer als die Seiten der Klassenmessung (120 bis 160 Wörter).
- Der Faktor für einen schwachen Laptop (1,5 bis 2) ist geschätzt, nicht gemessen.
- Die zweite Lesung ist mit E2B als Korrekturmodell ausgewertet. Mit E4B ändern sich die Marken, die Regel greift aber auf dieselbe Weise.
