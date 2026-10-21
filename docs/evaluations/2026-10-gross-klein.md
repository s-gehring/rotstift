# Evaluation: Falsche Kleinschreibung und zu viele Hinweise „unsicher gelesen“ (Oktober 2026)

Frage: Warum schlägt das Korrekturmodell im Praxistest (Fach Deutsch, drei Seiten aus dem ScaDS.AI-Datensatz als PDF) auf Seite 2 vor, korrekt großgeschriebene Substantive und Namen kleinzuschreiben, und warum erscheinen dort so viele Hinweise „unsicher gelesen“? Und wie lässt sich beides senken, ohne echte Fehler zu verlieren?

## Ergebnis

**Ursache der falschen Kleinschreibung ist eine Modellgrenze von Gemma 4 E2B: Auf manchen Seiten kippt die Ausgabe mitten im Text in durchgehende Kleinschreibung, auch an Satzanfängen.** Auf Seite 2 schreibt Gemma nach rund einem Dutzend Wörtern 36 großgeschriebene Wörter klein, darunter alle Satzanfänge danach. Daraus werden 4 rote R-Marken und 11 Hinweise, die nur aus Kleinschreibung bestehen, dazu lange Ausdrucksmarken, in denen die Kleinschreibung mit echten Änderungen vermischt ist. Prompt und Profil sind nicht die Ursache, die Zeilenform auch nicht: GLM-OCR liefert die Seite zwar als eine einzige Zeile mit 715 Zeichen, aber nach einem Umbruch auf höchstens 60 Zeichen kippt Gemma an derselben Stelle. Auf allen 76 auswertbaren ScaDS-Seiten kippt Gemma auf 2 Seiten, auf den 16 gerenderten Schülertexten auf keiner.

**Eingebaut ist ein Filter in `deriveMarks`, der die Kleinschreibung zurücknimmt, wenn Gemma gekippt ist.** Gekippt heißt: Gemma schreibt einen Satzanfang klein (das ist nie eine Korrektur), oder im Deutschen mehr als ein Viertel der großgeschriebenen Wörter im Satzinneren, mindestens zwei. Dann erhalten alle kleingeschriebenen Wörter wieder ihren ersten Buchstaben aus dem Original, andere Änderungen im selben Wort bleiben („Schifen“ → „schiffen“ wird „Schiffen“). Einzelne Kleinschreibungen wie „Er ist Schnell“ → „schnell“ bleiben unberührt. Auf Seite 2 verschwinden alle falschen R-Marken, auf den Schülertexten geht kein Fehler verloren.

**Die vielen Hinweise kommen vor allem von geratenen Wörtern.** Ein Hinweis entsteht, wenn Gemma ein Wort ändert, das GLM-OCR unsicher gelesen hat. Auf fehlerfreier Erwachsenenschrift ist jeder dieser Hinweise überflüssig, auf den gerenderten Schülertexten treffen 40 von 103 einen echten Fehler. Alle 40 Treffer sind Rechtschreibung, Grammatik oder Zeichensetzung, bei Rechtschreibung mit höchstens einem Zeichen Abstand. Keiner ist eine Ausdrucksmarke. Auf ScaDS sind dagegen 207 von 760 Hinweisen Ausdrucksmarken (Gemma ersetzt ein unleserliches Wort durch ein anderes oder formuliert um) und 377 ändern mehr als zwei Zeichen.

**Eingebaut ist deshalb: Ein Hinweis erscheint nur, wenn er plausibel ist** (`isPlausibleHint` in `src/correction/uncertain-reading.ts`). Hinweise der Art Ausdruck oder Wortwahl (A, W, voc) entfallen, Rechtschreib-Hinweise nur bei höchstens zwei Zeichen Abstand. Grammatik, Zeichensetzung und Satzbau bleiben. Die Grenze liegt bei zwei statt einem Zeichen, weil echte Schülerfehler wie „heftich“ → „heftig“ oder „ausserdem“ → „außerdem“ zwei Zeichen Abstand haben. Rote Marken auf sicher gelesenen Wörtern sind nicht betroffen.

| Messung                                                              | vorher                             | nachher                          |
| -------------------------------------------------------------------- | ---------------------------------- | -------------------------------- |
| Praxistest, Seite 2: rote Marken                                     | 6, davon 4 falsche Kleinschreibung | 4, keine falsche Kleinschreibung |
| Praxistest, Seite 2: „unsicher gelesen“                              | 17                                 | 5                                |
| Praxistest, 3 Seiten (292 Wörter): rote Marken                       | 9                                  | 7                                |
| Praxistest, 3 Seiten: „unsicher gelesen“ je 100 Wörter               | 12,7 (9,3–17,0)                    | 6,2 (3,9–9,5)                    |
| ScaDS, 76 Seiten (7525 Wörter): rote Marken je 100 Wörter            | 1,7 (1,5–2,0)                      | 1,7 (1,4–2,0)                    |
| ScaDS, 76 Seiten: „unsicher gelesen“ je 100 Wörter                   | 10,2 (9,5–10,9)                    | 6,2 (5,7–6,8)                    |
| Gerenderte Schülertexte (16 Seiten, 2041 Wörter): Recall rote Marken | 60 % (52–67)                       | 60 % (52–67)                     |
| Gerenderte Schülertexte: Recall mit Hinweisen                        | 86 % (79–90)                       | 86 % (79–90)                     |
| Gerenderte Schülertexte: „unsicher gelesen“ je 100 Wörter            | 5,0 (4,2–6,1)                      | 4,2 (3,4–5,1)                    |
| Profil Deutsch, getippt: Recall / Präzision                          | 86,0 % / 97,4 %                    | 86,0 % / 97,4 %                  |
| Profil Deutsch, getippt: Fehlalarme je 100 Wörter fehlerfrei         | 0,0                                | 0,0                              |
| Neue Proben Groß- und Kleinschreibung: Recall / Präzision            | 88,9 % / 84,2 %                    | 88,9 % / 84,2 %                  |

Im Praxistest zählte die App 43 Hinweise auf 292 Wörtern und 22 auf Seite 2. Die Nachstellung kommt auf 37 und 17, weil sie die PDF-Seiten mit Pillow statt mit pdf.js auf 1152 px bringt und GLM-OCR dadurch einige Wörter anders liest. Rote Marken sind es in beiden Fällen 9.

## Gegenproben und Alternativen

- **Beide Filter einzeln** (Praxistest, 3 Seiten, „unsicher gelesen“ je 100 Wörter): Nur Kleinschreibung zurücknehmen 10,3, nur plausible Hinweise 8,6, beides 6,2. Auf ScaDS bringt der Kleinschreibungsfilter allein nur 10,2 → 10,1, weil Gemma selten kippt. Er ist für die seltenen, aber für die Lehrkraft sehr störenden Seiten da.
- **Zeilen vor dem Korrekturmodell auf 60 Zeichen umbrechen** (Seite 2): Gemma kippt trotzdem, 5 statt 6 rote Marken, 13 statt 17 Hinweise. Nicht übernommen.
- **Regel im Prompt** („Substantive, Namen und Satzanfänge werden großgeschrieben. Schreibe ein großgeschriebenes Wort nur klein, wenn es sicher kein Substantiv und kein Name ist.“): Verhindert das Kippen auf Seite 2, aber Gemma formuliert dann mehr um. Auf ScaDS ohne Filter 9,8 Hinweise je 100 Wörter, mit beiden Filtern 6,3 (gegenüber 6,2 ohne die Regel), Recall der roten Marken auf den Schülertexten 59 % statt 60 %, mit Hinweisen 86 %. Kein Gewinn gegenüber den Filtern, nicht übernommen.
- **Andere Profile** (getippt, je Text mit und ohne Fehler, Recall / Präzision / Fehlalarme je 100 Wörter fehlerfrei): Englisch 75,7 % / 70,0 % / 0,6, Französisch 65,9 % / 75,0 % / 0,9, Spanisch 83,7 % / 90,0 % / 0,0, Sachfach 62,5 % / 90,9 % / 0,0, vorher und nachher gleich. Die Viertel-Regel gilt nur für Deutsch, denn in Französisch und Spanisch sind falsch großgeschriebene Wochentage und Nationalitäten typische Fehler, und es gibt außer Namen kaum großgeschriebene Wörter im Satzinneren. Die Satzanfang-Regel gilt für alle Sprachen.

## Grenzen

- **Einzelne falsche Kleinschreibungen bleiben.** Auf ScaDS schreibt Gemma außerhalb der zwei gekippten Seiten 41 großgeschriebene Wörter einzeln klein, etwa Adjektive in Namen wie „das Rote Meer“. Ohne Wortart oder Namensliste lässt sich das nicht von „Er ist Schnell“ unterscheiden. In den neuen Proben ist es einer von drei Fehlalarmen auf 265 Wörtern fehlerfreiem Text.
- **Die Viertel-Grenze trifft auch Schüler, die sehr viele Adjektive und Verben großschreiben.** Die Probe `verein` hat 7 falsch großgeschriebene unter 31 großgeschriebenen Wörtern im Satzinneren (Anteil 23 %), alle 7 werden noch markiert. Ab einem Viertel nimmt der Filter alle zurück.
- **Der Plausibilitätsfilter verwirft auch Hinweise, die zufällig stimmen.** Rät Gemma bei einem unleserlichen Wort das richtige, deutlich andere Wort, erscheint kein Hinweis. Auf den Schülertexten kam das nicht vor, auf echter Schülerschrift ist es noch nicht gemessen.
- **Die gerenderten Schülertexte enthalten nur Fehler mit kleinem Abstand.** Von den 28 eingebauten Rechtschreibfehlern hat einer zwei Zeichen Abstand („heftich“), keiner mehr. Grammatikfehler mit großem Abstand („ist“ → „sei“) bleiben als Hinweis erhalten, weil der Filter Grammatik nicht prüft.

## Proben

- **Praxistest:** Die drei Seiten des PDFs sind die ScaDS-Seiten 020 bis 022 (CC BY 4.0, nicht im Repo). Die Seiten wurden wie in der App auf 1152 px gebracht (hier vergrößert, weil die App PDF-Seiten auf die Zielgröße rendert), mit GLM-OCR (Q8_0) und Lesesicherheit erkannt und mit Gemma 4 E2B (Q4_0, ohne Denken, Prompt aus der Registry) korrigiert.
- **ScaDS:** Alle 77 Seiten, auf 1152 px verkleinert. Auf Seite 023 liefert Gemma nicht alle Zeilen, sie zählt vorher und nachher als ungültig.
- **Gerenderte Schülertexte:** Die vier Texte aus `eval/samples/texts` in vier Handschriften, 43 eingebaute Fehler je Schrift.
- **Getippte Profile:** `eval/profiles.ts` mit den Proben aus `eval/samples`, jeder Text einmal mit Fehlern und einmal korrigiert.
- **Neu: `eval/samples/profiles/gross-klein/`:** Zwei selbst geschriebene Texte mit 12 falsch großgeschriebenen Adjektiven und Verben, 5 kleingeschriebenen Substantiven und Substantivierungen, einem Kommafehler und vielen Orts- und Personennamen.

Mac mini (Apple M4 Pro), 4 bis 8 Threads, nur CPU. Befehle in [eval/README.md](../../eval/README.md#hinweise-unsicher-gelesen-und-groß--und-kleinschreibung). Intervalle sind 95-%-Wilson-Intervalle.
