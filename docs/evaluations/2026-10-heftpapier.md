# Evaluation: Heftpapier und Handyfotos (Oktober 2026)

Frage: Wie gut kommt Rotstift mit echten Schulheften zurecht, also mit linierten und karierten Seiten, Rand, Spiralbindung und Fotos vom Handy? Bisher wurden Erkennung, Zeilenzuordnung ([ADR 0004](../adr/0004-zeilenpositionen.md)) und Strichsuche ([Durchgestrichenes](2026-10-durchgestrichen.md)) auf weißem Papier und auf ScaDS-Scans gemessen. Dieser Bericht beschafft Testdaten, baut einen Renderer für Heftpapier und misst, was an der Pipeline bricht. Phase 1 ändert an der App nichts. Was Phase 2 an der Zeilenzuordnung geändert hat, steht unter [Phase 2: Heftlinien](#phase-2-heftlinien), das Begradigen von Handyfotos unter [Phase 2: Fotos begradigen](#phase-2-fotos-begradigen).

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

| Quelle                                                                | Inhalt                                                                                                                                                               | Umfang                                                                          | Sprache       | Papier                                           | Aufnahme         | Transkript                                                  | Bezug                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------- | ------------------------------------------------ | ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| ScaDS.AI German Full-Page (bereits genutzt)                           | Wikipedia-Auszüge, Erwachsenenschrift                                                                                                                                | 77 Seiten                                                                       | Deutsch       | kein Heftpapier                                  | Scan             | ja, Klartext                                                | Zenodo, CC BY 4.0                                                  |
| GNHK (Hugging Face-Spiegel `aryaman27/goodnotes-handwritten-dataset`) | Notizen, Briefe, Listen                                                                                                                                              | 687 Seiten, davon 61 mit Heftlinien (`gnhk-liniert`)                            | Englisch      | teils liniert, teils kariert, teils weiß         | Handyfoto        | ja, Wortboxen mit Zeilenindex, daraus Zeilen                | Hugging Face, feste Revision; Lizenz nicht geprüft                 |
| Russische Schulaufsätze (Mendeley Data)                               | handgeschriebene Aufsätze von Schülern                                                                                                                               | 19 einseitige Aufsätze (Archiv 149 MB)                                          | Russisch      | Linienpapier                                     | Scan             | ja                                                          | Mendeley Data; Lizenz nicht geprüft                                |
| BRESSAY (Zenodo)                                                      | Aufsatzseiten mit durchgestrichenen Wörtern                                                                                                                          | 1000 Seiten, 1,5 GB                                                             | Portugiesisch | Linienpapier, Seiten rund 550 px breit           | Scan             | ja, Streichungen als `--Wort--` markiert, daraus `~~Wort~~` | Zenodo, Lizenz nicht geprüft                                       |
| Litkey-Korpus                                                         | Texte von Schülern der Klassen 2 bis 8 mit Fehlerannotation                                                                                                          | –                                                                               | Deutsch       | –                                                | –                | nur Text, keine Bilder                                      | Server auch bei der zweiten Suche nicht erreichbar, nicht geladen  |
| Leere Heftseiten (Wikimedia Commons)                                  | vier Fotos leerer Blätter (kariert 5 mm, Millimeterpapier, 2 × amerikanisch liniert), dazu zwei beschriebene Heftseiten aus 1929 und 1953 (Kurrent, ohne Transkript) | 6 Bilder, 92 MB                                                                 | –             | echt                                             | Handyfoto/Kamera | nein                                                        | Wikimedia Commons, CC BY, CC BY-SA oder gemeinfrei; `commons-heft` |
| `fhswf/german_handwriting` (Hugging Face)                             | einzelne Zeilen (Stichworte, Sätze) von Schülern und Studierenden abgeschrieben                                                                                      | 10 854 Zeilen von 15 Schreibern, davon 300 gleichmäßig gezogen (`fhswf-zeilen`) | Deutsch       | meist weißes Papier, teils mit Heftlinie am Rand | Handyfoto        | ja, je Zeile                                                | Hugging Face, AFL-3.0                                              |
| Gerenderte Seiten (`render.py --heft`)                                | Texte aus `eval/samples/texts` auf Heftpapier                                                                                                                        | 24 Seiten (4 Texte, 3 Papiere, Scan und Foto), dazu 24 mit Streichungen         | Deutsch       | gezeichnet                                       | Scan und Foto    | ja, mit Wahrheitsboxen je Zeile                             | selbst erzeugt, darf eingecheckt werden                            |

Gefunden wurde keine deutsche Quelle mit Bildern echter Schülerhefte und Transkript. Litkey hat die richtige Zielgruppe, aber nur Text (CC BY-SA 4.0), der Server war nicht erreichbar, das Internet Archive war offline. Die zweite Suche (Abschnitt „Zweite Suche“ unten) hat Hugging Face, Zenodo, Kaggle und Wikimedia Commons ausgewertet und echte Papierfotos sowie deutsche Zeilen mit Transkript gefunden, aber keine ganze Heftseite mit Transkript. Für Deutsch bleibt der Renderer (jetzt auch auf echtem Papier), für echte Fotos GNHK (englisch, Notizen statt Schulheft) als Stellvertreter für Perspektive, Schatten und Linien.

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
   Stand Phase 2: Gelöst, siehe [Phase 2: Randzeichen](#phase-2-randzeichen). 99,5 % im Rand, 0 % über Text auf Papier mit Rand.
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
- **Strichsuche und Randzeichen:** Punkt 5 der Fehlerursachen ist nicht angefasst, Punkt 4 ist in [Phase 2: Randzeichen](#phase-2-randzeichen) gelöst. `ruling.horizontal` liefert die Heftlinien für die Strichsuche.
- **Echte Fotos:** Die Fotos sind weiter simuliert. Die GNHK-Fotos zeigen nur, dass nichts abstürzt und die Lineatur gefunden wird.

## Phase 2: Kleine Scans

Behoben ist Fehlerursache 7. Die Erkennung bekommt Bilder, deren lange Kante unter der Zielkante des Modells liegt (bei GLM-OCR 1152 px), jetzt hochskaliert, und eine Wiederholungsschleife führt zu einem zweiten Versuch mit Wiederholungsstrafe, danach zu einer Fehlermeldung statt zu Müll.

**Änderung**

- `modelImageSize` ([`src/llm/image.ts`](../../src/llm/image.ts)) vergrößert Bilder unter der Zielkante auf die Zielkante, höchstens um den Faktor 4, mit `imageSmoothingQuality = 'high'` beim Zeichnen. Bilder ab der Zielkante laufen unverändert durch `fitWithin` und denselben Zeichenpfad wie vorher (Test: gleiche Größe, Glättungsstufe wird nur beim Vergrößern gesetzt). Anzeige, Vorschau und Overlay nutzen weiter das Original (`image-decode.ts` bleibt unberührt), die Koordinaten stimmen also.
- Eine Antwort gilt als entartet, wenn sie am Tokenlimit endete (`finish_reason = length`) oder die bisherige Schleifenregel anschlägt (eine Periode von bis zu 16 Wörtern mindestens 20-mal hintereinander und zusammen mindestens 80 Wörter, `hasRepetitionLoop`). Eine Seite hat bei GLM-OCR rund 600 bis 900 Token, 2048 Token sind also kein langer Text, sondern eine Schleife oder ein Abdriften. Echte Wiederholungen in Schülertexten (Aufzählungen, gleiche Satzanfänge, Stottern, Strafzeilen bis zu 10 Wiederholungen) lösen nicht aus, getestet in `transcript-lines.test.ts`. Echte Seiten mit Strafzeilen enden mit `stop`, deshalb zählt für sie nur die strenge Regel.
- Bei einer entarteten Antwort fragt `createLlmTranscriber` einmal mit `repeat_penalty = 1,15` nach (neues Feld in `ChatRequest` und `request.rs`, geprüft auf 1 bis 2; Cloud-Anfragen entfernen es wie `seed`). Ist die zweite Antwort wieder entartet, meldet die Seite „auch im zweiten Versuch in einer Wiederholung verfangen“ mit dem Hinweis auf einen Scan mit höherer Auflösung. Antworten, die nur aus Denktext bestehen, werden nicht erneut gefragt.
- Abgebrochen wird nicht mitten im Strom, denn die Anfrage ist nicht gestreamt. Die Schleife läuft bis zum Tokenlimit und wird danach erkannt. Auf kleinen Bildern kostet das rund 15 s, bei hochskalierten Bildern entsteht der Fehlerfall seltener (1 von 6 statt 6 von 6 bei BRESSAY).

**Messung**

`eval/small-scans.py` verkleinert Seiten auf eine Breite (500, 700, 900 px, mit Lanczos) und schreibt je Breite die Eingabe „vorher“ (nur verkleinern) und „nachher“ (auf 1152 px vergrößert, bikubisch), `eval/ocr-small.ts` erkennt sie mit GLM-OCR Q8 (4 bis 6 Threads) nach der App-Regel und hält beide Versuche fest. Seiten: die ersten sechs ScaDS-Seiten und sechs Heft-Scans aus `render.py --heft` (`brief` und `ferien` auf drei Papieren), 600 bis 750 Wörter je Satz. „Vorher“ ist der erste Versuch auf dem nicht vergrößerten Bild (altes Verhalten), „nachher“ die neue Kette aus Vergrößern und gegebenenfalls zweitem Versuch. Eine Fehlerseite zählt mit leerem Text (100 % der Wörter fehlen).

| Satz                       | Seiten | Breite     | WER vorher | WER nachher | Schleife im ersten Versuch (vorher / nachher) | Fehlerseiten nachher |
| -------------------------- | ------ | ---------- | ---------- | ----------- | --------------------------------------------- | -------------------- |
| ScaDS                      | 6      | 500 px     | 29,9 %     | 17,2 %      | 0 / 0                                         | 0                    |
| ScaDS                      | 6      | 700 px     | 21,2 %     | 17,1 %      | 0 / 0                                         | 0                    |
| Heft-Scans (gerendert)     | 6      | 500 px     | 6,6 %      | 4,7 %       | 0 / 0                                         | 0                    |
| Heft-Scans (gerendert)     | 6      | 700 px     | 3,5 %      | 4,7 %       | 0 / 0                                         | 0                    |
| BRESSAY (Original, 550 px) | 6      | 469–552 px | 233,9 %    | 46,3 %      | 6 / 1                                         | 0                    |

- **900 px Breite:** Entfällt. Eine A4-Seite ist dann 1273 px hoch und wird auf 1152 px verkleinert, „vorher“ und „nachher“ sind Byte für Byte dieselbe Eingabe, ebenso die ScaDS-Seiten über 900 px und alle ScaDS-Originale ab 1152 px. Das ist die geforderte Unverändert-Eigenschaft für normale Seiten und stützt sich auf den Test von `modelImageSize` gegen `fitWithin`. Die WER normaler Seiten ist damit die aus „Vergleich mit ScaDS“ (20,9 % ScaDS, 4,5 % Heftpapier).
- **BRESSAY in Schritten:** Original ohne zweiten Versuch 233,9 %, Original mit zweitem Versuch (Strafe 1,15) 86,6 % (4 von 6 Seiten gerettet, 2 Fehlerseiten, ohne sie 78,4 %), hochskaliert ohne zweiten Versuch 62,8 %, hochskaliert mit zweitem Versuch 46,3 %. Die Vergrößerung wirkt am stärksten, der zweite Versuch rettet die verbliebene Schleife (Seite `4454-017`).
- **Seitenweise:** Bei ScaDS fiel die WER bei 500 px auf allen 6 Seiten und bei 700 px auf 5 von 6, am stärksten bei `026` (41,0 → 15,0 %) und `039` (41,8 → 18,4 %). Bei den Heft-Scans sank sie bei 500 px auf 4 Seiten (1 gleich, 1 schlechter), bei 700 px auf keiner (4 gleich, 2 schlechter: `ferien--liniert-scan` 9,2 → 15,1 %, `ferien--kariert-scan` 1,7 → 3,4 %). Das sind wenige Wörter je Seite. Bei einer Vergrößerung von nur 1,16-fach (990 → 1152 px) bringt das Hochskalieren also nichts, schadet aber im Mittel kaum.
- **Zeiten:** Die Laufzeiten sind unbrauchbar, weil auf der Maschine drei weitere Erkennungsserver liefen (Last über 100).

**Grenzen**

- Kleine Stichprobe (6 Seiten je Zeile, rund 700 Wörter), die Unterschiede von 1 bis 2 Prozentpunkten (Heft, 700 px) liegen im Rauschen.
- Die Verkleinerung erzeugt keine echten Scans niedriger Auflösung (keine Unschärfe, kein JPEG-Rauschen der Zielgeräte). BRESSAY ist die einzige echte Gegenprobe, portugiesisch und mit 46 % WER auch hochskaliert schlecht lesbar.
- Die Strafe 1,15 wurde nicht abgestimmt. Für die Schleife auf Originalgröße rettete sie 4 von 6 Seiten, höhere Werte wurden nicht gemessen.
- Cloud-Modelle fragen bei einer entarteten Antwort ebenfalls ein zweites Mal, nur ohne Strafe.
- Die Integrationstests (`engine.integration.test.ts` und andere) bringen eigene Kodierer mit und vergrößern nicht.

Nachbauen (Pfade nach Bedarf):

```bash
eval/.venv/bin/python -I eval/small-scans.py ~/.cache/rotstift/datasets/scads-fullpage/extracted/images <Ergebnisse>/scads --pages 000,013,026,039,052,065
node --experimental-transform-types eval/ocr-small.ts --out <Ergebnisse>/res --threads 4 \
  --set scads-w500-before=<Ergebnisse>/scads/w500/before=<Datensatz>/ground_truth \
  --set scads-w500-after=<Ergebnisse>/scads/w500/after=<Datensatz>/ground_truth
```

`ocr-small.ts --report` wertet vorhandene Ergebnisse ohne neuen Lauf aus.

## Phase 2: Fotos begradigen

Handyfotos werden beim Import begradigt, wenn sie sicher als verzerrtes Foto erkannt sind. Die begradigte Seite gilt dann für Erkennung, Zeilen, Strichsuche, Overlay und Export, Scans bleiben unverändert. Die Entscheidung steht in [ADR 0010](../adr/0010-fotos-begradigen.md), der Code in `src/layout/dewarp.ts` (Blatt in `sheet.ts`, Homographie in `homography.ts`, Steigungsfeld aus den Heftlinien in `slope-field.ts`). Gemessen ist der Stand mit den Heftlinien aus Phase 2, „vorher“ ist derselbe Stand ohne Begradigen.

### Ergebnis

**Fotos treffen fast jede Zeile, auch wo die Heftlinien allein scheitern.** Mit idealen Transkripten steigt die Trefferquote auf 48 gerenderten Fotoseiten von 93,2 % auf 99,7 %, grob platziert sind noch 0,1 % statt 6,3 % der Zeilen, sicher falsch keine Box mehr (vorher 0,6 %). Das gilt für die Bilder in voller Größe, wie die App sie den Zeilen gibt. Auf 1152 px treffen die Fotos auch ohne Begradigen fast alles (99,6 % vorher, 99,0 % nachher). Der Gewinn liegt fast ganz bei `liniert-eng`, Linien bis zum Blattrand: 76,4 % → 99,1 %. Dort waren ohne Begradigen auf 4 von 16 Seiten fast alle Zeilen grob.

**Scans bleiben unverändert.** Keine gerenderte Scanseite und keine Seite aus ScaDS, den russischen Aufsätzen und den früher gerenderten Seiten wird begradigt, von 1000 BRESSAY-Seiten eine (siehe unten). Ohne Plan läuft eine Seite durch denselben Code wie vorher, ein Test prüft das Pixel für Pixel (`src/import/straighten.test.ts`).

**Die Erkennung bleibt gleich gut.** Mit GLM-OCR auf 12 Fotoseiten liegt die WER bei 2,9 % vorher und 3,3 % nachher. Der Unterschied kommt von einer Seite, deren Schrift ein t hat, das einem s ähnelt; GLM liest es auf der begradigten Seite öfter als s (7 → 21 Fehler). Ohne diese Seite sinkt die WER von 2,7 % auf 2,1 %.

**Die Strichsuche auf Fotos wird genauer.** Auf den 12 Fotoseiten mit Streichungen sinken die Fehlalarme von 55 auf 34, der Recall steigt leicht von 16,7 % auf 18,8 %. Fotos liegen damit auf dem Niveau der Scans.

**Begradigen kostet unter 0,2 s je Seite.** Planen auf 1200 px braucht in Node im Median 49 bis 55 ms (höchstens 122 ms), Anwenden beim Zeichnen auf 2048 px 41 bis 62 ms. Ein Scan kostet nur die Prüfung (25 ms). In WebKit, der Engine der Mac-App, ist beides etwa dreimal so langsam.

### Ideale Transkripte

Gerenderte Heftseiten aus `render.py --heft` mit Seed 0 (12 Scans, 12 Fotos) und dazu je 12 Fotoseiten mit Seed 1, 2 und 3, alle Fotoeffekte an. Gemessen mit `eval/heft-measure.ts --ideal`, „nachher“ mit `--dewarp`: Die Zeilenzuordnung läuft auf der begradigten Seite, die Boxen werden für den Vergleich mit der Wahrheit ins Foto zurückgerechnet (Hülle der zurückgerechneten Boxkante).

| Papier und Aufnahme | Seiten | Zeilen | begradigt | Treffer vorher | Treffer nachher | sicher falsch vorher | sicher falsch nachher | grob vorher | grob nachher |
| ------------------- | ------ | ------ | --------- | -------------- | --------------- | -------------------- | --------------------- | ----------- | ------------ |
| liniert, Foto       | 16     | 260    | 16        | 99,6 %         | 100,0 %         | 0,0 %                | 0,0 %                 | 0,0 %       | 0,0 %        |
| liniert-eng, Foto   | 16     | 220    | 16        | 76,4 %         | 99,1 %          | 2,3 %                | 0,0 %                 | 21,8 %      | 0,5 %        |
| kariert, Foto       | 16     | 300    | 16        | 100,0 %        | 100,0 %         | 0,0 %                | 0,0 %                 | 0,3 %       | 0,0 %        |
| alle Fotos          | 48     | 780    | 48        | 93,2 %         | 99,7 %          | 0,6 %                | 0,0 %                 | 6,3 %       | 0,1 %        |
| liniert, Scan       | 4      | 65     | 0         | 100,0 %        | 100,0 %         | 0,0 %                | 0,0 %                 | 0,0 %       | 0,0 %        |
| liniert-eng, Scan   | 4      | 55     | 0         | 100,0 %        | 100,0 %         | 0,0 %                | 0,0 %                 | 0,0 %       | 0,0 %        |
| kariert, Scan       | 4      | 77     | 0         | 100,0 %        | 100,0 %         | 0,0 %                | 0,0 %                 | 0,0 %       | 0,0 %        |
| alle Scans          | 12     | 197    | 0         | 100,0 %        | 100,0 %         | 0,0 %                | 0,0 %                 | 0,0 %       | 0,0 %        |

Die Bilder sind in voller Größe gemessen (1440 px breit). So bekommt `locateLines` sie auch in der App: Die Seite wird für die Zeilen auf höchstens 2048 px gezeichnet und intern auf 1200 px verkleinert. Die Tabelle der Heftlinien oben ist auf 1152 px gemessen. Dort treffen die Fotos auch ohne Begradigen fast alles, auf denselben 48 Fotoseiten 99,6 % vorher und 99,0 % nachher (grob 0,5 % → 1,4 %). In voller Größe bleibt dagegen auf Seed 0 `inhaltsangabe--liniert-eng-photo` ganz grob, die Zuordnung auf `liniert-eng` hängt also an der Auflösung. Auf 1152 px verliert eine begradigte Seite (`ferien--liniert-eng-photo`, Seed 2) 6 von 13 Treffern: Die erste Textzeile liegt auf einer Heftlinie, die Zuordnung verrutscht um eine Zeile und markiert die Boxen als grob. Das ist dieselbe Schwäche der Zuordnung, nur auf der anderen Seite.

### Ablation der Fotoeffekte

12 Fotoseiten je Zeile mit nur den genannten Effekten, Seed 0, ideale Transkripte.

| Aktive Effekte                | begradigt | Treffer vorher | Treffer nachher | grob vorher | grob nachher |
| ----------------------------- | --------- | -------------- | --------------- | ----------- | ------------ |
| keine                         | 0         | 100,0 %        | 100,0 %         | 0,0 %       | 0,0 %        |
| nur Drehung                   | 0         | 100,0 %        | 100,0 %         | 0,0 %       | 0,0 %        |
| nur Keystone                  | 10        | 99,5 %         | 100,0 %         | 0,0 %       | 0,0 %        |
| Drehung und Keystone          | 6         | 97,9 %         | 97,9 %          | 2,1 %       | 2,1 %        |
| nur Wölbung                   | 0         | 100,0 %        | 100,0 %         | 0,0 %       | 0,0 %        |
| nur Bindung                   | 0         | 99,5 %         | 99,5 %          | 0,0 %       | 0,0 %        |
| nur Tisch um die Seite        | 0         | 100,0 %        | 100,0 %         | 0,0 %       | 0,0 %        |
| Drehung, Keystone und Wölbung | 8         | 99,5 %         | 99,5 %          | 0,0 %       | 0,0 %        |

Einzelne Effekte schafft die Zeilenzuordnung mit den Heftlinien schon allein. Begradigt wird erst, wenn die Verzerrung messbar ist: Drehung ohne sichtbaren Tisch löst nie aus, die gerenderte Wölbung (5 bis 22 px Absenkung zum Rand) bleibt mit höchstens 1,7 ‰ der Seitenhöhe unter der Schwelle von 3 ‰. Die groben Zeilen bei „Drehung und Keystone“ stehen auf `brief--liniert-eng-photo`, die mit 5,1° Drehung und 0,8° Keystone nicht begradigt wird. Der Gewinn entsteht, wenn mehrere Effekte zusammenkommen und der Tisch sichtbar ist (Tabelle oben, alle Effekte).

### Scans

`analyzeDewarp` auf allen Scansätzen, Bilder wie in der App auf höchstens 2048 px verkleinert.

| Satz                              | Seiten | begradigt | größte Drehung | größte Wölbung | größtes Keystone |
| --------------------------------- | ------ | --------- | -------------- | -------------- | ---------------- |
| ScaDS (blankes Papier)            | 77     | 0         | –              | –              | –                |
| Russische Schulaufsätze           | 19     | 0         | 0,34°          | 1,0 ‰          | 0,24°            |
| Früher gerenderte Seiten          | 16     | 0         | 0,80°          | 0,2 ‰          | 0,08°            |
| Heftseiten, Scan                  | 12     | 0         | 0,80°          | 0,4 ‰          | 0,07°            |
| Heftseiten mit Streichungen, Scan | 12     | 0         | 0,80°          | 0,1 ‰          | 0,03°            |
| BRESSAY                           | 1000   | 1         | 1,39°          | 2,2 ‰          | 1,09°            |

Auf blankem Papier ohne Blattkante gibt es kein Maß, ScaDS bleibt deshalb immer unverändert. Die eine BRESSAY-Seite (`bressay-4291-004`, 503 × 642 px) ist kein Rauschen: Ihre Heftlinien laufen gleichmäßig von −0,9° oben bis +0,2° unten auseinander, das Blatt lag also schief oder gewölbt auf. Die nächste BRESSAY-Seite liegt bei 0,43°.

### Strichsuche

`heft-gerendert-strich` (`--strike 4 --seed 1`), ideale Transkripte, `eval/strike.ts --method ink`, „nachher“ mit `--dewarp`.

| Satz     | Gestrichen | erkannt vorher | erkannt nachher | Fehlalarme vorher | Fehlalarme nachher | Precision vorher | Precision nachher |
| -------- | ---------- | -------------- | --------------- | ----------------- | ------------------ | ---------------- | ----------------- |
| 12 Fotos | 48         | 8 (16,7 %)     | 9 (18,8 %)      | 55 (3,6 %)        | 34 (2,2 %)         | 12,7 %           | 20,9 %            |
| 12 Scans | 48         | 11 (22,9 %)    | 11 (22,9 %)     | 42 (2,7 %)        | 42 (2,7 %)         | 20,8 %           | 20,8 %            |

Die Strichsuche selbst ist nicht angefasst. Dass sie auf Heftpapier schwach bleibt und auch auf Scans viele Fehlalarme hat, ist Fehlerursache 4 und offen.

### Echte Erkennung

12 Fotoseiten aus Seed 0, GLM-OCR Q8 wie in der App auf 1152 px, 4 Threads. „Nachher“ erkennt die begradigten Seiten (`eval/dewarp-pages.ts`, dann `resize-pages.py`), die Zeilen werden mit `heft-measure.ts --dewarp` auf der begradigten Seite gesucht.

| Papier      | Seiten | Wörter | WER vorher | WER nachher | CER vorher | CER nachher | Treffer vorher | Treffer nachher |
| ----------- | ------ | ------ | ---------- | ----------- | ---------- | ----------- | -------------- | --------------- |
| liniert     | 4      | 511    | 3,7 %      | 5,3 %       | 0,7 %      | 1,1 %       | 100,0 %        | 100,0 %         |
| liniert-eng | 4      | 511    | 3,1 %      | 2,2 %       | 0,6 %      | 0,4 %       | 100,0 %        | 100,0 %         |
| kariert     | 4      | 511    | 2,0 %      | 2,3 %       | 0,4 %      | 0,5 %       | 100,0 %        | 100,0 %         |
| alle        | 12     | 1533   | 2,9 %      | 3,3 %       | 0,6 %      | 0,7 %       | 100,0 %        | 100,0 %         |

Die Fehler je Seite verschieben sich in beide Richtungen (etwa `brief--liniert-photo` 8 → 3, `brief--kariert-photo` 5 → 8). Bis auf `handy--liniert-photo` (t als s) sind es Einzelfälle. Auf 1152 px treffen die Zeilen hier schon ohne Begradigen alles, siehe oben.

### GNHK

Die GNHK-Fotos (687 Seiten, Englisch, keine Wahrheitsboxen) laufen wie in der App: Planen auf 1200 px, Anwenden auf 2048 px. 383 Seiten werden begradigt, 138 davon über die Blattkante, 245 nur über die Heftlinien. Im Teil `gnhk-liniert` sind es 46 von 61. Eine Sichtprüfung von je neun zufällig gezogenen Seiten beider Arten zeigt saubere Blattkanten und geradere Zeilen, nirgends ist Text abgeschnitten. Vor der Tintenprüfung außerhalb des Blatts (siehe ADR) schnitt die Blattsuche auf mehreren GNHK-Seiten an einem Schatten, einer zweiten Seite oder einem Planer ab; auf diesen Seiten lag außerhalb 0,64- bis 1,72-mal so viel Tinte wie innen, auf richtig gefundenen Blättern höchstens das 0,2-Fache.

### Laufzeit

Apple M4 Pro, Node, CPU-Zeit je Seite, Median aus drei Läufen, Maschine mit anderen Sitzungen belastet (Last 10 bis 17). Planen auf 1200 px wie beim Import, Anwenden auf 2048 px wie beim Zeichnen für Erkennung und Overlay.

| Satz                     | Seiten | Planen, Median | Planen, höchstens | Anwenden, Median | Anwenden, höchstens |
| ------------------------ | ------ | -------------- | ----------------- | ---------------- | ------------------- |
| Gerenderte Fotos         | 48     | 49 ms          | 94 ms             | 41 ms            | 47 ms               |
| GNHK liniert             | 61     | 55 ms          | 122 ms            | 62 ms            | 98 ms               |
| ScaDS (Scans, kein Plan) | 77     | 25 ms          | 42 ms             | –                | –                   |

In WebKit (Playwright, 12 gerenderte Fotos, Wanduhrzeit, Last um 12) braucht Planen im Median 129 ms (höchstens 305 ms), Anwenden 167 ms (höchstens 255 ms). Chromium liegt bei 31 und 35 ms.

Geplant wird einmal je Seite beim Import im Worker. Angewandt wird bei jedem Zeichnen der Seite (Vorschau, Erkennung, Zeilen, Export), dazu kommt das Dekodieren des Bildes wie bisher.

### Grenzen

- **Simulierte Fotos:** Die Wölbung im Renderer ist mild und gleichmäßig. Echte Seiten nahe der Bindung wölben sich stärker und ungleichmäßig.
- **Blankes Papier:** Ohne Blattkante und ohne Heftlinien gibt es kein Maß für die Verzerrung, solche Fotos bleiben, wie sie sind.
- **Nur gedreht:** Ein Foto ohne sichtbaren Tisch, das nur gedreht ist, wird nicht begradigt, sonst würden schief eingelegte Scans gedreht.
- **Rückrechnung in der Messung:** Für den Vergleich mit den Wahrheitsboxen wird die Hülle der zurückgerechneten Box genommen. Bei starker Perspektive ist sie etwas größer als die Box im Foto, das kostet eher Treffer, als dass es welche schenkt.

Nachbauen (Pfade nach Bedarf):

```bash
eval/.venv/bin/python -I eval/samples/render.py --heft photo --seed 1 --out <Ordner>
node --experimental-transform-types eval/heft-measure.ts --ideal --dewarp --images <Ordner>/images \
  --truth <Ordner>/ground_truth --lines <Ordner>/lines --out <Ergebnisse>/nachher.json --no-wer
node --experimental-transform-types eval/strike.ts --ocr <ideal.json> --images <Ordner>/images --truth <Ordner>/ground_truth --method ink --dewarp
node --experimental-transform-types eval/dewarp-pages.ts <Ordner>/images <Ordner-begradigt>
```

## Phase 2: Randzeichen

Ziel: Randzeichen stehen im Heftrand, wenn die Seite einen hat, und nie über dem Text. `layoutOverlay` bekommt dazu die Randlinien aus `ruling.margins` ([ADR 0003](../adr/0003-overlay.md#heftrand-ergänzung-vom-2026-10-23)).

### Ergebnis

- Auf allen Papieren mit gezeichnetem Rand (`liniert`, `kariert`, Scan und begradigtes Foto) stehen die Randzeichen jetzt im Heftrand: **99,5 % statt 41,6 %** (634 Randzeichen, 96 Seiten, vier Zufallssätze). Auf den Scans von 6,0 bis 26,6 % auf 98,3 bis 100 %.
- Über dem Text steht kein Randzeichen mehr (0,0 % statt 7,9 %), gemessen mit der groben Breite aus Phase 1, die Breite der Schrift überschätzt. Mit dem Breitenmodell der Schrift (`estimateTextWidth`) waren es vorher schon 0,0 %.
- Papier ohne Rand (`liniert-eng`) und Seiten, auf denen keine Randlinie erkannt wird, bleiben unverändert. Die 2,2 bis 4,3 % „über Text“ bei `liniert-eng` sind das alte Verhalten.
- Die Demo-Klasse im e2e-Test prüft jetzt, dass jedes Randzeichen rechts von der Randlinie der Seite steht und keine Zeilenbox überdeckt. Ohne die Randlinien schlägt der Test fehl.

### Methode

- **Seite:** Rechts hat Vorrang, links nur ohne rechte Randlinie oder bei weniger als 0,3 Zeilenhöhen Platz. Eine belastbare Quelle zur Seitenwahl gibt es nicht. Die Suche fand keine bundesweite Norm und nur den Hinweis, dass Lehrkräfte Korrekturzeichen am Rand setzen und mit Randkommentaren ergänzen ([Friedrich Verlag](https://www.friedrich-verlag.de/deutsch/grammatik/deutschunterricht-korrekturzeichen-und-randkommentare/), [Standardsicherung NRW](https://standardsicherung.schulministerium.nrw.de/cms/zentralabitur-wbk/faecher/getfile.php?file=3316)). Rechts ist die Konvention des Korrekturrands, keine Messung.
- **Ausweichen:** Die Zeilenboxen sind Hindernisse. Ragt Text in die Spalte, rückt das Randzeichen dahinter (links davor), höchstens dreimal. Passt auch dann nichts bei mindestens 40 % der Zeilenhöhe, gilt das alte Verhalten (Spalte aus der Textausdehnung, kleinere Schrift).
- **Messung:** `eval/heft-measure.ts --ideal --dewarp --marks` auf den gerenderten Heftseiten (`heft-gerendert` und `heft-strich-s1` bis `s3`, je 24 Seiten: Scans und Fotos, drei Papiere), ideale Transkripte, Gemma 4 E2B für die Marken. Dasselbe korrigierte Transkript wird zweimal gelegt, einmal ohne Randlinien (vorher) und einmal mit (nachher), so unterscheiden sich die Zahlen nur im Layout. Für Fotos liegen Boxen und Randlinien im Koordinatensystem des Originalfotos (`toSource`), die Wahrheit ebenfalls. `--transcripts <Ordner>` merkt sich die korrigierten Transkripte, damit eine neue Layoutversion ohne Modell nachgemessen werden kann.
- **Maß:** „Im Rand“ zählt ein Randzeichen, das links der linken oder rechts der rechten Randlinie der Wahrheit steht. „Über Text“ zählt es, wenn sein Kasten eine Wahrheitsbox schneidet. Die Breite ist einmal 0,55 em je Zeichen (wie Phase 1, überschätzt Kürzel mit Doppelpunkt und Korrektur um bis zu 60 %), einmal die Breite aus `estimateTextWidth`, mit der auch `layoutOverlay` plant.

### Vorher und nachher

Randzeichen auf Seiten mit gezeichnetem Rand, grobe Breite (wie Phase 1):

| Papier und Aufnahme   | Randzeichen | im Rand vorher | im Rand nachher | über Text vorher | über Text nachher |
| --------------------- | ----------- | -------------- | --------------- | ---------------- | ----------------- |
| kariert, Foto         | 162         | 69,6 %         | 100,0 %         | 4,4 %            | 0,0 %             |
| kariert, Scan         | 172         | 26,6 %         | 98,3 %          | 20,1 %           | 0,0 %             |
| liniert, Foto         | 144         | 63,9 %         | 100,0 %         | 1,4 %            | 0,0 %             |
| liniert, Scan         | 156         | 6,0 %          | 100,0 %         | 5,3 %            | 0,0 %             |
| mit gezeichnetem Rand | 634         | 41,6 %         | 99,5 %          | 7,9 %            | 0,0 %             |
| liniert-eng, Foto     | 140         | n. a.          | n. a.           | 4,3 %            | 4,3 %             |
| liniert-eng, Scan     | 134         | n. a.          | n. a.           | 2,2 %            | 2,2 %             |

Mit dem Breitenmodell: im Rand 51,2 % → 99,7 % (alle Papiere mit Rand), über Text 0,0 % → 0,0 %. Bei `liniert-eng` gibt es keinen gezeichneten Rand, die Werte „im Rand“ sind dort nicht zu lesen.

Je Satz (Papiere mit gezeichnetem Rand, grobe Breite):

| Satz             | Randzeichen | im Rand vorher | im Rand nachher | über Text vorher | über Text nachher |
| ---------------- | ----------- | -------------- | --------------- | ---------------- | ----------------- |
| `heft-gerendert` | 133         | 53,1 %         | 100,0 %         | 8,6 %            | 0,0 %             |
| `heft-strich-s1` | 166         | 43,3 %         | 99,4 %          | 8,9 %            | 0,0 %             |
| `heft-strich-s2` | 164         | 36,8 %         | 100,0 %         | 6,5 %            | 0,0 %             |
| `heft-strich-s3` | 171         | 35,5 %         | 98,8 %          | 7,8 %            | 0,0 %             |

### Grenzen

- Die Messung nimmt ideale Transkripte. Mit echter Erkennung ändert sich nur, welche Marken es gibt, nicht die Platzierung.
- Ausgewichen wird den Zeilenboxen, nicht der Tinte. Eine Handschrift, die weit über die Zeilenbox hinausragt, kann ein Randzeichen trotzdem berühren.
- Schmale Ränder (rund eine Zeilenhöhe, wie auf den Demo-Karoseiten) nehmen nur kurze Kürzel in kleiner Schrift. Lange Korrekturen wandern dort als „R: dass“ in dieselbe Spalte und werden klein.
- Liegen Text und Randlinie so, dass auch die kleinste Schrift nicht passt, gilt wieder das alte Verhalten. Das kam auf den Messseiten bei 0,5 % der Randzeichen vor.
- Die Seite wird nicht je Arbeit gewählt. Wer links korrigiert, sieht die Zeichen rechts.

## Demo-Daten

`pnpm dev:web` bietet „Demo-Klasse laden“ (leere Klasse und „…“-Menü). Die Klasse besteht aus vier Arbeiten mit fünf selbst gerenderten Scans (`eval/samples/demo-class.py`, fester Seed, rund 1 MB) auf liniertem und kariertem Papier, mit gestrichenen Wörtern und eingebauten Fehlern. Der Demo-Transkribierer erkennt diese Seiten und liefert ihr Transkript, die Demo-Korrektur den passenden korrigierten Text, sodass Text, Zeilen, Marken und Randzeichen zum Bild passen. Andere Bilder behalten den bisherigen Platzhaltertext. Die Foto-Seiten fehlen noch, weil ihre Zeilenzuordnung nicht gelöst ist. Die e2e-Suite prüft, dass jede Marke auf ihrer Zeile liegt (`e2e/demo-klasse.spec.ts`). Im Produktions-Build ist nichts davon enthalten.

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

## Zweite Suche

Ziel: die Lücke „echte deutsche Handschrift, möglichst auf Heftpapier“ schließen oder belegen, dass es sie nicht frei gibt. Ergebnis: **Eine freie Quelle mit ganzen, transkribierten Seiten aus deutschen Schulheften gibt es nicht.** Gefunden wurden deutsche Zeilen mit Transkript (Erwachsenenschrift auf weißem Papier) und echte Papierfotos ohne Schrift. Beides zusammen deckt die Teile ab, die der Renderer nicht kann.

| Quelle                                                                               | Inhalt                                                                                               | Umfang                                       | Schreiber                              | Papier                                          | Aufnahme                                             | Transkript   | Format                 | Urteil                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------- | ----------------------------------------------- | ---------------------------------------------------- | ------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fhswf/german_handwriting` (Hugging Face, AFL-3.0)                                   | Stichworte und kurze Sätze aus Mitschriften von Schule und Hochschule                                | 10 854 Zeilen, 1,8 GB Parquet                | 15 Erwachsene (laut Karte)             | meist weiß, teils Heftlinie oder Kante sichtbar | Handyfoto, zugeschnittene Zeile (rund 3000 × 500 px) | ja, je Zeile | Parquet, Bild und Text | aufgenommen: 300 gleichmäßig gezogene Zeilen als `fhswf-zeilen` (13 MB), geladen über die Zeilen-API, damit kein Parquet-Leser nötig ist                             |
| `finnbusse/handwriting-*` (Hugging Face, MIT)                                        | Stiftbahnen (dx/dy/eos) einzelner deutscher Wörter und englischer Testsätze, keine Bilder von Papier | 44 bis 267 Downloads, Dateien 1 bis 11 MB    | eine Handvoll, Tablet                  | –                                               | Stiftdaten                                           | ja           | JSONL                  | nicht brauchbar: Onlineschrift statt Scan oder Foto                                                                                                                  |
| Wikimedia Commons                                                                    | Kategorien „Exercise book from Germany“, „Graph paper in Germany“, „Lined paper“                     | rund 30 Fotos von Heften und leeren Blättern | Kinder (historische Seiten)            | liniert, kariert, Millimeter                    | Foto                                                 | nein         | JPEG                   | aufgenommen: vier leere Blätter (`papers/`) und zwei beschriebene Seiten von 1929 und 1953 (`pages/`, Kurrent, nur Gegenprobe), alle CC BY, CC BY-SA oder gemeinfrei |
| Hugging Face allgemein (Suche `handwriting`, `german`, `school notebook`, `kurrent`) | u. a. `ai-forever/school_notebooks_RU/EN`, Kurrent-Sätze aus Bern und der Hanse                      | –                                            | –                                      | liniert (RU)                                    | Scan                                                 | ja           | Parquet                | kein weiterer deutscher moderner Satz. Die Kurrent-Sätze sind historisch, die Schulhefte russisch und englisch                                                       |
| Zenodo                                                                               | ICDAR-READ, Semper, Basler Ratsbücher, ScaDS                                                         | –                                            | Schreiber des 15. bis 19. Jahrhunderts | –                                               | Scan                                                 | ja           | –                      | nur historisch, außer ScaDS (schon genutzt)                                                                                                                          |
| Kaggle                                                                               | –                                                                                                    | –                                            | –                                      | –                                               | –                                                    | –            | –                      | ohne Konto nicht durchsuchbar, die API liefert eine leere Liste; nicht geladen                                                                                       |
| Litkey-Korpus                                                                        | Schülertexte Klassen 2 bis 8                                                                         | –                                            | Kinder                                 | –                                               | –                                                    | nur Text     | –                      | `korpus-litkey.de` nicht erreichbar, Wayback Machine ohne Kopie, nicht auf Zenodo oder Hugging Face                                                                  |

Neu unter `~/.cache/rotstift/datasets/`: 120 MB (`_raw/fhswf`, `_raw/commons`, `fhswf-zeilen`, `commons-heft`), das Limit von 3 GB zusätzlich ist weit unterschritten. Die Parquet-Dateien wurden nach einer ersten Sichtung wieder gelöscht.

### Erkennung auf `fhswf-zeilen`

GLM-OCR Q8 wie in der App, Bilder auf 1152 px, 4 Threads, 300 Zeilen mit 1807 Wörtern.

| Satz                                           | Bilder | Wörter | WER    | CER   | AUC  | Kalibrierungsfehler |
| ---------------------------------------------- | ------ | ------ | ------ | ----- | ---- | ------------------- |
| `fhswf-zeilen` (Zeilen, Erwachsene, Handyfoto) | 300    | 1807   | 30,3 % | 9,3 % | 0,87 | 0,05                |
| ScaDS-Scans (ganze Seiten, Erwachsene, Scan)   | 6      | 603    | 20,9 % | 6,2 % | 0,90 | –                   |
| Gerenderte Heftseiten                          | 12     | 1434   | 4,5 %  | 1,0 % | 0,98 | –                   |

- Die Lesesicherheit trägt auch hier: Wörter mit Sicherheit unter 0,5 sind zu 70 % falsch, ab 0,99 nur zu 2 %. 31 % der Wörter liegen über 0,99 und tragen nur 2 % der Fehler bei. Anders als auf den GNHK-Fotos (17 % falsch bei ≥ 0,99) gibt es hier kein Hochvertrauens-Problem.
- Die WER ist höher als auf ScaDS, aber nicht vergleichbar: Die Zeilen sind kurz (6 Wörter), oft Stichworte ohne Satzzusammenhang, die Schrift ist deutlich flüchtiger, und ein Fehler wiegt bei 6 Wörtern schwer.
- Strichsuche: 0,06 Alarme je 100 Wörter, praktisch keine Fehlalarme.
- Grenze: Es sind Zeilen auf weißem Papier. Zeilenzuordnung und Heftlinien lassen sich damit nicht messen, und die Schreiber sind Erwachsene.

### Gerenderte Seiten auf echtem Papier

`render.py --heft --paper-image` mit `kariert-5mm-foto` (Commons, Foto mit Lochung und Falz, Gitter 5 mm, Zeilen bei TOP 120, PITCH 66, LEFT 220), vier Texte als Scan und Foto, 8 Seiten, 1022 Wörter. Die Geometrie wurde nach Augenmaß gesetzt.

| Aufnahme | Seiten | WER   | Zeilen mit Box | Box trifft | Box sicher falsch |
| -------- | ------ | ----- | -------------- | ---------- | ----------------- |
| Foto     | 4      | 6,5 % | 100,0 %        | 61,0 %     | 3,7 %             |
| Scan     | 4      | 2,7 % | 100,0 %        | 41,9 %     | 19,8 %            |
| alle     | 8      | 4,6 % | 100,0 %        | 51,2 %     | 11,9 %            |

Die Erkennung bleibt auf echtem Karopapier bei 4,6 % WER (gezeichnetes Kariert: 2,1 bis 3,8 %). Die Zeilenzuordnung ist dagegen auf dem echten Blatt deutlich schwächer als auf dem gezeichneten (Scan 42 % statt 88 % Treffer, 20 % sicher falsch), obwohl das Bild nur leicht gedreht ist. Das Blatt hat Falz, Lochung, eine dicke Hauptlinie und Gitterlinien, die schräg laufen. Ein Teil der Abweichung kann an der geschätzten Geometrie liegen (die Wahrheitsboxen sitzen dann leicht neben den Zeilen), die Stichprobe ist klein. Es ist ein Hinweis, dass der gezeichnete Heftpapier-Test die Linienprobleme eher unterschätzt.

### Schluss

- Für Deutsch gibt es frei weiter nur Erwachsenenschrift (ScaDS, fhswf) und gerenderte Kinderschrift. Echte Kinderhandschrift auf Heftpapier mit Transkript bleibt eine Lücke, die sich nur mit eigenen, selbst geschriebenen Mustern oder einer Genehmigung (Litkey, Schulen) schließen lässt.
- `fhswf-zeilen` taugt als zusätzlicher Test der Lesesicherheit auf flüchtiger Handschrift, `commons-heft/papers` als echter Hintergrund für den Renderer. Die beiden Kurrent-Seiten sind nur Fotos echter Hefte als Gegenprobe für Papier und Licht.
