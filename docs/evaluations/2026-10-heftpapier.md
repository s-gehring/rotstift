# Evaluation: Heftpapier und Handyfotos (Oktober 2026)

Frage: Wie gut kommt Rotstift mit echten Schulheften zurecht, also mit linierten und karierten Seiten, Rand, Spiralbindung und Fotos vom Handy? Bisher wurden Erkennung, Zeilenzuordnung ([ADR 0004](../adr/0004-zeilenpositionen.md)) und Strichsuche ([Durchgestrichenes](2026-10-durchgestrichen.md)) auf weißem Papier und auf ScaDS-Scans gemessen. Dieser Bericht beschafft Testdaten, baut einen Renderer für Heftpapier und misst, was an der Pipeline bricht. Geändert wird an der App nichts (Phase 1), die Lösungsvorschläge sind Phase 2.

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

| Satz                                                 | Seiten | Wörter | WER    | CER   | Zeilen mit Box | Box trifft | Marken je 100 Wörter | Markenzeile richtig | Striche auf der Zeile |
| ---------------------------------------------------- | ------ | ------ | ------ | ----- | -------------- | ---------- | -------------------- | ------------------- | --------------------- |
| ScaDS-Scans                                          | 6      | 603    | 20,9 % | 6,2 % | 100,0 %        | –          | 11,9                 | –                   | –                     |
| Früher gerenderte Seiten (`samples/`, weißes Papier) | 4      | 478    | 0,6 %  | 0,1 % | 100,0 %        | 100,0 %    | 9,0                  | 100,0 %             | 100,0 %               |
| Heftpapier, alle (Scans und Fotos)                   | 12     | 1434   | 4,5 %  | 1,0 % | 89,5 %         | 48,9 %     | 10,0                 | 57,5 %              | 61,7 %                |

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
2. **`locateLines` meldet keine Mehrdeutigkeit, wenn es falsch liegt.** Die Boxen auf Fotos sind überwiegend „sicher falsch“, nicht `null` (z. B. 93 % bei `liniert-photo`). Nutzer sehen so Marken an falscher Stelle statt einer ehrlichen Rückfallanzeige (Wirkung: falsch platzierte Marken).
   Lösungsvorschlag: Ein Plausibilitätsmaß für die Zuordnung (Abstand der Boxen zu den gefundenen Heftlinien, Anteil des Textes in den Boxen) und unterhalb einer Schwelle `null`.
3. **Absturz bei Kariert-Foto.** `locateLines` wirft `RangeError`; mit Trapez-Eingabe erneut.
   Lösungsvorschlag: Absturz reproduzieren (`brief--kariert-photo` aus `render.py --heft`), Indexprüfung in der Bandsegmentierung ergänzen, Regressionstest mit gerendertem Foto.
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
