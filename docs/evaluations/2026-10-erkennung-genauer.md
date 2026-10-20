# Evaluation: Genauere Texterkennung (Oktober 2026)

Frage: Gibt es eine Texterkennung, die deutsche Handschrift genauer liest als GLM-OCR, auf einem 8-GB-Laptop ohne GPU läuft (Peak-RAM klar unter 3 GB, nicht deutlich langsamer) und damit die rund 10 Hinweise „unsicher gelesen“ je 100 Wörter senkt? Und passt die Schwelle 0,95 der Lesesicherheit?

## Ergebnis

**Kein Kandidat ist auf dem 8-GB-Budget klar besser. GLM-OCR bleibt Standard, die Schwelle bleibt 0,95, die App ändert sich nicht.** Der beste neue Kandidat, LightOnOCR-3 0.8B (Oktober 2026, Apache-2.0), liest zwar deutlich genauer, verbessert aber stillschweigend echte Schülerfehler, die danach weder der Korrektor noch die Lehrkraft sieht.

**LightOnOCR-3 0.8B (Q8_0) liest genauer, schneller und sparsamer, aber nicht buchstabengetreu.** Auf den 17 ScaDS-Seiten, die alle Modelle vollständig lesen, liest es 11,4 % der Wörter falsch (95-%-Intervall 9,9 bis 13,0), GLM-OCR 18,5 % (16,8 bis 20,5). Es braucht auf simon-pc 9,9 statt 15,5 s je Seite und 1,6 statt 2,3 GB Peak-RAM, seine Lesesicherheit ist besser kalibriert, und bei seiner eigenen Schwelle 0,9 bleiben auf ScaDS 1,4 Fehlalarme (1,0 bis 2,1) und **nur 3,1 statt 10,0 Hinweise je 100 Wörter**. Dagegen steht: **Auf den gerenderten Schülertexten verbessert es 16 % der 172 eingebauten Fehler eigenmächtig (12 bis 23), darunter 28 der 112 Rechtschreibfehler** („vieleicht“, „schwirig“, „nähmlich“, „hälfte“), GLM-OCR keinen einzigen. Über alle 172 Fehler gerechnet findet die Kette mit LightOnOCR-3 bei Schwelle 0,9 noch 49 % als rote Marke und 68 % mit Hinweisen, mit GLM-OCR bei 0,95 sind es 55 % und 78 %. Dazu endet eine von 20 Seiten in einer Wiederholungsschleife (GLM-OCR: Keine). Für ein Werkzeug, das Fehler finden soll, wiegt der verlorene Fehler schwerer als der gesparte Hinweis.

**Qwen3.5 2B (Q4_K_M) scheidet aus.** Es liest so gut wie Qwen3-VL 4B (10,1 % falsch gelesene Wörter), braucht aber 3,0 GB Peak-RAM auf Linux und 3,6 GB auf dem Mac, ist langsamer als GLM-OCR (20,6 s je Seite) und verbessert 26 % der eingebauten Fehler.

**Für die 16-GB-Option liest LightOnOCR-3 4B (Q4_K_M) am besten, verbessert aber noch mehr Schülerfehler.** Nur 5,8 % falsch gelesene Wörter (4,8 bis 7,0), Zeichenfehlerrate 2,6 %, keine Wiederholungsschleife, 5,7 GB Peak-RAM und auf dem Mac etwa so schnell wie Qwen3-VL 4B. Es verbessert aber 28 % der eingebauten Fehler (22 bis 35), Qwen3-VL 4B 18 % (13 bis 24). Über alle 172 Fehler findet die Kette mit LightOnOCR-3 4B bei seiner Schwelle 0,98 nur 33 % als rote Marke und 58 % mit Hinweisen, mit Qwen3-VL 4B bei 0,9 sind es 55 % und 65 %. Qwen3-VL 4B bleibt die 16-GB-Option.

**Schwelle: Die Regel bestätigt 0,95 für GLM-OCR, für jedes andere Modell muss sie neu gewählt werden.** Bisher war 0,95 „der Kompromiss nahe am Ziel“. Jetzt ist die Regel festgeschrieben und getestet (`chooseThreshold` in `eval/ocr-score.ts`): Die kleinste Schwelle, bei der das 95-%-Intervall der Fehlalarme auf fehlerfreier Schrift 1 je 100 Wörter erreicht. Für GLM-OCR ergibt das auf ScaDS wieder 0,95, für LightOnOCR-3 0.8B 0,9, für Qwen3.5 2B 0,8, für LightOnOCR-3 4B 0,98 und für Qwen3-VL 4B ebenfalls 0,98 statt der 0,9 in der Registry. Die Kandidaten sind besser kalibriert als GLM-OCR (Kalibrierungsfehler 0,014 bis 0,028 statt 0,050): GLM-OCR liest auch Wörter, bei denen es sich zu mehr als 99 % sicher ist, in 3 % der Fälle falsch, das sind 7 % aller seiner Lesefehler. Die Schwelle gilt erst endgültig, wenn sie auf echter Schülerhandschrift bestätigt ist. Welche Seiten Simon dafür schreiben müsste, steht unter [Eigene Handschrift für die Schwelle](#eigene-handschrift-für-die-schwelle). Die Prüfung läuft dann mit einem Befehl.

## Empfehlung

1. **Keine Änderung an der App.** GLM-OCR mit `uncertainBelow: 0.95` bleibt Standard, kein neuer Registry-Eintrag.
2. **LightOnOCR-3 0.8B nicht übernehmen**, solange es Rechtschreibfehler verbessert. Wiedervorlage, wenn eigene Handschriftseiten vorliegen: Der Befehl unten misst beide Modelle nebeneinander. Bleibt der Anteil verbesserter Fehler auf echter Schrift über etwa 5 %, ist das Modell für Rotstift erledigt. Ein Registry-Eintrag bräuchte außerdem eine kleine Schemaänderung: Das Modell ist nur mit leerem Prompt trainiert, `prompt` muss in `src/models/registry.ts` dann leer sein dürfen.
3. **16-GB-Option: Qwen3-VL 4B behalten**, LightOnOCR-3 4B nicht aufnehmen. Nach der Regel läge die Schwelle für Qwen3-VL bei 0,98 statt 0,9 (Fehlalarme 1,3 statt 1,9 je 100 Wörter, rote Marken 51 % statt 55 % aller Fehler, Hinweise 3,3 statt 2,7 je 100 Wörter). Der Unterschied ist klein, entscheiden sollte der Lauf auf eigener Handschrift.
4. **Eigene Handschrift schreiben** (Plan unten) und danach `eval/ocr-threshold.ts` laufen lassen. Erst dieser Lauf zeigt, ob 0,95 auf Schülerschrift hält und wie viele Hinweise dort entstehen.
5. **Harness:** Kandidaten stehen jetzt in `eval/ocr-candidates.json` (Registry-Format), `ocr-run.ts` startet sie wie die App (auch `--reasoning off`), `ocr-score.ts` ordnet Korrekturläufe über `ocrModel` ihrer Erkennung zu, zeigt erhaltene und eigenmächtig verbesserte Fehler und nennt die Schwelle nach der Regel, `ocr-calibration.ts` misst die Kalibrierung. Beschreibung in [eval/README.md](../../eval/README.md#kandidaten-für-die-erkennung).

## Messergebnisse

### Lesefehler auf ScaDS

20 Seiten (000 bis 019), simon-pc, 8 Threads. GLM-OCR mit 1152 px (Registry), alle anderen mit 1536 px langer Kante. Die ScaDS-Bilder sind fast alle kleiner als 1152 px, der Unterschied betrifft nur die Seiten 008 und 015. Unvollständige Seiten (Wiederholung bis zum Token-Limit) sind nicht gewertet.

| Erkennung                   | Zeichenfehlerrate | falsch gelesene Wörter | Schleifen             | s/Seite (Mittel) | Peak-RAM |
| --------------------------- | ----------------- | ---------------------- | --------------------- | ---------------- | -------- |
| GLM-OCR (Q8_0), Standard    | 7,1 % (6,7–7,5)   | 20,2 % (18,5–22,1)     | 0 von 20              | 15,5             | 2,3 GB   |
| LightOnOCR-3 0.8B (Q8_0)    | 5,5 % (5,1–5,9)   | 12,7 % (11,3–14,3)     | 1 von 20 (002, 61 s)  | 9,9              | 1,6 GB   |
| Qwen3.5 2B (Q4_K_M)         | 4,7 % (4,4–5,1)   | 11,0 % (9,6–12,5)      | 1 von 20 (010, 89 s)  | 20,6             | 3,0 GB   |
| Qwen3-VL 4B (Q4_K_M), 16 GB | 4,3 % (4,0–4,7)   | 11,1 % (9,8–12,6)      | 1 von 20 (008, 251 s) | 38,9¹            | 5,3 GB   |
| LightOnOCR-3 4B (Q4_K_M)    | 3,1 % (2,8–3,4)   | 6,5 % (5,5–7,7)        | 0 von 20              | 32,2             | 5,7 GB   |

¹ Aus der Messung für [2026-10-lesefehler.md](2026-10-lesefehler.md), damals lief nebenher Last auf simon-pc. GLM-OCR brauchte in jener Messung 21,5 statt jetzt 15,5 s.

Auf den 17 Seiten, die jedes Modell vollständig liest (ohne 002, 008, 010):

| Erkennung         | Zeichenfehlerrate | falsch gelesene Wörter         |
| ----------------- | ----------------- | ------------------------------ |
| GLM-OCR           | 6,1 % (5,7–6,5)   | 18,5 % (16,8–20,5), 314 / 1693 |
| LightOnOCR-3 0.8B | 4,4 % (4,1–4,8)   | 11,4 % (9,9–13,0), 190 / 1673  |
| Qwen3.5 2B        | 4,1 % (3,8–4,5)   | 10,1 % (8,8–11,7), 169 / 1669  |
| Qwen3-VL 4B       | 3,8 % (3,5–4,1)   | 10,3 % (8,9–11,8), 172 / 1676  |
| LightOnOCR-3 4B   | 2,6 % (2,4–2,9)   | 5,8 % (4,8–7,0), 97 / 1680     |

Typische Lesefehler von LightOnOCR-3 0.8B sind andere als die von GLM-OCR: Es rät häufiger ein ganzes, sinnvolles Wort („Güterwagen“ statt „Geländewagen“, „Nina“ statt „Niwa“), statt Buchstaben zu vertauschen. Überschriften gibt es als Markdown aus („# Peer - Review“), die Raute zählt als Lesefehler mit.

### Gegenprobe auf dem Mac

Apple M4 Pro, 4 Threads, nur CPU, ScaDS-Seiten 004 bis 007 (andere Seiten als die Gegenprobe in [2026-10-lesefehler.md](2026-10-lesefehler.md)).

| Erkennung         | s/Seite (Mittel) | schnellste bis langsamste | Peak-RAM |
| ----------------- | ---------------- | ------------------------- | -------- |
| GLM-OCR           | 23,8             | 13,6 bis 31,7 s           | 2,7 GB   |
| LightOnOCR-3 0.8B | 8,2              | 5,2 bis 9,8 s             | 2,3 GB   |
| Qwen3.5 2B        | 28,3             | 17,3 bis 39,3 s           | 3,6 GB   |
| Qwen3-VL 4B       | 23,3             | 16,2 bis 29,1 s           | 6,4 GB   |
| LightOnOCR-3 4B   | 27,6             | 19,7 bis 39,6 s           | 6,6 GB   |

### Eingebaute Schülerfehler

Die 16 gerenderten Seiten der vier Schülertexte (172 eingebaute Fehler, vier Handschrift-Fonts). „Erhalten“ heißt: Er steht wörtlich so im Transkript, wie es geschrieben ist. „Verbessert“ heißt: Die Erkennung hat den Fehler selbst korrigiert, er ist für alles Weitere unsichtbar.

| Erkennung         | erhalten     | verbessert   | anders gelesen | davon verbessert: R / Z / G | Zeichenfehlerrate |
| ----------------- | ------------ | ------------ | -------------- | --------------------------- | ----------------- |
| GLM-OCR           | 91 % (85–94) | 0 % (0–2)    | 9 % (6–15)     | 0 / 0 / 0                   | 1,1 %             |
| LightOnOCR-3 0.8B | 81 % (75–87) | 16 % (12–23) | 2 % (1–6)      | 28 von 112 / 0 / 0          | 2,1 %             |
| Qwen3.5 2B        | 73 % (66–79) | 26 % (20–33) | 2 % (1–5)      | 44 von 112 / 0 / 0          | 0,5 %             |
| Qwen3-VL 4B       | 78 % (71–83) | 18 % (13–24) | 4 % (2–8)      | 31 von 112 / 0 / 0          | 0,4 %             |
| LightOnOCR-3 4B   | 70 % (63–76) | 28 % (22–35) | 2 % (1–6)      | 46 von 112 / 2 von 36 / 0   | 0,5 %             |

Zeichensetzungs- und Grammatikfehler bleiben fast immer erhalten (LightOnOCR-3 4B ergänzt zwei Kommas). Verbessert werden ausschließlich Rechtschreibfehler, also die häufigste Fehlerart in Schülertexten. Je besser ein Modell Sprache kann, desto mehr verbessert es: Die Modelle lesen „was dort stehen sollte“. GLM-OCR liest stattdessen Buchstaben, auch falsche.

### Fehlalarme, Hinweise und Recall bei der Schwelle nach Regel

Fehlalarme und Hinweise auf ScaDS (Prompt der App, Gemma 4 E2B ohne Denken), Recall auf den gerenderten Seiten. „Recall (erreichbar)“ zählt wie bisher nur die Fehler, die im Transkript noch stehen; „von allen 172“ rechnet die verbesserten und anders gelesenen Fehler als verloren.

| Erkennung         | Schwelle | Fehlalarme je 100 Wörter | Hinweise je 100 Wörter (ScaDS) | Hinweise je 100 Wörter (gerendert) | Recall rote Marken (erreichbar) | rote Marken von allen 172 | mit Hinweisen von allen 172 |
| ----------------- | -------- | ------------------------ | ------------------------------ | ---------------------------------- | ------------------------------- | ------------------------- | --------------------------- |
| GLM-OCR           | 0,95     | 1,33 (0,91–1,95)         | 10,0                           | 5,2                                | 61 % (53–69) von 155            | 55 %                      | 78 %                        |
| LightOnOCR-3 0.8B | 0,9      | 1,41 (0,96–2,05)         | 3,1                            | 2,3                                | 61 % (52–68) von 140            | 49 %                      | 68 %                        |
| Qwen3.5 2B        | 0,8      | 1,23 (0,82–1,84)         | 3,0                            | 1,3                                | 72 % (63–79) von 123            | 51 %                      | 64 %                        |
| LightOnOCR-3 4B   | 0,98     | 1,38 (0,95–2,01)         | 1,6                            | 2,6                                | 48 % (39–56) von 120            | 33 %                      | 58 %                        |
| Qwen3-VL 4B²      | 0,9      | 1,88 (1,34–2,63)         | 2,7                            | 1,5                                | 71 % (63–78) von 132            | 55 %                      | 65 %                        |
| Qwen3-VL 4B       | 0,98     | 1,31 (0,87–1,96)         | 3,3                            | 1,9                                | 66 % (57–73) von 132            | 51 %                      | 65 %                        |

² Schwelle aus der Registry; nach der Regel wären es 0,98 (Zeile darunter). ScaDS 19 Seiten, Erkennung aus [2026-10-lesefehler.md](2026-10-lesefehler.md), die gerenderten Seiten auf dem Mac erkannt.

Ohne Lesesicherheit setzt die Kette auf ScaDS mit LightOnOCR-3 0.8B 4,6 Fehlalarme je 100 Wörter (3,7 bis 5,6), mit Qwen3.5 2B 4,2 und mit LightOnOCR-3 4B 3,0, mit GLM-OCR 11,5. Bei LightOnOCR-3 4B ist der Rest fast nur noch der Korrektor (27 von 31 Fehlalarmen bei 0,95 auf richtig gelesenem Text), deshalb hilft dort keine Schwelle mehr viel.

### Schwellenkurven

Fehlalarme und Hinweise je 100 Wörter auf ScaDS, Recall der roten Marken auf den erreichbaren Fehlern der gerenderten Seiten.

| Schwelle | GLM-OCR: Fehlalarme / Hinweise / Recall | LightOnOCR-3 0.8B | Qwen3.5 2B       | LightOnOCR-3 4B  |
| -------- | --------------------------------------- | ----------------- | ---------------- | ---------------- |
| keine    | 11,3 / 0 / 86 %                         | 4,6 / 0 / 84 %    | 4,2 / 0 / 89 %   | 3,0 / 0 / 83 %   |
| 0,5      | 5,9 / 5,4 / 86 %                        | 2,6 / 1,9 / 83 %  | 2,5 / 1,7 / 86 % | 2,6 / 0,4 / 82 % |
| 0,7      | 3,3 / 8,0 / 75 %                        | 1,7 / 2,9 / 74 %  | 1,6 / 2,6 / 78 % | 2,2 / 0,9 / 76 % |
| 0,8      | 2,6 / 8,7 / 73 %                        | 1,6 / 3,0 / 68 %  | 1,2 / 3,0 / 72 % | 1,9 / 1,2 / 72 % |
| 0,9      | 1,9 / 9,4 / 66 %                        | 1,4 / 3,1 / 61 %  | 1,0 / 3,2 / 59 % | 1,6 / 1,4 / 66 % |
| 0,95     | 1,3 / 10,0 / 61 %                       | 0,9 / 3,6 / 51 %  | 0,8 / 3,4 / 50 % | 1,6 / 1,4 / 58 % |
| 0,98     | 0,9 / 10,5 / 54 %                       | 0,7 / 3,9 / 44 %  | 0,5 / 3,7 / 35 % | 1,4 / 1,6 / 48 % |
| 0,99     | 0,8 / 10,6 / 47 %                       | 0,5 / 4,1 / 36 %  | 0,4 / 3,8 / 25 % | 1,1 / 1,9 / 43 % |

Die Kurven bestätigen, dass die Schwelle zum Modell gehört: Bei gleicher Schwelle unterscheiden sich Fehlalarme und Recall deutlich. Die Hinweise sind bei den Kandidaten ab 0,7 fast konstant, weil ihre Lesefehler meist sehr unsicher sind (unter 0,5 liegen 40 bis 55 % aller Lesefehler).

### Kalibrierung

Wörter der 20 ScaDS-Seiten je Bereich der Lesesicherheit (Minimum der Token-Wahrscheinlichkeiten je Wort) und der Anteil davon, der falsch gelesen ist. Ein gut kalibriertes Modell liest von den Wörtern mit Sicherheit 0,9 etwa 10 % falsch. Der Kalibrierungsfehler ist das gewichtete Mittel des Abstands zwischen Sicherheit und Anteil richtig gelesener Wörter.

| Lesesicherheit      | GLM-OCR      | Qwen3-VL 4B  | LightOnOCR-3 0.8B | Qwen3.5 2B   | LightOnOCR-3 4B |
| ------------------- | ------------ | ------------ | ----------------- | ------------ | --------------- |
| unter 0,5           | 80 % von 242 | 82 % von 76  | 77 % von 167      | 66 % von 151 | 69 % von 74     |
| 0,5 bis 0,7         | 44 % von 192 | 55 % von 89  | 29 % von 134      | 36 % von 131 | 31 % von 78     |
| 0,7 bis 0,9         | 23 % von 236 | 31 % von 129 | 16 % von 180      | 14 % von 230 | 19 % von 95     |
| 0,9 bis 0,95        | 15 % von 129 | 11 % von 66  | 10 % von 115      | 7 % von 135  | 10 % von 73     |
| 0,95 bis 0,98       | 8 % von 165  | 14 % von 90  | 3 % von 148       | 4 % von 195  | 7 % von 108     |
| 0,98 bis 0,99       | 5 % von 115  | 4 % von 67   | 2 % von 127       | 1 % von 164  | 3 % von 123     |
| ab 0,99             | 3 % von 877  | 3 % von 1327 | 2 % von 965       | 1 % von 838  | 1 % von 1386    |
| AUC                 | 0,890        | 0,901        | 0,912             | 0,914        | 0,917           |
| Kalibrierungsfehler | 0,050        | 0,048        | 0,028             | 0,014        | 0,016           |
| Lesefehler ab 0,99  | 7 %          | 16 %         | 8 %               | 3 %          | 13 %            |

GLM-OCR schätzt sich in fast jedem Bereich zu sicher ein (unter 0,5: Mittlere Sicherheit 0,33, aber nur 20 % richtig gelesen; 0,7 bis 0,9: Sicherheit 0,81 gegenüber 77 %) und hat einen festen Rest an sicheren Fehlern. Die Kandidaten sind im mittleren Bereich eher zu vorsichtig (LightOnOCR-3 0.8B bei 0,5 bis 0,7: Sicherheit 0,60, aber 71 % richtig). Die Lesesicherheit trennt bei allen Modellen ähnlich gut (AUC 0,89 bis 0,92). Für die Schwelle heißt das: Sie lässt sich nicht von einem Modell aufs andere übertragen, und bei Qwen3-VL und LightOnOCR-3 4B liegt rund ein Fünftel der Lesefehler über 0,95, ist also mit keiner sinnvollen Schwelle zu fangen.

## Recherche

Gesucht wurden kleine offene Vision- und OCR-Modelle mit GGUF für llama.cpp `b11537` (9. Oktober 2026), die Handschrift lesen. Deutsche Handschrift misst kein öffentlicher Vergleich mit kleinen Modellen; die ScaDS-Studie selbst testet nur Modelle ab 8B. Als Anhaltspunkt dienten [WildHandBench](https://arxiv.org/abs/2608.22959) (August 2026, Chinesisch und Englisch, normalisierte Editierdistanz, kleiner ist besser) und der [socOCRbench](https://noahdasanaike.github.io/posts/sococrbench.html) (Handschrift aus mehreren Weltregionen, NES, größer ist besser).

| Modell                        | Größe     | Lizenz                          | GGUF, läuft mit b11537   | Hinweise auf Handschrift                                   | Entscheidung                                                                                                                                    |
| ----------------------------- | --------- | ------------------------------- | ------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| LightOnOCR-3 0.8B (Okt. 2026) | 0,8B      | Apache-2.0                      | ja (Qwen3.5-Architektur) | Hersteller: Größter Zugewinn bei Handschrift (Französisch) | gemessen                                                                                                                                        |
| LightOnOCR-3 4B (Okt. 2026)   | 4B        | Apache-2.0                      | ja                       | wie oben, bestes Modell der Familie                        | gemessen, 16-GB-Option                                                                                                                          |
| Qwen3.5 2B (Feb. 2026)        | 2B        | Apache-2.0                      | ja                       | socOCRbench 0,43 (GLM-OCR 0,38)                            | gemessen                                                                                                                                        |
| Qwen3.5 0.8B / 4B             | 0,8B / 4B | Apache-2.0                      | ja                       | 0,34 / 0,45                                                | 0.8B schlechter als GLM-OCR; statt 4B das OCR-Training darauf (LightOnOCR-3 4B)                                                                 |
| PaddleOCR-VL 1.6 (Mai 2026)   | 0,9B      | Apache-2.0                      | ja                       | WildHandBench 41,5 (GLM-OCR 54,2), socOCRbench 0,40        | nicht erneut: In llama.cpp laut ggml-org „möglicherweise schlechter“, bei uns 324 s je Seite ([2026-10-handschrift.md](2026-10-handschrift.md)) |
| HunyuanOCR                    | 1B        | Tencent Hunyuan Community       | ja                       | WildHandBench bestes kleines Modell (38,5)                 | ausgeschlossen: Lizenz gilt nicht in der EU                                                                                                     |
| dots.ocr / dots.mocr          | 3B        | MIT                             | ja                       | socOCRbench 0,47                                           | ausgeschlossen: 6 GB, Schleifen ([2026-10-handschrift.md](2026-10-handschrift.md))                                                              |
| Qianfan-OCR                   | 4,7B      | Apache-2.0                      | ja                       | WildHandBench 50,4                                         | zu groß für 8 GB, für 16 GB nicht besser belegt als die 4B-Kandidaten                                                                           |
| FireRed-OCR                   | 2B        | Apache-2.0                      | ja (Community-GGUF)      | WildHandBench 49,0, socOCRbench 0,34                       | auf Handschrift nicht besser als GLM-OCR                                                                                                        |
| DeepSeek-OCR / -OCR 2         | 3B (MoE)  | Apache-2.0                      | ja                       | socOCRbench 0,09 / 0,17                                    | auf Handschrift schwach                                                                                                                         |
| MinerU2.5                     | 1,2B      | AGPL-3.0                        | unklar                   | socOCRbench 0,19                                           | auf Handschrift schwach                                                                                                                         |
| LFM2.5-VL 450M                | 0,45B     | LFM Open License (Umsatzgrenze) | ja                       | keine                                                      | Lizenz mit Nutzungsgrenzen                                                                                                                      |
| MiniCPM-V 4.7 1B              | 1B        | unklar                          | ja                       | Testbericht: Scheitert an Handschrift                      | nicht weiter verfolgt                                                                                                                           |
| olmOCR 2, Chandra             | 7–9B      | Apache-2.0 / OpenRAIL           | teils                    |                                                            | zu groß                                                                                                                                         |

Alle drei gemessenen Kandidaten sind Apache-2.0 und dürfen von einer GPL-3.0-App heruntergeladen und benutzt werden. Die GGUF-Dateien kommen von Community-Konvertierungen (mradermacher für LightOnOCR-3, unsloth für Qwen3.5), auf einen Commit gepinnt und per SHA256 geprüft (`eval/ocr-candidates.json`). Für LightOnOCR-3 0.8B gibt es auch eine Konvertierung von einem der Autoren (`staghado/LightOnOCR-3-0.8B-GGUF`, nur Q4_K_M).

## Eigene Handschrift für die Schwelle

Die gerenderten Fonts sind für alle Modelle zu leicht, ScaDS ist Erwachsenenschrift mit Fachtext. Was fehlt, ist Schülerschrift mit bekannten Fehlern. Simon schreibt dafür selbst, keine Arbeiten von Schülerinnen und Schülern.

**Umfang: 16 Seiten, je rund 200 Wörter.** Das ergibt rund 1600 fehlerfreie Wörter (Intervall der Fehlalarme etwa ±0,5 je 100 Wörter, wie auf ScaDS) und rund 120 eingebaute Fehler (Intervall des Recalls etwa ±8 Prozentpunkte).

- **4 Texte** in Schülerthemen, je einer: Brief, Erlebniserzählung, Inhaltsangabe oder Erörterung, Sachtext (Bio oder Geschichte). Die vier vorhandenen Texte unter `eval/samples/texts/` dürfen es sein, besser sind neue.
- **Jeder Text in 2 Fassungen:** einmal fehlerfrei, einmal mit rund 15 eingebauten Fehlern. Mischung wie in echten Arbeiten: Etwa 9 Rechtschreibung (das/dass, Groß- und Kleinschreibung, Dehnung und Schärfung wie „nähmlich“, „vieleicht“, Getrennt- und Zusammenschreibung), 4 Zeichensetzung (fehlendes Komma vor Nebensatz und „dass“, wörtliche Rede), 2 Grammatik (Fall, Kongruenz, Verbform). Darunter einige, die ein Sprachmodell gern verbessert, etwa „Schockolade“, „sinvoll“, „hälfte“, denn genau die verschwinden bei den neuen Modellen.
- **Jede Fassung in 2 Schriften:** einmal sorgfältig, einmal schnell wie unter Zeitdruck in einer Klassenarbeit, mit zwei, drei Durchstreichungen und einem nachträglich eingefügten Wort.
- **Papier und Aufnahme:** Liniertes oder kariertes Schulpapier, Füller oder Kugelschreiber, 12 Seiten mit dem Handy fotografiert (Tageslicht, leicht schräg ist gut), 4 eingescannt.
- **Ablage:** `~/Rotstift-Testdaten/eigene-schrift/`, je Seite ein Bild und eine gleichnamige `.txt`, etwa `brief-fehler-schnell.jpg` und `brief-fehler-schnell.txt`. In der `.txt` steht der Text Wort für Wort, wie er auf dem Papier steht, eingebaute Fehler als `{geschrieben|richtig|Art}` (Art `R`, `Z` oder `G`), Durchgestrichenes nicht. Die fehlerfreien Fassungen haben keine Marke. Zeilenumbrüche müssen nicht stimmen.
- **Besser noch** sind zusätzlich Seiten von zwei, drei anderen Erwachsenen, damit nicht nur eine Hand gemessen wird.

Dann läuft die ganze Prüfung mit einem Befehl, für GLM-OCR und zum Vergleich LightOnOCR-3 0.8B (vorher `node eval/download-models.ts --models lightonocr-3-0.8b-q8`):

```bash
node --experimental-transform-types eval/ocr-threshold.ts --scans ~/Rotstift-Testdaten/eigene-schrift --models glm-ocr-q8,lightonocr-3-0.8b-q8
```

Der Bericht landet in `~/.cache/rotstift/eval/eigene-schrift/bericht.md`: Lesefehler, Kalibrierung, je Schwelle Recall der roten Marken, Recall mit Hinweisen, Hinweise und Fehlalarme je 100 Wörter, dazu die Schwelle nach der Regel neben dem Wert aus der Registry. Weicht die Schwelle nach Regel um mehr als eine Stufe von 0,95 ab, gehört der neue Wert in `src-tauri/models.json`. Dauer auf simon-pc: Höchstens 1 min je Seite und Modell.

## Methode

- **Daten:** 20 Seiten (000 bis 019) aus dem [ScaDS.AI German Handwriting Full-Page Dataset](https://doi.org/10.5281/zenodo.18283705) (Thomas Burghardt, Till Nestler, CC BY 4.0) für Lesefehler und Fehlalarme, die 16 gerenderten Seiten der vier selbst geschriebenen Schülertexte (172 eingebaute Fehler) für Recall und erhaltene Fehler, wie in [2026-10-lesefehler.md](2026-10-lesefehler.md).
- **Erkennung:** `eval/ocr-run.ts` mit den Einträgen aus `src-tauri/models.json` und `eval/ocr-candidates.json`, Bild vor dem Prompt in einer Nachricht wie `visionMessage`, Temperatur 0, höchstens 2048 Token, `logprobs: true`. LightOnOCR-3 mit leerem Prompt (Transkriptionsmodus laut Modellkarte), Qwen3.5 mit dem Transkriptionsauftrag von Qwen3-VL. Alle Kandidaten mit `--reasoning off`, Kontext 8192, Bilder auf 1536 px lange Kante verkleinert (`eval/resize-pages.py`).
- **Korrektur und Bewertung:** Unverändert wie in [2026-10-lesefehler.md](2026-10-lesefehler.md) (Gemma 4 E2B Q4_0, Prompt der App, ohne Denken, `eval/ocr-correct.ts` und `eval/ocr-score.ts`). Die Erkennungsläufe für GLM-OCR und Qwen3-VL 4B auf ScaDS und für GLM-OCR auf den gerenderten Seiten stammen aus jener Auswertung, der GLM-OCR-Lauf wurde für Zeit und Fehlalarme wiederholt (11,5 statt 11,3 Fehlalarme je 100 Wörter, gleiche Lesefehler).
- **Erhaltene Fehler:** `classifyErrors` aus `eval/metrics.ts` vergleicht jede eingebaute Fehlerstelle mit dem Transkript: Wörtlich geschrieben (erhalten), wörtlich korrigiert (verbessert) oder anders.
- **Kalibrierung:** `eval/ocr-calibration.ts`, Wörter wie in `ocr-word-measures.ts` (Minimum der Token-Wahrscheinlichkeiten, falsch gelesen laut Wort-Ausrichtung gegen die Ground Truth).
- **Schwelle:** `chooseThreshold` auf der Kurve von ScaDS, Stufen 0,5 bis 0,99.
- **Intervalle:** Wilson, 95 %, Marken und Wörter als unabhängig behandelt, also eher zu eng.
- **Rechner:** simon-pc (Ryzen 7 5700X, 8 Threads, `--n-gpu-layers 0 --device none`, llama.cpp `b11537`), ohne nennenswerte Nebenlast. Die Recall-Korrekturen der gerenderten Seiten und zwei ScaDS-Korrekturen (LightOnOCR-3 4B, GLM-OCR) liefen mit denselben Einstellungen auf dem Mac (M4 Pro, 4 Threads), Zeiten auf dem Mac nur als Gegenprobe.

## Grenzen

- **Keine echte Schülerhandschrift.** Ob die neuen Modelle auf schwer lesbarer Kinderschrift noch mehr Fehler verbessern oder weniger, ist offen. Die Fonts sind leicht zu lesen, auf ihnen fällt das Verbessern eher stärker auf als auf ScaDS, wo die Modelle mit dem Lesen beschäftigt sind.
- **Eine Antwort je Seite**, Temperatur 0. LightOnOCR-3 ist laut Modellkarte mit Temperatur 0,2 gedacht, die App liest aber deterministisch. Ob Sampling die Schleifen vermeidet, ist nicht gemessen.
- **Nur eine Quantisierung je Modell.** LightOnOCR-3 4B und Qwen3.5 2B in Q4_K_M; Q8_0 läse vielleicht etwas besser, wäre aber noch größer.
- **Recall über alle 172 Fehler** ist aus Recall (erreichbar) mal Anteil erreichbarer Fehler gerechnet, verbesserte und anders gelesene Fehler zählen als verloren, auch wenn ein Teil davon als Lesefolgefehler wieder eine Marke bekäme.
- **Schwelle nur auf ScaDS.** Die Fehlalarme kommen aus Fachtext mit vielen Fremdwörtern, auf denen auch der Korrektor danebenliegt.

Reproduzieren: Siehe [eval/README.md](../../eval/README.md#lesefehler-der-texterkennung). Datensatzbilder, Transkripte und Modellausgaben bleiben außerhalb des Repos.
