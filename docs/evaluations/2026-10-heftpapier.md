# Evaluation: Heftpapier und Handyfotos (Oktober 2026)

Frage: Wie gut kommt Rotstift mit echten Schulheften zurecht, also mit linierten und karierten Seiten, Rand, Spiralbindung und Fotos vom Handy? Bisher wurden Erkennung, Zeilenzuordnung ([ADR 0004](../adr/0004-zeilenpositionen.md)) und Strichsuche ([Durchgestrichenes](2026-10-durchgestrichen.md)) auf weißem Papier und auf ScaDS-Scans gemessen. Dieser Bericht beschafft Testdaten, baut einen Renderer für Heftpapier und misst, was an der Pipeline bricht. Phase 1 ändert an der App nichts. Was Phase 2 an der Zeilenzuordnung geändert hat, steht unter [Phase 2: Heftlinien](#phase-2-heftlinien).

## Ergebnis

**Auf Scans funktioniert die Pipeline auf Heftpapier, auf Handyfotos bricht die Zeilenzuordnung zusammen.** Auf den sechs gerenderten Heftpapieren trifft `locateLines` als Scan 88–100 % der Zeilen (IoU ≥ 0,5), als Foto 0–6 %. Dabei sind 39–94 % der Zeilen „sicher falsch“ (IoU < 0,2), die Zuordnung meldet also keine Mehrdeutigkeit, sondern liefert falsche Boxen. Folge: Auf Fotos liegen 0–7 % der Striche auf der richtigen Zeile (Scans 96–100 %), und bei der Kariert-Aufnahme bleiben 48 % der Marken ganz ohne Box. Die Erkennung selbst ist von Papier und Aufnahme kaum betroffen (WER 2–8 % auf gerenderten Heftseiten).

**Die Ursache ist die Perspektive.** Mit idealen Transkripten (die Wahrheitszeilen als Erkennung, damit die Erkennung nichts verfälscht) fällt die Trefferquote bei 12 Fotoseiten von 98 % (Fotoeffekte aus) auf 71 % allein durch Drehung, auf 25 % allein durch Trapezverzerrung (Keystone), auf 51 % durch Wölbung und auf 73 % durch Ringbindung. Licht, Rauschen und die Tischfläche drumherum kosten dagegen kaum etwas (97 %), Schatten 5 Punkte, Unschärfe 8 Punkte.

**Die Strichsuche kollabiert auf Heftpapier, aber nicht durch Fehlalarme.** Auf dem sauberen Scan mit Linien und Rand findet sie 69 % der gestrichenen Wörter (Ausgangswert 65,7 %). Auf Linien bis zum Blattrand (`liniert-eng`) sind es 13 %, auf Karos 25 % bei 7 Fehlalarmen (Precision 36 %), auf Fotos 0–13 %. Mit echter Erkennung und den Fotos zusammen sinkt der Recall unter den abgeschriebenen Wörtern auf 5,6 % (1 von 24 gestrichenen Wörtern), bei einem Fehlalarm. Auf den Seiten ohne Striche gab es mit echter Erkennung keinen einzigen Fehlalarm (0 von 1434 Wörtern); mit idealen Transkripten 1 von 3066.

**`locateLines` stürzt auf einer Kariert-Aufnahme ab.** Auf `brief--kariert-photo` wirft es eine `RangeError` (`index 0 is out of range`). Mit idealen Transkripten stürzt eine Kariert-Foto-Seite ab, in der Ablation sind es zwei Seiten mit Trapezverzerrung.

**Die Randzeichen landen auch auf einem sauberen Scan oft falsch.** Bei `liniert-scan` mit gezeichnetem Rand und fehlerfreier Zeilenzuordnung (100 %) stehen nur 35 % der Randzeichen im Heftrand, 45 % stehen über dem Text. `layoutOverlay` wählt die Randspalte aus den erkannten Textausdehnungen, nicht aus dem Rand des Heftes. Auf Fotos sind die Werte wegen der falschen Boxen nicht aussagekräftig.

**Die Lesesicherheit ist auf Handyfotos unbrauchbar.** Auf den GNHK-Fotos (Englisch, Notizen) liegt die AUC bei 0,71 und der Kalibrierungsfehler bei 0,18. 17 % der Wörter mit Sicherheit ≥ 0,99 sind falsch, sie machen 57 % aller Fehler aus. Auf gerenderten Seiten (AUC 0,98) und auf ScaDS (0,90) trägt sie.

**Kleine Scans werden nicht hochskaliert.** `fitWithin` verkleinert Bilder auf die Zielkante, vergrößert sie aber nie. Die BRESSAY-Seiten (Portugiesisch, rund 550 px breit) laufen so in Wiederholungsschleifen bis zum Tokenlimit (WER 237 %). Auf 1152 px vergrößert endet die Erkennung bei fünf von sechs Seiten normal, die WER sinkt auf 63 %. Das ist eine kleine Stichprobe in einer anderen Sprache, zeigt aber ein Risiko für Scans mit niedriger Auflösung.

## Quellen

Zusammen belegen die Daten unter `~/.cache/rotstift/datasets/` 7,5 GB (davon 6,9 GB heruntergeladene Archive in `_raw/`), das Limit von 10 GB wird eingehalten. Eingecheckt wird nichts davon, nur die Skripte. `eval/datasets.py` lädt und bereitet jede Quelle in einem eigenen Ordner vor und führt nichts aus dem Heruntergeladenen aus.

| Quelle                                                                | Inhalt                                                                      | Umfang                                                                  | Sprache       | Papier                                   | Aufnahme      | Transkript                                                  | Bezug                                                                      |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------- | ---------------------------------------- | ------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| ScaDS.AI German Full-Page (bereits genutzt)                           | Wikipedia-Auszüge, Erwachsenenschrift                                       | 77 Seiten                                                               | Deutsch       | kein Heftpapier                          | Scan          | ja, Klartext                                                | Zenodo, CC BY 4.0                                                          |
| GNHK (Hugging Face-Spiegel `aryaman27/goodnotes-handwritten-dataset`) | Notizen, Briefe, Listen                                                     | 687 Seiten, davon 61 mit Heftlinien (`gnhk-liniert`)                    | Englisch      | teils liniert, teils kariert, teils weiß | Handyfoto     | ja, Wortboxen mit Zeilenindex, daraus Zeilen                | Hugging Face, feste Revision; Lizenz nicht geprüft                         |
| Russische Schulaufsätze (Mendeley Data)                               | handgeschriebene Aufsätze von Schülern                                      | 19 einseitige Aufsätze (Archiv 149 MB)                                  | Russisch      | Linienpapier                             | Scan          | ja                                                          | Mendeley Data; Lizenz nicht geprüft                                        |
| BRESSAY (Zenodo)                                                      | Aufsatzseiten mit durchgestrichenen Wörtern                                 | 1000 Seiten, 1,5 GB                                                     | Portugiesisch | Linienpapier, Seiten rund 550 px breit   | Scan          | ja, Streichungen als `--Wort--` markiert, daraus `~~Wort~~` | Zenodo, Lizenz nicht geprüft                                               |
| Litkey-Korpus                                                         | Texte von Schülern der Klassen 2 bis 8 mit Fehlerannotation                 | –                                                                       | Deutsch       | –                                        | –             | nur Text, keine Bilder                                      | Server nicht erreichbar, nicht geladen                                     |
| Leere Heftseiten (Lineatur 27/28, kariert 5 mm)                       | Hintergrund für den Renderer                                                | –                                                                       | –             | echt                                     | –             | –                                                           | keine Quelle aufgenommen; `render.py --paper-image` nimmt eigene Aufnahmen |
| Kandidaten auf Hugging Face (`language:de`, Stichwort `handwriting`)  | u. a. `fhswf/german_handwriting` (AFL-3.0), `finnbusse/handwriting-*` (MIT) | 44 bis 258 Downloads, Größe nicht geprüft                               | Deutsch       | nicht geprüft                            | nicht geprüft | nicht geprüft                                               | nicht geladen                                                              |
| Gerenderte Seiten (`render.py --heft`)                                | Texte aus `eval/samples/texts` auf Heftpapier                               | 24 Seiten (4 Texte, 3 Papiere, Scan und Foto), dazu 24 mit Streichungen | Deutsch       | gezeichnet                               | Scan und Foto | ja, mit Wahrheitsboxen je Zeile                             | selbst erzeugt, darf eingecheckt werden                                    |

Gefunden wurde keine deutsche Quelle mit Bildern echter Schülerhefte und Transkript. Litkey hat die richtige Zielgruppe, aber nur Text (CC BY-SA 4.0), der Server war nicht erreichbar, das Internet Archive war offline. Kaggle und Wikimedia Commons wurden nicht ausgewertet, die Hugging-Face-Kandidaten oben auch nicht. Für Deutsch bleibt der Renderer, für echte Fotos GNHK (englisch, Notizen statt Schulheft) als Stellvertreter für Perspektive, Schatten und Linien.

## Methode

- **Renderer (`eval/samples/render.py --heft`):** Zeichnet drei Papiere (`liniert` 8 mm mit Rand beidseitig, `liniert-eng` 7 mm mit Linien bis zum Blattrand, `kariert` 5 mm mit Rand), Linienfarbe blau oder grau, Stift blau, schwarz oder Bleistift. Als Scan mit leichter Drehung und Randschatten, als Foto mit Perspektive (Drehung und Trapezverzerrung), Wölbung, Licht und Schatten, Unschärfe, Rauschen, JPEG und Tisch um die Seite, dazu Spiralbindung oder Lochrand. Die Wahrheitsboxen der Zeilen laufen durch dieselben Verzerrungen wie das Bild. Reihenfolge und Zufallswerte sind über `--seed` reproduzierbar, `--effects` schaltet einzelne Effekte ein oder aus.
- **Messung (`eval/heft-measure.ts`):** Pro Seite WER und CER (gestrichene Wörter der Wahrheit zählen nicht mit), `locateLines` wie in der App mit Treffer (IoU ≥ 0,5 gegen die Wahrheitsbox), „sicher falsch“ (IoU < 0,2) und Absturz, Fehlalarme der Strichsuche je 100 Wörter. Mit `--marks` korrigiert Gemma 4 E2B, `layoutOverlay` legt die Marken auf die Seite, und das Skript prüft die Zeile jeder Marke, die Striche auf der Zeile und die Randzeichen (im Heftrand, über Text).
- **Ideale Transkripte:** Die Wahrheitszeilen dienen als Erkennung. So misst man Zeilenzuordnung und Strichsuche, ohne dass Lesefehler die Zahlen verfälschen. Die Ablation schaltet Fotoeffekte einzeln ein und aus (`render.py --effects`).
- **Erkennung:** GLM-OCR Q8 wie in der App, Bilder auf 1152 px, 6 Threads. Gemma 4 E2B Q4 für die Marken.

## Messergebnisse

Die Maschine war durch eine parallel laufende Praxisprobe belastet. Die Zeiten sind daher unbrauchbar, die Qualitätszahlen nicht betroffen. Die Stichproben sind klein (2 bis 12 Seiten je Zeile), die Zahlen zeigen Größenordnungen, keine Prozentpunkte.

### Gerenderte Heftseiten mit echter Erkennung

Zwei Texte (`brief`, `ferien`) auf sechs Papier-Aufnahme-Kombinationen, 12 Seiten, 1434 Wörter.

| Papier und Aufnahme | Seiten         | WER   | Zeilen mit Box | Box trifft | Box sicher falsch | Alarme je 100 Wörter | Markenzeile richtig | Striche auf der Zeile | Randzeichen im Rand | Randzeichen über Text |
| ------------------- | -------------- | ----- | -------------- | ---------- | ----------------- | -------------------- | ------------------- | --------------------- | ------------------- | --------------------- |
| kariert, Foto       | 2 (1 Absturz)  | 3,8 % | 44,4 %         | 5,6 %      | 38,9 %            | 0,00                 | 0,0 %               | 0,0 %                 | 100,0 %             | 0,0 %                 |
| kariert, Scan       | 2              | 2,1 % | 100,0 %        | 88,2 %     | 0,0 %             | 0,00                 | 93,8 %              | 95,7 %                | 68,8 %              | 0,0 %                 |
| liniert-eng, Foto   | 2              | 3,8 % | 100,0 %        | 3,4 %      | 93,1 %            | 0,00                 | 5,3 %               | 3,8 %                 | 94,7 %              | 0,0 %                 |
| liniert-eng, Scan   | 2              | 4,6 % | 100,0 %        | 100,0 %    | 0,0 %             | 0,00                 | 100,0 %             | 100,0 %               | 0,0 %               | 0,0 %                 |
| liniert, Foto       | 2              | 4,2 % | 100,0 %        | 0,0 %      | 93,5 %            | 0,00                 | 0,0 %               | 6,7 %                 | 80,0 %              | 0,0 %                 |
| liniert, Scan       | 2              | 8,4 % | 100,0 %        | 100,0 %    | 0,0 %             | 0,00                 | 100,0 %             | 100,0 %               | 35,0 %              | 45,0 %                |
| alle                | 12 (1 Absturz) | 4,5 % | 89,5 %         | 48,9 %     | 36,8 %            | 0,00                 | 57,5 %              | 61,7 %                | 59,8 %              | 10,3 %                |

Der Randzeichen-Wert gilt nur für Papiere mit gezeichnetem Rand. Bei `liniert-eng` gibt es keinen, die 0,0 % sind dort nicht zu lesen. Auf Fotos stehen die Randzeichen bei falschen Boxen irgendwo, die hohen Werte dort sagen nichts.

### Vergleich mit ScaDS und den früher gerenderten Seiten

| Satz                                           | Seiten | Wörter | WER    | CER   | Zeilen mit Box | Box trifft | Marken je 100 Wörter | Markenzeile richtig | Striche auf der Zeile |
| ---------------------------------------------- | ------ | ------ | ------ | ----- | -------------- | ---------- | -------------------- | ------------------- | --------------------- |
| ScaDS-Scans                                    | 6      | 603    | 20,9 % | 6,2 % | 100,0 %        | –          | 11,9                 | –                   | –                     |
| Früher gerenderte Seiten (`samples/`, liniert) | 4      | 478    | 0,6 %  | 0,1 % | 100,0 %        | 100,0 %    | 9,0                  | 100,0 %             | 100,0 %               |
| Heftpapier, alle (Scans und Fotos)             | 12     | 1434   | 4,5 %  | 1,0 % | 89,5 %         | 48,9 %     | 10,0                 | 57,5 %              | 61,7 %                |

ScaDS hat keine Wahrheitsboxen, die Spalten „Box trifft“, „Markenzeile richtig“ und „Striche auf der Zeile“ sind dort leer. Die ScaDS-Seiten sind die ersten sechs (`000`, `013`, …, `065`) der 77.

### Zeilenzuordnung mit idealen Transkripten

24 Seiten, 3066 Wörter. Die Erkennung ist hier die Wahrheit, WER 0 %.

| Papier und Aufnahme | Seiten         | Zeilen mit Box | Box trifft | Box sicher falsch | Alarme je 100 Wörter |
| ------------------- | -------------- | -------------- | ---------- | ----------------- | -------------------- |
| kariert, Foto       | 4 (1 Absturz)  | 73,3 %         | 2,7 %      | 68,0 %            | 0,00                 |
| kariert, Scan       | 4              | 100,0 %        | 64,9 %     | 29,9 %            | 0,00                 |
| liniert-eng, Foto   | 4              | 100,0 %        | 1,8 %      | 94,5 %            | 0,00                 |
| liniert-eng, Scan   | 4              | 100,0 %        | 100,0 %    | 0,0 %             | 0,20                 |
| liniert, Foto       | 4              | 100,0 %        | 49,2 %     | 44,6 %            | 0,00                 |
| liniert, Scan       | 4              | 100,0 %        | 100,0 %    | 0,0 %             | 0,00                 |
| alle                | 24 (1 Absturz) | 94,9 %         | 52,3 %     | 39,5 %            | 0,03                 |

Karo-Scans sind schwächer als Linien-Scans (65 % Treffer, 30 % sicher falsch). Vermutlich folgt die Linienerkennung dem Karoraster statt den Textzeilen, denn geschrieben wird auf jeder zweiten Karozeile; geprüft ist das nicht.

### Ablation der Fotoeffekte

Nur die Seiten im Foto-Modus, 12 Seiten (3 Papiere, 4 Texte), ideale Transkripte. Die Namen sind die Effekte von `render.py --effects`: `rotation` (Drehung in der Ebene), `keystone` (Trapezverzerrung), `bend` (Wölbung), `binding` (Spiralbindung oder Lochrand), `spine` (Schatten am Falz), `table` (Tisch um die Seite).

| Aktive Effekte                | Zeilen mit Box | Box trifft | Box sicher falsch | Abstürze |
| ----------------------------- | -------------- | ---------- | ----------------- | -------- |
| keine                         | 100,0 %        | 97,9 %     | 0,0 %             | 0        |
| nur Drehung                   | 100,0 %        | 70,8 %     | 22,1 %            | 0        |
| nur Keystone                  | 81,0 %         | 24,6 %     | 53,3 %            | 2        |
| Drehung und Keystone          | 100,0 %        | 30,3 %     | 62,6 %            | 0        |
| nur Wölbung                   | 100,0 %        | 51,3 %     | 45,6 %            | 0        |
| nur Bindung                   | 100,0 %        | 72,8 %     | 24,6 %            | 0        |
| nur Falzschatten (`spine`)    | 100,0 %        | 97,9 %     | 0,0 %             | 0        |
| nur Schatten                  | 100,0 %        | 93,3 %     | 4,6 %             | 0        |
| nur Licht                     | 100,0 %        | 97,4 %     | 0,0 %             | 0        |
| nur Unschärfe                 | 100,0 %        | 89,7 %     | 9,2 %             | 0        |
| nur Rauschen                  | 100,0 %        | 97,4 %     | 0,5 %             | 0        |
| nur Tisch um die Seite        | 100,0 %        | 97,4 %     | 0,5 %             | 0        |
| Wölbung und Bindung           | 100,0 %        | 49,7 %     | 47,7 %            | 0        |
| Drehung, Keystone und Wölbung | 100,0 %        | 34,9 %     | 61,5 %            | 0        |
| alle                          | 100,0 %        | 31,3 %     | 62,6 %            | 0        |
| alle ohne Keystone            | 89,7 %         | 32,3 %     | 55,4 %            | 1        |
| alle ohne Wölbung             | 81,5 %         | 20,0 %     | 59,0 %            | 2        |
| alle ohne Bindung             | 100,0 %        | 35,4 %     | 59,5 %            | 0        |
| alle ohne Drehung             | 100,0 %        | 25,6 %     | 67,7 %            | 0        |

Kein einzelner Effekt erklärt alles. Jeder der geometrischen Effekte (Drehung, Keystone, Wölbung, Bindung) senkt die Trefferquote einzeln auf 25–73 %, das Entfernen eines einzelnen aus der Summe hilft kaum (20–35 %). Die Pipeline verkraftet Bildrauschen, Licht und Tisch, aber keine verzerrte Geometrie. Die Drehung allein kostet 27 Punkte, obwohl `locateLines` bis ±6° ausgleichen soll; ob die gerenderten Drehungen darüber liegen, ist nicht geprüft.

### Strichsuche auf Heftpapier

Gerenderte Seiten mit vier eingefügten gestrichenen Wörtern je Seite (`--strike 4`), Tintenverfahren.

| Satz                          | Gestrichen | erkannt | Recall (abgeschrieben) | Fehlalarme | Precision |
| ----------------------------- | ---------- | ------- | ---------------------- | ---------- | --------- |
| Echte Erkennung, 6 Fotoseiten | 24         | 1       | 5,6 %                  | 1 (0,1 %)  | 50 %      |
| Ideale Transkripte, 24 Seiten | 96         | 20      | 20,8 %                 | 11 (0,4 %) | 64,5 %    |
| … liniert, Scan               | 16         | 11      | 68,8 %                 | 1          | 91,7 %    |
| … liniert-eng, Scan           | 16         | 2       | 12,5 %                 | 1          | 66,7 %    |
| … kariert, Scan               | 16         | 4       | 25,0 %                 | 7          | 36,4 %    |
| … liniert, Foto               | 16         | 1       | 6,3 %                  | 1          | 50,0 %    |
| … liniert-eng, Foto           | 16         | 2       | 12,5 %                 | 1          | 66,7 %    |
| … kariert, Foto               | 16         | 0       | 0,0 %                  | 0          | –         |

Die Ausgangsmessung auf Linienpapier (65,7 % Recall, 93,5 % Precision) wird nur von `liniert` als Scan gehalten. Vermutlich stören durchlaufende Heftlinien (bei `liniert-eng`) und Karolinien die Suche nach langen, waagerechten Strichen; die Ursache wurde nicht einzeln geprüft.

### Fremde Sätze und Lesesicherheit

| Satz                              | Seiten        | Wörter | WER     | CER     | Alarme je 100 Wörter | AUC   | Kalibrierungsfehler | Falsch bei Sicherheit ≥ 0,99 |
| --------------------------------- | ------------- | ------ | ------- | ------- | -------------------- | ----- | ------------------- | ---------------------------- |
| Gerenderte Heftseiten             | 12            | 1434   | 4,5 %   | 1,0 %   | 0,00                 | 0,976 | 0,010               | 0 % (0–0)                    |
| Früher gerenderte Seiten          | 4             | 478    | 0,6 %   | 0,1 %   | 0,00                 | 0,986 | 0,015               | 0 % (0–1)                    |
| ScaDS                             | 6             | 603    | 20,9 %  | 6,2 %   | 0,00                 | 0,895 | 0,054               | 3 % (2–6)                    |
| GNHK liniert (Englisch, Foto)     | 8 (1 Absturz) | 564    | 30,9 %  | 19,3 %  | 0,00                 | 0,709 | 0,177               | 17 % (13–21)                 |
| Russische Aufsätze (Scan)         | 7             | 1119   | 74,9 %  | 57,0 %  | 0,54                 | 0,824 | 0,131               | 3 % (1–10)                   |
| BRESSAY, Originalgröße            | 6             | 2531   | 237,1 % | 174,9 % | 0,00                 | –     | –                   | –                            |
| BRESSAY, auf 1152 px hochskaliert | 6             | 2531   | 62,8 %  | 38,7 %  | 0,63                 | 0,863 | 0,106               | 5 % (3–7)                    |

Die russischen und portugiesischen Daten sagen nichts über die deutsche Lesegenauigkeit, nur über das Verhalten bei Papier und Auflösung. GLM-OCR liest Kyrillisch schlecht (65 % der Wörter unter Sicherheit 0,5).

## Fehlerursachen nach Wirkung

Sortiert nach dem Schaden für den Nutzer, nicht nach dem Aufwand.

1. **Die Zeilenzuordnung kennt keine Perspektive.** Auf Fotos 0–6 % Treffer, 39–94 % „sicher falsch“, damit liegen alle Striche und Marken auf der falschen Zeile oder fehlen (Wirkung: nahezu die ganze Fotokorrektur). Nach der Ablation tragen Drehung, Trapezverzerrung, Wölbung und Ringbindung jeweils einzeln schon 25–73 % Verlust, zusammen 31 %.
   Lösungsvorschlag: Vor der Zeilensuche das Blatt begradigen (Seitenkanten oder Heftlinien finden, eine Homographie schätzen, entzerren) und erst danach `locateLines` laufen lassen. Alternativ die Zeilen aus den Wortboxen des Erkennungsmodells holen, falls ein Modell sie liefert. Dazu ein Selbsttest: Wenn die Zuordnung nach dem Begradigen immer noch von den Linien abweicht, `null` statt falscher Box liefern.
   Stand Phase 2: Gelöst ohne Begradigen, die Heftlinien werden gefunden und gelöscht ([Phase 2](#phase-2-heftlinien)).
2. **`locateLines` meldet keine Mehrdeutigkeit, wenn es falsch liegt.** Die Boxen auf Fotos sind überwiegend „sicher falsch“, nicht `null` (z. B. 93 % bei `liniert-photo`). Nutzer sehen so Marken an falscher Stelle statt einer ehrlichen Rückfallanzeige (Wirkung: falsch platzierte Marken).
   Lösungsvorschlag: Ein Plausibilitätsmaß für die Zuordnung (Abstand der Boxen zu den gefundenen Heftlinien, Anteil des Textes in den Boxen) und unterhalb einer Schwelle `null`.
   Stand Phase 2: Umgesetzt als grobe Platzierung statt `null` (`markImplausible`).
3. **Absturz bei Kariert-Foto.** `locateLines` wirft `RangeError`; mit Trapez-Eingabe erneut.
   Lösungsvorschlag: Absturz reproduzieren (`brief--kariert-photo` aus `render.py --heft`), Indexprüfung in der Bandsegmentierung ergänzen, Regressionstest mit gerendertem Foto.
   Stand Phase 2: Behoben, Regressionstest mit verkleinertem Testbild.
4. **Randzeichen berücksichtigen den Heftrand nicht.** Selbst auf dem sauberen Scan stehen nur 35 % der Randzeichen im Rand, 45 % über dem Text (`liniert-scan`). `layoutOverlay` leitet die Randspalte aus der Textausdehnung ab.
   Lösungsvorschlag: Den Heftrand aus der Seite erkennen (senkrechte Randlinie, bei Karos die Doppellinie), die Randspalte dorthin legen und nur bei fehlendem Rand auf die Textausdehnung zurückfallen.
5. **Strichsuche verwechselt Heftlinien mit Streichungen und umgekehrt.** Recall 13 % auf `liniert-eng`, 25 % mit 7 Fehlalarmen auf Karos, 0–13 % auf Fotos, gegenüber 69 % auf Linienpapier mit Rand.
   Lösungsvorschlag: Heftlinien vor der Suche herausrechnen (Zeilenraster aus der Zeilensuche, Pixel entlang der Heftlinien als Hintergrund behandeln, bei Karos auch senkrechte Linien), dann Schwellen für Strichlänge und Neigung neu messen.
6. **Lesesicherheit täuscht auf Handyfotos.** 17 % der Wörter mit Sicherheit ≥ 0,99 sind auf GNHK falsch, AUC 0,71. Die Schwelle 0,95 aus ScaDS lässt dort zu viele Lesefehler als Rechtschreibfehler durch.
   Lösungsvorschlag: Die Schwelle je Aufnahmeart wählen (Scan oder Foto, aus der Entzerrung ableitbar) oder Fotos strenger behandeln, bis die Kalibrierung auf deutschen Fotos gemessen ist.
7. **Kleine Scans werden nicht vergrößert.** `fitWithin` skaliert nur herunter. BRESSAY (550 px breit) läuft ins Tokenlimit (WER 237 %), mit 1152 px nach Vergrößern 63 %.
   Lösungsvorschlag: Auf die Zielkante hochskalieren (bikubisch) und Wiederholungsschleifen erkennen (Abbruch bei sich wiederholenden Zeilen, danach erneut mit Strafterm). Das mit deutschen Scans niedriger Auflösung gegenprüfen, bevor es eingebaut wird.
8. **Karo-Scan wird schlechter zugeordnet als Linien-Scan.** 65 % Treffer, 30 % sicher falsch.
   Lösungsvorschlag: Bei Karos die Zeilen auf dem Raster als Vielfaches des Karoabstands suchen statt als Bänder.
   Stand Phase 2: Gelöst, Karos werden als Raster erkannt und gelöscht, 100 % Treffer.

## Phase 2: Heftlinien

Phase 2 setzt die Punkte 1, 2, 3 und 8 der [Fehlerursachen](#fehlerursachen-nach-wirkung) um, die Entscheidung steht in [ADR 0004](../adr/0004-zeilenpositionen.md). `findRuling` (`src/layout/ruling.ts`) findet je Seite Lineatur, Karoraster und Randlinien oder meldet blankes Papier. Linien und Tinte werden an Länge und Regelmäßigkeit unterschieden, nicht an der Farbe. Vor der Zeilensuche werden die Linien aus der Tintenmaske gelöscht, danach fallen Spiralbindung, Blattkante und Kandidaten außerhalb der Lineatur weg. `markImplausible` (`src/layout/plausible.ts`) setzt Zeilen, deren Box nicht zur Seite passt, auf grob. Fotos werden nicht begradigt. Der Absturz ist behoben.

### Ergebnis

**Auf allen gerenderten Heftseiten trifft die Zeilenzuordnung jede Zeile.** Mit idealen Transkripten liegen auf allen 24 Seiten 100 % der Boxen richtig (vorher 52,3 %), mit echter Erkennung ebenfalls 100 % (vorher 48,9 %). Keine Box ist sicher falsch oder grob, keine Seite stürzt ab. Fotos sind so gut wie Scans und Karos so gut wie Linien. Auf den Seiten mit Streichungen steigt die Trefferquote von 66,2 % auf 100 %.

**Auf zurückgehaltenen Seiten hält das Ergebnis weitgehend.** Zwei neu gerenderte Sätze mit anderen Seeds, Stiften, Linienfarben und Schriften treffen 96,9 % und 98,0 % (main 62,1 % und 57,3 %), ohne sicher falsche Box. Schwach bleibt `liniert-eng` als Foto (79 % und 89 %), dort werden Zeilen grob statt falsch.

**Die Lineatur wird auf jeder Seite richtig erkannt.** Alle Heftseiten, die früher gerenderten Seiten und die GNHK-Fotos werden richtig als liniert oder kariert erkannt, alle ScaDS-Seiten als blank.

**Auf blankem Papier ändert sich nichts.** Auf ScaDS sind alle 313 Boxen gleich (IoU ≥ 0,9 zur Box vorher), grob bleiben 7 wie vorher. Die früher gerenderten Seiten treffen weiter 100 %.

**Bei abweichendem Transkript halbiert die Plausibilitätsprüfung die sicher falschen Boxen fast.** Über 108 Seiten und 9 Varianten des Transkripts (unverändert sowie fehlende, eingefügte, geteilte und verschmolzene Zeilen, siehe `src/layout/perturb.ts`) gibt die Zuordnung 11 719 sichere Boxen aus. Davon liegen 43 mit IoU < 0,2 daneben (0,37 %), nach der Prüfung noch 23 (0,20 %). Dafür werden 13 richtige Boxen grob (0,11 %).

**Die Lineatur kostet wenig Zeit.** `findRuling` braucht je Seite im Median 18 ms (blankes Papier) bis 25 ms (Heftseiten), auf der A4-Testseite 31 ms, höchstens 41 ms. `locateLines` wird insgesamt um 10 bis 50 ms langsamer, weil zusätzlich Linien gelöscht und Zeilen geprüft werden. Gemessen auf demselben Mac bei ruhiger Maschine, Wanduhrzeit, Median aus fünf abwechselnden Läufen je Seite: Heftseiten 115 → 125 ms, ScaDS 82 → 101 ms, die A4-Seite aus `locate-lines.test.ts` 150 → 200 ms.

### Zählweise

„Sicher falsch“ zählt jetzt nur Boxen, die die Zuordnung als sicher ausgibt und die mit IoU < 0,2 danebenliegen. Grob platzierte Zeilen (`rough`, Konfidenz 0, siehe [ADR 0003](../adr/0003-overlay.md)) stehen in einer eigenen Spalte, als Anteil an allen Transkriptzeilen mit Wahrheitsbox. Phase 1 hat grobe Boxen mitgezählt, wenn sie danebenlagen. Deshalb stehen oben für ideale Transkripte 39,5 % sicher falsch, nach der neuen Zählweise sind es 2,8 % sicher falsch und 43,1 % grob. Die Spalten „vorher“ unten sind mit dem Stand vor Phase 2 und der neuen Zählweise neu gemessen (`eval/heft-measure.ts`, Spalten „grob“ und „Papier erkannt“).

Die früher gerenderten Seiten (`eval/samples/rendered`) sind liniert, nicht weiß. Phase 1 hat das falsch angegeben, die Tabelle oben ist korrigiert.

### Ideale Transkripte

24 Seiten, 392 Zeilen.

| Papier und Aufnahme | Seiten              | Treffer vorher | Treffer nachher | sicher falsch vorher | sicher falsch nachher | grob vorher | grob nachher | Papier erkannt |
| ------------------- | ------------------- | -------------- | --------------- | -------------------- | --------------------- | ----------- | ------------ | -------------- |
| kariert, Foto       | 4 (1 Absturz) → 4   | 2,7 %          | 100,0 %         | 0,0 %                | 0,0 %                 | 73,3 %      | 0,0 %        | 100,0 %        |
| kariert, Scan       | 4 → 4               | 64,9 %         | 100,0 %         | 0,0 %                | 0,0 %                 | 36,4 %      | 0,0 %        | 100,0 %        |
| liniert-eng, Foto   | 4 → 4               | 1,8 %          | 100,0 %         | 16,4 %               | 0,0 %                 | 78,2 %      | 0,0 %        | 100,0 %        |
| liniert-eng, Scan   | 4 → 4               | 100,0 %        | 100,0 %         | 0,0 %                | 0,0 %                 | 0,0 %       | 0,0 %        | 100,0 %        |
| liniert, Foto       | 4 → 4               | 49,2 %         | 100,0 %         | 3,1 %                | 0,0 %                 | 66,2 %      | 0,0 %        | 100,0 %        |
| liniert, Scan       | 4 → 4               | 100,0 %        | 100,0 %         | 0,0 %                | 0,0 %                 | 0,0 %       | 0,0 %        | 100,0 %        |
| alle                | 24 (1 Absturz) → 24 | 52,3 %         | 100,0 %         | 2,8 %                | 0,0 %                 | 43,1 %      | 0,0 %        | 100,0 %        |

### Echte Erkennung

Dieselbe OCR-Ausgabe wie in Phase 1 (GLM-OCR Q8), 12 Seiten, 190 Zeilen.

| Papier und Aufnahme | Seiten              | Treffer vorher | Treffer nachher | sicher falsch vorher | sicher falsch nachher | grob vorher | grob nachher | Papier erkannt |
| ------------------- | ------------------- | -------------- | --------------- | -------------------- | --------------------- | ----------- | ------------ | -------------- |
| kariert, Foto       | 2 (1 Absturz) → 2   | 5,6 %          | 100,0 %         | 2,8 %                | 0,0 %                 | 41,7 %      | 0,0 %        | 100,0 %        |
| kariert, Scan       | 2 → 2               | 88,2 %         | 100,0 %         | 0,0 %                | 0,0 %                 | 17,6 %      | 0,0 %        | 100,0 %        |
| liniert-eng, Foto   | 2 → 2               | 3,4 %          | 100,0 %         | 13,8 %               | 0,0 %                 | 79,3 %      | 0,0 %        | 100,0 %        |
| liniert-eng, Scan   | 2 → 2               | 100,0 %        | 100,0 %         | 0,0 %                | 0,0 %                 | 0,0 %       | 0,0 %        | 100,0 %        |
| liniert, Foto       | 2 → 2               | 0,0 %          | 100,0 %         | 6,5 %                | 0,0 %                 | 90,3 %      | 0,0 %        | 100,0 %        |
| liniert, Scan       | 2 → 2               | 100,0 %        | 100,0 %         | 0,0 %                | 0,0 %                 | 0,0 %       | 0,0 %        | 100,0 %        |
| alle                | 12 (1 Absturz) → 12 | 48,9 %         | 100,0 %         | 3,7 %                | 0,0 %                 | 37,9 %      | 0,0 %        | 100,0 %        |

### Weitere Sätze

| Satz                                | Seiten | Abstürze vorher | Abstürze nachher | Treffer vorher | Treffer nachher | sicher falsch nachher | grob vorher | grob nachher | Papier erkannt |
| ----------------------------------- | ------ | --------------- | ---------------- | -------------- | --------------- | --------------------- | ----------- | ------------ | -------------- |
| Heftseiten mit Streichungen, ideal  | 24     | 0               | 0                | 66,2 %         | 100,0 %         | 0,0 %                 | 36,3 %      | 0,0 %        | 100,0 %        |
| Früher gerenderte Seiten, ideal     | 4      | 0               | 0                | 100,0 %        | 100,0 %         | 0,0 %                 | 0,0 %       | 0,0 %        | 100,0 %        |
| Früher gerenderte Seiten, Erkennung | 4      | 0               | 0                | 100,0 %        | 100,0 %         | 0,0 %                 | 0,0 %       | 0,0 %        | 100,0 %        |
| ScaDS (blankes Papier), Erkennung   | 20     | 0               | 0                | –              | –               | –                     | 2,2 %       | 2,2 %        | 100,0 %        |
| GNHK liniert (Fotos), Erkennung     | 8      | 3               | 0                | –              | –               | –                     | 25,2 %      | 35,8 %       | 100,0 %        |

ScaDS und GNHK haben keine Wahrheitsboxen, dort zählt nur „grob“. Auf GNHK stürzten vorher drei von acht Seiten ab. Auf den fünf übrigen sinkt der Anteil grober Zeilen von 31 auf 20 von 60, die drei bisher abgestürzten Seiten bringen 24 von 63 grobe Zeilen dazu. Ob die groben Zeilen dort zu Recht grob sind, lässt sich ohne Wahrheitsboxen nicht messen.

### Ablation der Fotoeffekte

Wie oben, 12 Fotoseiten, ideale Transkripte. Nach Phase 2 stürzt keine Seite mehr ab.

| Aktive Effekte                | Treffer vorher | Treffer nachher | sicher falsch vorher | sicher falsch nachher | grob vorher | grob nachher | Abstürze vorher |
| ----------------------------- | -------------- | --------------- | -------------------- | --------------------- | ----------- | ------------ | --------------- |
| keine                         | 97,9 %         | 100,0 %         | 0,0 %                | 0,0 %                 | 11,8 %      | 0,0 %        | 0               |
| nur Drehung                   | 70,8 %         | 99,5 %          | 3,1 %                | 0,0 %                 | 37,4 %      | 0,0 %        | 0               |
| nur Keystone                  | 24,6 %         | 99,5 %          | 5,1 %                | 0,0 %                 | 57,4 %      | 0,0 %        | 2               |
| Drehung und Keystone          | 30,3 %         | 98,5 %          | 17,9 %               | 0,0 %                 | 55,4 %      | 5,6 %        | 0               |
| nur Wölbung                   | 51,3 %         | 100,0 %         | 8,2 %                | 0,0 %                 | 39,0 %      | 0,0 %        | 0               |
| nur Bindung                   | 72,8 %         | 100,0 %         | 0,5 %                | 0,0 %                 | 26,2 %      | 0,0 %        | 0               |
| nur Falzschatten (`spine`)    | 97,9 %         | 100,0 %         | 0,0 %                | 0,0 %                 | 12,8 %      | 0,0 %        | 0               |
| nur Schatten                  | 93,3 %         | 100,0 %         | 0,5 %                | 0,0 %                 | 4,6 %       | 0,5 %        | 0               |
| nur Licht                     | 97,4 %         | 100,0 %         | 0,0 %                | 0,0 %                 | 1,0 %       | 0,5 %        | 0               |
| nur Unschärfe                 | 89,7 %         | 100,0 %         | 4,6 %                | 0,0 %                 | 14,4 %      | 0,5 %        | 0               |
| nur Rauschen                  | 97,4 %         | 100,0 %         | 0,0 %                | 0,0 %                 | 3,6 %       | 0,5 %        | 0               |
| nur Tisch um die Seite        | 97,4 %         | 99,5 %          | 0,0 %                | 0,0 %                 | 10,3 %      | 0,0 %        | 0               |
| Wölbung und Bindung           | 49,7 %         | 100,0 %         | 3,1 %                | 0,0 %                 | 48,7 %      | 0,0 %        | 0               |
| Drehung, Keystone und Wölbung | 34,9 %         | 99,5 %          | 6,7 %                | 0,0 %                 | 63,6 %      | 0,0 %        | 0               |
| alle                          | 31,3 %         | 100,0 %         | 17,4 %               | 0,0 %                 | 75,9 %      | 0,0 %        | 0               |
| alle ohne Keystone            | 32,3 %         | 100,0 %         | 3,6 %                | 0,0 %                 | 59,5 %      | 0,0 %        | 1               |
| alle ohne Wölbung             | 20,0 %         | 99,5 %          | 5,1 %                | 0,0 %                 | 64,1 %      | 0,0 %        | 2               |
| alle ohne Bindung             | 35,4 %         | 100,0 %         | 8,7 %                | 0,0 %                 | 71,8 %      | 0,0 %        | 0               |
| alle ohne Drehung             | 25,6 %         | 99,5 %          | 11,8 %               | 0,0 %                 | 74,9 %      | 0,0 %        | 0               |

Die Trefferquote liegt in jeder Kombination bei mindestens 98,5 %. Die Ausnahme ist `brief--liniert-eng-photo` mit Drehung und Keystone: 14 von 16 Boxen treffen, 11 davon sind grob, weil die Zuordnung dort nicht eindeutig ist. Die Werte unter 100 % in den übrigen Zeilen sind je eine Box mit IoU zwischen 0,2 und 0,5.

### Zurückgehaltene Seiten

Die Schwellen und Filter sind auf den Sätzen oben entwickelt. Zur Gegenprobe sind zwei neue Sätze gerendert, die vor dieser Messung niemand angesehen hat: `render.py --heft` mit Seed 2 und Seed 3, alle Fotoeffekte, Stifte, Linienfarben und Schriften in anderer Zuordnung (Seed 2: Stifte schwarz, blau, Bleistift; Linien grau, kräftig, blau; Schriften Caveat, Indie Flower, Grundschrift, Schulausgangsschrift. Seed 3: Stifte Bleistift, schwarz, blau; Linien kräftig, blau, grau; Schriften Indie Flower, Schulausgangsschrift, Caveat, Grundschrift). Seed 3 ist zur Hälfte mit Bleistift geschrieben. Je 24 Seiten, ideale Transkripte.

| Papier und Aufnahme | Treffer Seed 2, main → PR | Treffer Seed 3, main → PR | sicher falsch PR | grob PR |
| ------------------- | ------------------------- | ------------------------- | ---------------- | ------- |
| kariert, Foto       | 23,7 % → 100,0 %          | 41,6 % → 98,7 %           | 0,0 %            | 0,0 %   |
| kariert, Scan       | 51,3 % → 100,0 %          | 40,0 % → 100,0 %          | 0,0 %            | 0,0 %   |
| liniert-eng, Foto   | 28,6 % → 78,6 %           | 47,3 % → 89,1 %           | 0,0 %            | 13,5 %  |
| liniert-eng, Scan   | 100,0 % → 100,0 %         | 98,2 % → 100,0 %          | 0,0 %            | 0,9 %   |
| liniert, Foto       | 79,7 % → 100,0 %          | 28,8 % → 98,5 %           | 0,0 %            | 1,5 %   |
| liniert, Scan       | 100,0 % → 100,0 %         | 98,5 % → 100,0 %          | 0,0 %            | 0,0 %   |
| **alle**            | 62,1 % → 96,9 %           | 57,3 % → 98,0 %           | 0,0 %            | 2,3 %   |

Das Ergebnis hält: 97 bis 98 % Treffer statt 100 %, keine sicher falsche Box, kein Absturz (main: einer), Papier überall richtig erkannt. Schwach bleibt `liniert-eng` als Foto. Auf `ferien--liniert-eng-photo` (Seed 2) sind alle 11 Zeilen grob: Zwei Lochungen und Schattenstücke an Blatt- und Tischkante bleiben als Kandidaten übrig, weil die Linien dort bis zum Blattrand laufen und die Filter für Kandidaten außerhalb der Lineatur nicht greifen; für die Bindungserkennung sind zwei Löcher zu wenig. Die übrigen Abweichungen sind einzelne Zeilen.

### Gegenprobe mit dem Integrationstest

`layout.integration.test.ts` auf den früher gerenderten linierten Seiten (`ROTSTIFT_INTEGRATION=1`): 293 von 293 Zeilen treffen wie vorher, die mittlere IoU steigt von 0,937 auf 0,964. Über die Varianten des Transkripts gibt es weiter keine sicher falsche Box, aber 14 `null` mehr (598 statt 584 von 2573), alle bei fehlenden oder eingefügten Zeilen. Vermutlich liegt das an den engeren Boxen nach dem Löschen der Linien, die die Zuordnung an manchen Stellen weniger eindeutig machen; geprüft ist das nicht.

### Plausibilität

Die Prüfung greift nur, wenn eine Seite mindestens vier sichere Zeilen hat. Sie vergleicht jede sichere Zeile mit dem Median der Seite: Höhe je Teilzeile über dem 2,5-Fachen, Tintendichte unter 40 % und, nur auf linierten Seiten, eine um mehr als ein Viertel Linienabstand verschobene Lage zu den Heftlinien bei weniger als 75 % der Höhe. Die Schwellen sind auf den Varianten oben gewählt (ideale Heftseiten, Seiten mit Streichungen und fünf Ablationsstufen), dieselben Seiten dienen auch zur Messung. Auf Karos traf die Lageprüfung mehr richtige Boxen als falsche (38 richtige, 7 falsche, keine davon sicher falsch) und ist dort abgeschaltet. Von den 23 sicher falschen Boxen, die nach der Prüfung bleiben, gehören 22 zu einer Zeile, die im Transkript oder im Bild fehlt, eine zu einer eingefügten Zeile.

### Testbild und Regressionstest

`src/layout/fixtures/heft-kariert-foto.jpg` ist `brief--kariert-photo` aus `render.py --heft` mit dem Standard-Seed, wie für die Messung auf 1152 px verkleinert, dann auf 900 px Kantenlänge und JPEG-Qualität 35 gebracht (50 KB). `heft-kariert-foto.json` enthält Text und Wahrheitsboxen im selben Maßstab. Auf dieser Seite stürzte `locateLines` in Phase 1 ab, der alte Stand wirft auf dem Testbild weiter die `RangeError`. `src/layout/ruling.test.ts` prüft darauf Karoraster, mindestens 90 % Treffer und keine sicher falsche Box. `src/layout/flow.test.ts` hält die Ursache fest: Verliert eine Zeile beim Zusammensetzen ihre einzige Kandidatenzeile an die Nachbarzeile, wird sie grob platziert, statt eine leere Liste auszuwerten.

### Offen

- **Fotos von `liniert-eng`:** Eine Seite der Ablation (Drehung mit Keystone) bleibt zu großen Teilen grob, auf den zurückgehaltenen Seiten eine ganz. Fremdkandidaten an der Blattkante und einzelne Lochungen werden dort nicht entfernt, weil die Linien bis zum Rand laufen.
- **Mehr `null` bei fehlenden Zeilen:** 14 von 2573 Varianten-Zeilen im Integrationstest, siehe oben.
- **Strichsuche und Randzeichen:** Die Punkte 4 und 5 der Fehlerursachen sind nicht angefasst. `ruling.margins` liefert jetzt die Randlinien, `ruling.horizontal` die Heftlinien. Beides können Strichsuche und Overlay nutzen.
- **Echte Fotos:** Die Fotos sind weiter simuliert. Die GNHK-Fotos zeigen nur, dass nichts abstürzt und die Lineatur gefunden wird.

## Demo-Daten (nur Vorschlag)

`src/pipeline/demo-transcriber.ts` liefert für jede Seite einen festen Platzhaltertext (`SAMPLES`, drei Varianten, Marker `Demo-Text`) und simuliert jeden vierten Fehler. Die Seitenbilder kommen aus den Dateien, die jemand in `pnpm dev:web` lädt. Damit gibt es keine Demo, in der Text, Zeilen und Marken zu einem sichtbaren Bild passen.

Vorschlag für Phase 2: Gerenderte Heftseiten (Scan und Foto, `render.py --heft` mit festem Seed) als Bilder in einen Demo-Ordner einchecken, dazu das passende Transkript je Seite. Der Demo-Transkribierer ordnet dem Bild über seinen Namen oder Hash das Transkript zu. So zeigt `pnpm dev:web` eine Seite mit Linien, Marken und Randzeichen, und die Foto-Seite macht den Fehler aus Punkt 1 im Browser sichtbar. Eingecheckt werden dürfen nur diese selbst gerenderten Seiten (rund 250 KB je Seite), keine Daten aus GNHK, BRESSAY, ScaDS oder den Aufsätzen.

## Grenzen

- **Kleine Stichproben:** Zwei bis zwölf Seiten je Zeile, bei echter Erkennung zwei je Papier-Aufnahme-Paar. Prozentwerte schwanken um mehrere Punkte.
- **Simulierte Fotos:** Die Fotoeffekte sind simuliert. Echte Handyfotos haben Linsenverzerrung, Autofokus, HDR und Schatten der Hand, die hier fehlen. Die GNHK-Ergebnisse sind daher nur eine Gegenprobe, ohne Wahrheitsboxen kann man dort die Zeilenzuordnung nicht messen.
- **Keine deutschen Schülerhefte:** Echte deutsche Schrift auf Heftpapier liegt nur über den Renderer vor (Schriftarten statt Kinderhandschrift, saubere Zeilen).
- **Ideale Transkripte:** Sie isolieren die Zeilenzuordnung, setzen aber voraus, dass die Erkennung die Zeilen richtig trennt.
- **Maschine unter Last:** Zeiten sind nicht verwertbar.
- **Fremdsprachige Sätze:** GNHK, Russisch und BRESSAY sagen nichts über deutsche Lesegenauigkeit.
- **Randzeichen-Maß:** Gilt nur für Papiere mit gezeichnetem Rand.

## Nachbauen

```bash
eval/.venv/bin/python -I eval/datasets.py
eval/.venv/bin/python -I eval/samples/render.py --heft --out ~/.cache/rotstift/datasets/heft-gerendert
eval/.venv/bin/python -I eval/samples/render.py --heft --strike 4 --seed 1 --out ~/.cache/rotstift/datasets/heft-gerendert-strich
```

Weitere Schritte (Verkleinern, Erkennung, Auswertung) stehen im Abschnitt „Heftpapier“ in [eval/README.md](../../eval/README.md).
