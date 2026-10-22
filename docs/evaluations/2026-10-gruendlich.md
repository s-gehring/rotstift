# Evaluation: Gründlicher Modus (Oktober 2026)

Frage: Was bringt mehr Rechenzeit oder ein größeres Modell je Schritt (Erkennung, Rechtschreibung und Grammatik, Inhalt und Form), wenn der Rechner 8 GB RAM und keine GPU hat und eine Seite auf einer schwachen CPU höchstens etwa 3 min dauern darf? Simons Rahmen: 100 Seiten in 4 bis 5 Stunden.

Stand: Qualität auf dem Mac, Zeit und Speicher auf simon-pc, beides vollständig. Die Zeiten kamen als Nachtrag nach dem ersten PR (#68). Nach der Messung hat Simon entschieden, dass es kein Zeitlimit gibt: Schwache Rechner dürfen über Nacht rechnen, nur die Vorgabe muss schnell sein.

## Ergebnis

**Für Rechtschreibung und Grammatik bringt nur ein größeres Gemma mehr Qualität.** Gemma 4 E4B statt E2B hebt den Recall von 86,9 auf 91,8 %, die Precision von 94,6 auf 98,2 % und halbiert die Wortfehler, die nach der Korrektur im Text bleiben (10 statt 5 von 62). Gemma 4 26B A4B (MoE, 3,8 Mrd. aktive Parameter) schafft 93,4 % und lässt 3 Wortfehler stehen. E4B rechnet etwa doppelt so lange wie E2B, 26B A4B ebenfalls, solange es in den Speicher passt. Q8_0 statt Q4_0 bringt bei beiden kleinen Modellen nichts.

**Mehr Rechenzeit mit demselben Modell bringt nichts.** Denken (`--reasoning on`) verschlechtert E4B auf 72,1 % Recall bei knapp sechsfacher Zeit. Ein zweiter Durchgang über die eigene Korrektur findet bei E2B einen Fehler mehr und bei E4B keinen. Selbstkonsistenz (drei Stichproben bei Temperatur 0,7, Mehrheit) ist so gut wie ein Durchgang mit Temperatur 0, die Vereinigung der Stichproben kauft Recall mit Precision.

**Spekulatives Dekodieren mit den MTP-Köpfen von Gemma spart 28 bis 51 % der Korrekturzeit, ohne eine Marke zu ändern.** E2B braucht damit 9,1 statt 12,7 s je Seite, E4B 17,2 statt 24,8 s (4 Threads) und 11,2 statt 22,8 s (8 Threads), 26B A4B 13,9 statt 21,4 s (8 Threads). Der Kopf ist 60 bzw. 250 MB groß und kostet 0,2 GB Speicher. Das ist der einzige Hebel, der auch die Vorgabe schneller macht.

**E4B läuft auf 8 GB ohne Zeitverlust.** Unter einem Speicherdeckel von 4,5 GiB (was die Registry auf 8 GB dem Modell lässt) braucht E4B per mmap ohne Repack genauso lange wie ohne Deckel, auch mit MTP und für Inhalt und Form. Es liest nur 0,03 GB je Seite nach, schreibt nichts und bricht nie ab. Von einer SATA-SSD ist es ebenso schnell. Selbst unter 3,5 GiB wird es nur 2 % langsamer.

**26B A4B geht auf 16 GB fast ohne Verlust und auf 8 GB nur sehr langsam.** Unter 12 GiB braucht es 18 % länger. Unter 4,5 GiB liest es die Modelldatei immer wieder neu: Mit 4 Threads von einer schnellen NVMe rund 140 GB je Seite, eine Seite in der Korrektur dauert 12-mal so lange (293 s). Von einer SATA-SSD liest es rund 750 GB je Seite und braucht 57-mal so lange (26 min). Dabei wird nur gelesen, nichts geschrieben, kein Swap und kein Abbruch, und der Rechner bleibt bedienbar.

**Inhalt und Form: Kein Modell ist messbar besser.** Auf 24 eingebauten Mängeln treffen E2B 18, E4B 17, 26B A4B 16 und Qwen3.6 35B A3B 19. E4B und 26B A4B brauchen dafür doppelt so lange wie E2B.

**Erkennung: Eine zweite Lesung mit LightOnOCR-3 0.8B halbiert die Fehlalarme aus Lesefehlern.** Rot bleibt eine Marke nur, wenn LightOn das Wort gleich liest und GLM-OCR sich zu mindestens 0,8 sicher ist, sonst wird sie zum Hinweis „unsicher gelesen“. Auf 20 Seiten echter Handschrift sinken die roten Marken von 1,4 auf 0,7 je 100 Wörter, auf den gerenderten Seiten steigt der Anteil echter Fehler, die rot markiert werden, von 60 auf 63 %. Die zweite Lesung kostet auf Klassenseiten 90 % einer Erkennung mit GLM-OCR (24,9 statt 27,6 s je Seite).

## Empfehlung

- **Vorgabe (Schnell):** Wie heute, dazu MTP für E2B. Das spart rund 5 s je Seite (100 Seiten: 1,5 statt 1,7 Stunden auf simon-pc).
- **Gründlich, ab 8 GB:** GLM-OCR mit zweiter Lesung durch LightOnOCR-3 0.8B, Rechtschreibung und Grammatik sowie Inhalt und Form mit Gemma 4 E4B Q4_0 und MTP. Etwa 103 s je Seite auf simon-pc, 100 Seiten in 2,9 Stunden, auf einem schwachen Laptop 4,3 bis 5,7 Stunden. Auf 8 GB ohne Aufschlag, solange die App E4B dort ohne Repack startet (seit #71 der Fall).
- **Sehr gründlich:** Dasselbe mit Gemma 4 26B A4B und MTP. Mit 32 GB so schnell wie Gründlich, mit 16 GB rund 10 % langsamer. Auf 8 GB möglich, aber langsam: 100 Seiten brauchen von einer NVMe etwa 19 Stunden, von einer SATA-SSD rund 85 Stunden, also dreieinhalb Tage. Das ist ein Lauf für Wochenende oder Ferien.
- **Restdauer:** Die Faktoren unten ersetzen die vorläufigen Werte in `src/models/speed.ts`. Vor allem darf ein Modell über dem Speicher nicht pauschal 10-mal so lange brauchen: E4B auf 8 GB ist es 1-mal, 26B A4B auf 16 GB 1,2-mal, 26B A4B auf 8 GB 12-mal (NVMe) bzw. 57-mal (SATA).

## Faktoren für die Restdauer

Relativ zu GLM-OCR (Erkennung) bzw. Gemma 4 E2B (Korrektur, Inhalt und Form) im selben Schritt, gemessen auf simon-pc mit 4 Threads, alle Modelle aus dem Seitencache geworfen vor jedem Lauf.

| Modell            | Schritt         | passt in den Speicher | 8 GB (4,5 GiB fürs Modell) | 16 GB (12 GiB) | heute in `speed.ts`     |
| ----------------- | --------------- | --------------------- | -------------------------- | -------------- | ----------------------- |
| LightOnOCR-3 0.8B | zweite Lesung   | 0,9                   | 0,9                        | 0,9            | 0,65                    |
| Gemma 4 E4B       | Korrektur       | 1,95                  | 1,95                       | 1,95           | 1,8, auf 8 GB 18        |
| Gemma 4 E4B       | Inhalt und Form | 1,9                   | 1,9                        | 1,9            | 1,8, auf 8 GB 18        |
| Gemma 4 26B A4B   | Korrektur       | 1,9                   | 23 (NVMe), 110 (SATA)      | 2,3            | 2,5, auf 8 und 16 GB 25 |
| Gemma 4 26B A4B   | Inhalt und Form | 2,1                   | 25 (NVMe), 120 (SATA)      | 2,5            | 2,5, auf 8 und 16 GB 25 |
| MTP-Kopf dazu     | Korrektur       | 0,7                   | 0,7 (E4B gemessen)         | 0,7            | nicht vorhanden         |

Herleitung: E4B braucht in der Korrektur 24,8 statt 12,7 s je Seite, 26B A4B 24,5 s, LightOn 24,9 statt 27,6 s für GLM-OCR. Inhalt und Form: E2B 27,7 s je Arbeit, E4B 53,2 s (4 Threads), 26B A4B 55,1 s (8 Threads, mit 4 Threads geschätzt 58 s). Die Spalten 8 GB und 16 GB multiplizieren mit den Aufschlägen aus dem Abschnitt „Modelle größer als der Speicher“ (E4B 1,0, 26B A4B 1,18 unter 12 GiB und 11,9 unter 4,5 GiB mit 4 Threads). Für Inhalt und Form unter 4,5 GiB ist derselbe Aufschlag angenommen, gemessen ist er nur für die Korrektur. Ob MTP unter 4,5 GiB bei 26B A4B noch hilft, ist nicht gemessen.

Eine einfache Regel für `exceedsMemory`: Passt die Modelldatei in den Speicher fürs Modell (E4B: 4,6 GB Datei, 4,8 GB frei), gibt es keinen Aufschlag, auch wenn Kontext und Puffer darüber liegen. Fehlen bis zu 25 % (26B A4B auf 16 GB: 14,6 GB Datei, 13,4 GB frei), sind es etwa 1,2. Fehlen zwei Drittel (26B A4B auf 8 GB), 12 auf einer NVMe und 57 auf einer SATA-SSD. Welche Platte ein Rechner hat, weiß die App nicht. Der SATA-Wert ist die sichere Schätzung, das Lernen aus dem Lauf korrigiert ihn nach der ersten Seite.

## Rahmen und Zeitbudget

Heute braucht eine Seite auf simon-pc mit 4 Threads rund 31 s Erkennung, 3 s Zeilenlage, 16 s Rechtschreibung und Grammatik und 10 s Inhalt und Form (20 s je Arbeit mit 2 Seiten), zusammen etwa 60 s ([Messung schwacher Rechner](../messung-schwacher-rechner.md)). Ein schwacher Laptop braucht nach derselben Messung das 1,5- bis 2-Fache. Die ursprüngliche Vorgabe für diese Messung war höchstens 3 min je Seite auf einem schwachen Laptop und 100 Seiten in 4 bis 5 Stunden. Simon hat sie nach der Messung aufgehoben.

Mit den Faktoren oben ergibt sich je Seite auf simon-pc (4 Threads), Seiten der Klassenmessung, zwei Seiten je Arbeit:

| Stufe                      | Erkennung | zweite Lesung | Zeilenlage | Korrektur | Inhalt und Form | je Seite | 100 Seiten simon-pc | 100 Seiten schwacher Laptop (1,5 bis 2) |
| -------------------------- | --------- | ------------- | ---------- | --------- | --------------- | -------- | ------------------- | --------------------------------------- |
| Schnell (heute)            | 31 s      |               | 3 s        | 16 s      | 10 s            | 60 s     | 1,7 h               | 2,5–3,3 h                               |
| Schnell mit MTP            | 31 s      |               | 3 s        | 12 s      | 10 s            | 56 s     | 1,5 h               | 2,3–3,1 h                               |
| Gründlich                  | 31 s      | 28 s          | 3 s        | 31 s      | 20 s            | 112 s    | 3,1 h               | 4,7–6,2 h                               |
| Gründlich mit MTP          | 31 s      | 28 s          | 3 s        | 22 s      | 20 s            | 103 s    | 2,9 h               | 4,3–5,7 h                               |
| Sehr gründlich, 32 GB      | 31 s      | 28 s          | 3 s        | 31 s      | 21 s            | 114 s    | 3,2 h               | 4,8–6,3 h                               |
| Sehr gründlich, 16 GB      | 31 s      | 28 s          | 3 s        | 37 s      | 25 s            | 123 s    | 3,4 h               | 5,1–6,9 h                               |
| Sehr gründlich, 8 GB, NVMe | 31 s      | 28 s          | 3 s        | 367 s     | 255 s           | 684 s    | 19 h                | ähnlich, die Platte bremst              |
| Sehr gründlich, 8 GB, SATA | 31 s      | 28 s          | 3 s        | 1760 s    | 1220 s          | 3040 s   | 85 h                | ähnlich, die Platte bremst              |

Modellwechsel sind nicht eingerechnet. Die zweite Lesung wechselt je Seite zweimal das Modell (ADR 0008), auf 8 GB kalt etwa 2 bis 3 s je Seite. Unter dem Speicherdeckel hängt die Zeit an der Platte, nicht an der CPU, der Laptop-Faktor gilt dort nicht.

Auf 8 GB bleiben für das Modell etwa 4,5 GiB (4,8 GB): Die Registry hält 3,5 GiB für System, App und WebView frei (`RESERVED_RAM` in `src/models/registry.ts`). Es läuft immer nur ein Modell zur Zeit.

## Rechtschreibung und Grammatik

Proben: Die 8 deutschen Texte aus `eval/samples/texts` und die 4 aus `eval/samples/profiles/gross-klein`, jeweils mit Fehlern und fehlerfrei (24 Seiten, 61 Soll-Fehler, 775 fehlerfreie Wörter). Recall und Precision zählen Art und Stelle, in Klammern das 95-%-Intervall nach Wilson. „Wortfehler danach“ sind die Fehler, die nach der Korrektur im Text bleiben (vorher 62). Peak-RAM ist der größte RSS des llama-server. Zeiten auf simon-pc mit den 8 deutschen Texten (16 Seiten mit und ohne Fehler, je etwa 130 Wörter).

| Variante                     | Recall         | Precision | Fehlalarme je 100 Wörter | Wortfehler danach | s/Seite (4 / 8 Threads) | Peak-RAM | passt in 8 GB               |
| ---------------------------- | -------------- | --------- | ------------------------ | ----------------- | ----------------------- | -------- | --------------------------- |
| Gemma 4 E2B Q4_0 (heute)     | 86,9 % (76–93) | 94,6 %    | 0,3                      | 10                | 12,7 / 11,7             | 3,1 GB   | ja                          |
| Gemma 4 E4B Q4_0             | 91,8 % (82–96) | 98,2 %    | 0,6                      | 5                 | 24,8 / 22,8             | 4,9 GB   | ja, per mmap ohne Aufschlag |
| Gemma 4 26B A4B Q4_0         | 93,4 % (84–97) | 98,3 %    | 0,3                      | 3                 | 24,5 / 21,4             | 14,5 GB  | ja, aber 12-mal so lang     |
| Gemma 4 E2B Q8_0             | 86,9 % (76–93) | 96,4 %    | 0,1                      | 8                 | nicht gemessen          | 5,5 GB   | nein                        |
| Gemma 4 E4B Q8_0             | 91,8 % (82–96) | 98,2 %    | 0,4                      | 4                 | nicht gemessen          | 8,6 GB   | nein                        |
| E2B, 3 Stichproben, Mehrheit | 86,9 % (76–93) | 93,0 %    | 0,3                      | 11                | 3-mal E2B               | 3,1 GB   | ja                          |
| E2B, 3 Stichproben vereinigt | 91,8 % (82–96) | 91,8 %    | 0,6                      | 8                 | 3-mal E2B               | 3,1 GB   | ja                          |
| E4B, 3 Stichproben, Mehrheit | 91,8 % (82–96) | 98,2 %    | 0,8                      | 5                 | 3-mal E4B               | 4,9 GB   | wie E4B                     |

Die Stichproben laufen mit Temperatur 0,7 (`profiles.ts --temperature 0.7`) und werden mit `gruendlich-union.ts --votes 2` (Mehrheit) oder `--votes 1` (Vereinigung) zusammengeführt. Einzeln liegen die drei E2B-Stichproben bei 83,6 bis 88,5 % Recall, die drei E4B-Stichproben alle bei 91,8 %.

Nur die 8 deutschen Texte (43 Soll-Fehler, 510 fehlerfreie Wörter, Wortfehler vorher 45):

| Variante                                   | Recall | Precision | Fehlalarme je 100 Wörter | Wortfehler danach | Rechenzeit                   |
| ------------------------------------------ | ------ | --------- | ------------------------ | ----------------- | ---------------------------- |
| E2B, ein Durchgang                         | 86,0 % | 97,4 %    | 0,0                      | 6                 | 1                            |
| E2B, zwei Durchgänge (`--passes 2`)        | 88,4 % | 97,4 %    | 0,0                      | 5                 | 2                            |
| E4B, ein Durchgang                         | 90,7 % | 97,5 %    | 1,0                      | 4                 | 1                            |
| E4B, zwei Durchgänge                       | 90,7 % | 97,5 %    | 1,0                      | 4                 | 2                            |
| E4B mit Denken                             | 72,1 % | 96,9 %    | 1,2                      | 14                | 5,7                          |
| Marken von E2B und E4B vereinigt           | 90,7 % | 97,5 %    | 1,0                      | 3                 | E2B plus E4B                 |
| Qwen3.6 35B A3B Q4_K_M (MoE, 3 Mrd. aktiv) | 86,0 % | 97,4 %    | 0,0                      | 6                 | nicht gemessen, 17,9 GB Peak |

Rechenzeit relativ zu einem Durchgang desselben Modells, für Denken auf simon-pc an einem Text gemessen (142,7 statt 24,9 s je Seite). Mit Denken schreibt E4B vor jeder Antwort mehrere Tausend Token, braucht dafür 12288 Token Kontext und 8192 Ausgabe-Token (Kandidat `gemma-4-e4b-q4-denken`) und übersieht danach mehr Fehler, vor allem bei Getrennt- und Zusammenschreibung (5 statt 9 von 9) und Grammatik (2 statt 3 von 6).

Einordnung: Die Intervalle von E2B und E4B überlappen. Für E4B spricht, dass es in jeder Teilmenge und jeder Stichprobe vorne liegt, halb so viele Fehler im Text stehen lässt und in fehlerhaften Texten präziser markiert (98,2 statt 94,6 %). Auf fehlerfreien Texten setzt es etwas mehr Fehlalarme (0,6 statt 0,3 je 100 Wörter). 26B A4B ist nochmals etwas besser, der Abstand zu E4B (2 Fehler von 61) liegt aber im Rauschen.

## Spekulatives Dekodieren

Gemma 4 bringt eigene MTP-Köpfe (Multi-Token-Prediction) als kleine GGUF-Dateien mit (60 MB für E2B und E4B, 250 MB für 26B A4B). llama-server schlägt damit mehrere Token vor und prüft sie in einem Schritt (`--spec-type draft-mtp --model-draft <Kopf>`). Ohne Zusatzdatei geht `--spec-type ngram-simple`, das Token aus dem bisherigen Text vorschlägt. Korrigierter Text wiederholt den Eingabetext fast wörtlich, das ist der günstigste Fall für beide.

Bei Temperatur 0 ändert keine der beiden Varianten die Ausgabe: Recall, Precision und Marken sind in jedem Lauf gleich. Auf dem Mac nahm E4B 91 % der vom MTP-Kopf vorgeschlagenen Token an.

| Variante                   | s/Seite 4 Threads | s/Seite 8 Threads | Ersparnis   | Peak-RAM |
| -------------------------- | ----------------- | ----------------- | ----------- | -------- |
| E2B                        | 12,7              | 11,7              |             | 3,1 GB   |
| E2B mit `ngram-simple`     | 11,1              | nicht gemessen    | 13 %        | 3,2 GB   |
| E2B mit MTP                | 9,1               | nicht gemessen    | 28 %        | 3,3 GB   |
| E4B                        | 24,8              | 22,8              |             | 4,9 GB   |
| E4B mit `ngram-simple`     | 22,5              | 16,0              | 9 % / 30 %  | 5,0 GB   |
| E4B mit MTP                | 17,2              | 11,2              | 31 % / 51 % | 5,1 GB   |
| E4B mit MTP unter 4,5 GiB  | 17,2              | nicht gemessen    | 31 %        | 4,7 GB   |
| 26B A4B                    | 24,5              | 21,4              |             | 14,5 GB  |
| 26B A4B mit `ngram-simple` | nicht gemessen    | 16,3              | 24 %        | 15,2 GB  |
| 26B A4B mit MTP            | nicht gemessen    | 13,9              | 35 %        | 15,0 GB  |

MTP schlägt `ngram-simple` überall. Mit 8 Threads hilft beides mehr, weil das Prüfen mehrerer Token auf einmal Rechenleistung braucht, die bei 4 Threads knapp ist. Für Inhalt und Form ist Spekulation nicht gemessen: Die Antworten dort sind kurze JSON-Objekte, da gibt es wenig vorherzusagen.

## Modelle größer als der Speicher

Mit `--no-repack` liest llama.cpp die Gewichte per mmap direkt aus der Datei. Sie liegen dann als Seiten der Datei im Speicher, die der Kernel unter Druck verwerfen und bei Bedarf neu lesen kann, statt das Programm zu beenden. Ein Modell kann so auch mit weniger Speicher laufen, als die Datei groß ist, auf Kosten von Lesezugriffen. Bei MoE-Modellen wie 26B A4B braucht jedes Token nur einen Teil der Experten, das ist der günstigste Fall.

Gemessen auf simon-pc mit einem Deckel aus systemd (`MemoryMax`, ohne Swap), siehe [eval/README.md](../../eval/README.md#gründlicher-modus). Der Deckel gilt für Node und llama-server zusammen und zählt die Seiten der Modelldatei mit. Vor jedem Lauf sind alle Modelldateien aus dem Seitencache geworfen. Die NVMe ist eine Samsung 980 PRO, die SATA-SSD eine Crucial MX500, beide mit btrfs.

| Modell, Deckel, Threads, Platte       | s/Seite           | gegenüber ohne Deckel | gelesen je Seite          | OOM  |
| ------------------------------------- | ----------------- | --------------------- | ------------------------- | ---- |
| E2B, 3,5 GiB, 4, NVMe                 | 12,7              | 1,00                  | wie ohne Deckel           | nein |
| E4B, 4,5 GiB (8 GB), 4, NVMe          | 24,8              | 1,00                  | 0,3 GB (ohne Deckel 0,27) | nein |
| E4B mit MTP, 4,5 GiB, 4, NVMe         | 17,2              | 1,00                  | 0,3 GB                    | nein |
| E4B, 3,5 GiB, 4, NVMe                 | 25,2              | 1,02                  | 0,4 GB                    | nein |
| E4B, 4,5 GiB, 4, SATA                 | 24,8              | 1,00                  | 0,3 GB                    | nein |
| E4B Inhalt und Form, 4,5 GiB, 4, NVMe | 53,2 s je Arbeit  | 1,00                  |                           | nein |
| 26B A4B, 12 GiB (16 GB), 8, NVMe      | 25,3              | 1,18                  | 2,2 GB (ohne Deckel 0,9)  | nein |
| 26B A4B, 4,5 GiB, 8, NVMe             | 176               | 8,3                   | 125 GB                    | nein |
| 26B A4B, 4,5 GiB, 4, NVMe             | 293               | 11,9                  | 141 GB                    | nein |
| 26B A4B, 4,5 GiB, 4, SATA             | 1548 (eine Seite) | 57                    | 750 GB                    | nein |

Die Läufe unter 4,5 GiB mit 26B A4B umfassen einen Text (2 Seiten), von der SATA-SSD nur dessen erste Seite (die zweite hätte weitere 26 min gebraucht, gegen Ende lief kurz `updatedb`). Alle anderen Läufe umfassen die 8 deutschen Texte (16 Seiten). „Gelesen“ ist, was der Rechner während des Laufs von der Platte las, geteilt durch die Seiten. Es enthält das erste Laden der Modelldatei.

Warum E4B kaum leidet und 26B A4B stark: Ein großer Teil der E4B-Datei sind vermutlich die Per-Layer-Embeddings, von denen je Token nur wenige Zeilen gebraucht werden. Der Rest passt unter 4,5 GiB. 26B A4B braucht je Token nur 3,8 Mrd. Parameter, aber von Token zu Token andere Experten. Über eine Seite berührt es fast die ganze Datei. Unter 12 GiB fehlt nur ein kleiner Teil, unter 4,5 GiB zwei Drittel, dann liest es die Datei von der NVMe je Seite rund zehnmal. Von der SATA-SSD liest es fünfmal so viel, vermutlich weil vorausgelesene Seiten unter dem Deckel wieder verworfen werden, bevor sie an der Reihe sind.

Was dabei mit dem Rechner passiert, gemessen im Lauf mit 26B A4B unter 4,5 GiB:

- **Nur Lesen:** Der llama-server las 295 GB (NVMe) bzw. 784 GB in der ersten Seite (SATA) und schrieb 0 Byte (`/proc/<pid>/io`). Swap wurde nicht geschrieben (`pswpout` unverändert). Lesen verschleißt eine SSD nicht.
- **Kein Absturz:** Kein Lauf endete mit OOM, alle Seiten kamen durch. Der Kernel verwirft unter dem Deckel Seiten der Modelldatei und liest sie neu, statt den Prozess zu beenden.
- **Bedienbar:** Die Platte ist voll ausgelastet (NVMe 87 %, SATA 99 %). Zufällige 4-KB-Lesezugriffe eines anderen Prozesses auf dieselbe Platte blieben trotzdem schnell: Auf der NVMe im Median 0,06 ms wie vorher (95. Perzentil höchstens 0,19 ms), auf der SATA-SSD im Median 0,10 ms wie vorher (95. Perzentil im Mittel 1,4 ms, höchstens 7,6 ms statt 0,1 ms). Programme starten also weiter, Dateien öffnen sich etwas träger.
- **Grenze der Messung:** Der Deckel betrifft nur den Lauf. Auf einem echten 8-GB-Rechner konkurriert die Modelldatei mit allen anderen Programmen um den Seitencache. Linux verdrängt dann auch deren Dateiseiten und lagert je nach `swappiness` Speicher anderer Programme in den Swap aus, das schreibt. Windows und macOS (Speicherkompression) sind nicht gemessen.

## Inhalt und Form

Proben: Die 10 Arbeiten aus `eval/samples/content-form` mit 24 eingebauten Mängeln, Variante `features`, ein Lauf mit Temperatur 0. „Treffer“ zählt erkannte Mängel am Rand.

| Variante                            | Treffer                      | Art richtig   | Kommentare je saubere Arbeit | s je Arbeit (4 / 8 Threads) | Peak-RAM | passt in 8 GB      |
| ----------------------------------- | ---------------------------- | ------------- | ---------------------------- | --------------------------- | -------- | ------------------ |
| Gemma 4 E2B Q4_0 (heute)            | 75 % (18/24)                 | 89 %          | 0,0                          | 27,7 / nicht gemessen       | 3,4 GB   | ja                 |
| Gemma 4 E4B Q4_0                    | 71 % (17/24)                 | 88 %          | 0,0                          | 53,2 / nicht gemessen       | 5,2 GB   | ja, ohne Aufschlag |
| Gemma 4 26B A4B Q4_0                | 67 % (16/24)                 | 94 %          | 0,0                          | nicht gemessen / 55,1       | 14,5 GB  | langsam            |
| Qwen3.6 35B A3B Q4_K_M              | 79 % (19/24)                 | 89 %          | 0,5                          | nicht gemessen              | 17,9 GB  | nein               |
| E4B ohne und mit Denken, 5 Arbeiten | 69 % (9/13) und 77 % (10/13) | 78 % und 80 % | 0,0                          | auf dem Mac 9-mal so lang   | 5,3 GB   | wie E4B            |

Kein Modell ist hier messbar besser. 24 Mängel trennen Unterschiede von 3 Treffern nicht vom Zufall, und das größte Gemma trifft am wenigsten. Die Zeiten sind Mittelwerte je Arbeit auf simon-pc, die längste Arbeit brauchte mit E2B 48 s, mit E4B 98 s und mit 26B A4B 69 s. Inhalt und Form sollte darum das Modell der Korrektur nutzen, dann entfällt ein Modellwechsel.

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

| Modell                          | s/Seite (4 / 8 Threads) | Peak-RAM | passt in 8 GB |
| ------------------------------- | ----------------------- | -------- | ------------- |
| GLM-OCR Q8_0, 1152 px           | 27,6 / 18,8             | 2,3 GB   | ja            |
| LightOnOCR-3 0.8B Q8_0, 1536 px | 24,9 / 18,3             | 1,7 GB   | ja            |

Die 20 Seiten der Klassenmessung (1240 × 1754 px). Die beiden Modelle laufen nacheinander, nie gleichzeitig. Auf diesen Seiten ist LightOn kaum schneller als GLM-OCR, anders als auf den kleineren ScaDS-Seiten (9,9 statt 15,5 s, [Erkennung genauer](2026-10-erkennung-genauer.md)).

## Verworfene Hebel

| Hebel                                    | Grund                                                                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q8_0 statt Q4_0 (E2B, E4B)               | Gleicher Recall, 2,1 bzw. 3,4 GB mehr Speicher                                                                                                                                |
| Denken (E4B)                             | Recall 72 statt 91 %, 5,7-fache Zeit                                                                                                                                          |
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
- **Zeit und Speicher** auf simon-pc (AMD Ryzen 7 5700X, 8 Kerne, 62 GB, Fedora 44, NVMe Samsung 980 PRO, SATA-SSD Crucial MX500, beide btrfs), dieselbe llama.cpp-Version, 4 und 8 Threads, ein Server zur Zeit. Vor jedem Lauf wirft ein Skript alle Modelldateien aus dem Seitencache, startet den Lauf in einem eigenen systemd-Scope (mit oder ohne Deckel) und schreibt `memory.peak`, `memory.events`, Refaults, gelesene und geschriebene Bytes von Platte und Prozess sowie Swap-Zähler mit. Ein zweiter Prozess misst alle 10 s die Dauer zufälliger 4-KB-Lesezugriffe auf beiden Platten. Läuft parallel ein fremder Prozess mit mehr als 10 % CPU (Kernel-Threads ausgenommen), wird der Lauf wiederholt. Die Marken aller Zeitläufe stimmen mit den Läufen ohne Spekulation, ohne Deckel und mit anderer Thread-Zahl überein.
- **Neue Werkzeuge** in `eval/`: `profiles.ts --passes` und `--temperature`, `EVAL_SERVER_ARGS` für zusätzliche Server-Argumente, `EVAL_MAX_TOKENS` für `content-form.ts`, `gruendlich-union.ts` (Vereinigung und Mehrheit von Marken) und `gruendlich-zweite-lesung.ts` (zweite Lesung). Beschrieben in [eval/README.md](../../eval/README.md#gründlicher-modus).

## Grenzen

- Kleine Proben: 61 Fehler für die Korrektur, 24 Mängel für Inhalt und Form. Unterschiede unter etwa 5 Prozentpunkten sind nicht belastbar.
- Selbst geschriebene Texte, keine echten Schülerarbeiten. Die Probentexte sind mit rund 130 Wörtern etwas kürzer als die Seiten der Klassenmessung (120 bis 160 Wörter).
- Der Faktor für einen schwachen Laptop (1,5 bis 2) ist geschätzt, nicht gemessen. Unter dem Speicherdeckel hängt die Zeit an der Platte. Eine langsamere Platte als die MX500 (eMMC, alte SATA-SSD, Festplatte) macht 26B A4B auf 8 GB noch deutlich langsamer.
- Speicherdeckel per cgroup unter Linux mit btrfs (Readahead 4 MB). Andere Dateisysteme und Betriebssysteme lesen anders vor, und auf einem echten 8-GB-Rechner teilt sich das Modell den Speicher mit allen Programmen.
- Die zweite Lesung ist mit E2B als Korrekturmodell ausgewertet. Mit E4B ändern sich die Marken, die Regel greift aber auf dieselbe Weise.
