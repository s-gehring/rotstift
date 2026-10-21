# Evaluation: Durchgestrichenes (Oktober 2026)

Frage: Wie geht die Texterkennung mit durchgestrichenen Wörtern um, und wie erkennt Rotstift sie, damit sie nicht mitgezählt und nicht korrigiert werden? Verglichen werden (a) ein Prompt, der Gestrichenes kennzeichnen oder weglassen lässt, (b) eine Analyse der Tinte je Wort mit den Zeilenpositionen aus [ADR 0004](../adr/0004-zeilenpositionen.md) und (c) beides zusammen.

## Ergebnis

**Zweite Fassung (unten): Die Strichsuche folgt jetzt auch Wellenlinien und Gekritzel und ordnet Striche über ihre Lage im Wort zu. Das senkt die Fehlalarme um drei Viertel, der Recall steigt nur wenig. Das Ziel von 80 % Recall bei 95 % Precision ist nicht erreicht.** Auf 32 zurückgehaltenen Seiten mit 256 gestrichenen Wörtern steigt die Precision von 79,4 % auf 93,5 % (9 statt 33 Fehlalarme), der Recall unter den abgeschriebenen gestrichenen Wörtern von 64,1 % auf 65,7 %. Auf ScaDS sinken die Fehlalarme von 10 auf 4 bei 7556 Wörtern. Die folgenden Absätze beschreiben die erste Fassung.

**GLM-OCR übersieht Streichungen: Es schreibt drei Viertel der gestrichenen Wörter ungekennzeichnet ab und lässt den Rest aus. Kein Prompt ändert das.** Auf 16 gerenderten Seiten mit 64 gestrichenen Wörtern schreibt es 49 ab (38 wörtlich, die übrigen verlesen) und lässt 15 weg. Die Wortzahl liegt dadurch 2,4 % zu hoch. Vier Prompt-Varianten (`<del>`, `~~`, „weglassen“, deutsche Anweisung) markieren kein einziges Wort und lassen das Transkript fast unverändert, 12 von 16 Seiten sind mit der Variante `<del>` Zeichen für Zeichen gleich.

**Die Tinte verrät einfache und doppelte Striche zuverlässig, ohne nennenswerte Fehlalarme.** Gesucht werden lange, fast waagerechte Striche in der Mitte der x-Höhe, die Tinte darüber und darunter kreuzen. Von den 64 gestrichenen Wörtern erkennt das 33, von den 49 abgeschriebenen also zwei Drittel. Fehlalarme: 7 von 2044 normalen Wörtern (0,3 %) auf den gerenderten Seiten und 6 von 7556 (0,08 %) auf den 77 ScaDS-Seiten echter Handschrift. Die Wortzahl liegt danach nur noch 0,5 % zu hoch (1,13 statt 3,13 Wörter je Seite daneben). Das kostet 0,15 s je Seite, gegenüber rund 19 s für die Erkennung.

**Gekritzel und Überschreibungen erkennt Rotstift meist nicht.** Gekritzel kreuzt die Buchstaben nicht als ein gerader Strich, und ein überschriebenes Wort hat gar keinen Strich. Auf ScaDS gibt es dafür ein Beispiel (Seite 011, „der“ von einem anderen Wort überschrieben), das GLM-OCR als „mit der einer Pumpe“ liest und das Rotstift mitzählt.

**Eingebaut ist (b).** Gestrichenes steht im erkannten Text als `~~Wort~~`, zählt nicht, bekommt keine Marke und bleibt im Transkript als Feld `struck` erhalten ([ADR 0002](../adr/0002-korrekturschema.md#durchgestrichenes)). Eine Lehrkraft kann die Markierung im Texteditor setzen oder entfernen.

## Proben

- **Gerendert:** Die 16 Seiten aus `eval/samples/texts` mit vier Handschriften (`render.py --strike 4`, siehe [eval/README.md](../../eval/README.md#durchgestrichenes)). Je Seite sind vier Wörter eingefügt und gestrichen, abwechselnd mit einem Strich, zwei Strichen und Gekritzel. Die Hälfte sind falsch geschriebene Vorgänger des folgenden Wortes („Hasu Haus“), die andere Hälfte zufällige Wörter aus dem Text. Erkannt mit GLM-OCR bei 1152 px, simon-pc mit 8 Threads.
- **ScaDS.AI:** Alle 77 Seiten echter deutscher Handschrift. Die Ground Truth enthält kein Gestrichenes, jedes als gestrichen erkannte Wort ist hier also ein Fehlalarm, solange es nicht tatsächlich gestrichen ist.

## Messergebnisse

### Prompt (a)

GLM-OCR, gerenderte Seiten, 64 gestrichene und 2044 normale Wörter. WER ist die Wortfehlerrate ohne Gestrichenes.

| Prompt                                       | erkannt | abgeschrieben | ausgelassen | Wortzahl daneben je Seite | WER   |
| -------------------------------------------- | ------- | ------------- | ----------- | ------------------------- | ----- |
| `Text Recognition:` (Registry)               | 0       | 49            | 15          | 3,13 (2,4 %)              | 7,4 % |
| … `Mark crossed-out words with <del></del>.` | 0       | 49            | 15          | 3,06 (2,4 %)              | 7,4 % |
| … mit `~~` statt `<del>`                     | 0       | 49            | 15          | 3,06 (2,4 %)              | 7,3 % |
| … `Omit crossed-out words.`                  | 0       | 49            | 15          | 3,06 (2,4 %)              | 7,3 % |
| Deutsche Anweisung, Gestrichenes in `<del>`  | 0       | 47            | 17          | 3,00 (2,3 %)              | 7,3 % |

GLM-OCR ist auf die festen Aufgaben „Text Recognition:“, „Formula Recognition:“ und „Table Recognition:“ trainiert und folgt freien Anweisungen nicht. Die Lesegenauigkeit ändert sich mit keiner Variante, aber es gibt auch nichts zu gewinnen.

Gegenprobe mit Qwen3-VL 4B, der 16-GB-Option, die freien Anweisungen folgt (1536 px, simon-pc, 37 s je Seite):

| Prompt und Verfahren                           | erkannt | abgeschrieben | ausgelassen | Fehlalarme | Wortzahl daneben je Seite | WER   |
| ---------------------------------------------- | ------- | ------------- | ----------- | ---------- | ------------------------- | ----- |
| Registry-Prompt                                | 0       | 40            | 24          | 0          | 2,69 (2,1 %)              | 4,5 % |
| Registry-Prompt plus „Gestrichenes in `<del>`“ | 7       | 38            | 19          | 1          | 2,56 (2,0 %)              | 4,5 % |
| Registry-Prompt, Tinte                         | 20      | 20            | 24          | 9          | 1,38 (1,1 %)              | 3,9 % |
| `<del>`-Prompt und Tinte                       | 20      | 25            | 19          | 5          | 1,63 (1,3 %)              | 4,0 % |

Qwen3-VL setzt `<del>` nur bei 7 von 64 Wörtern, die Lesegenauigkeit bleibt dabei gleich. Die Tinte allein findet mit dem unveränderten Prompt genauso viele, eine Kombination bringt hier also nichts. Qwen lässt mehr gestrichene Wörter von selbst weg als GLM-OCR (24 statt 15).

### Tinte (b)

`findStruckWords` in `src/layout/strike.ts` arbeitet auf dem Seitenbild und den Zeilen des Transkripts:

1. `locateLines` liefert die Box jeder Zeile, die Tinte wird wie in `ink.ts` binarisiert und entzerrt.
2. Je Zeile bestimmt das Zeilenprofil die Kernzone (x-Höhe).
3. Gesucht werden Striche: Durchgehende Tinte entlang leicht geneigter Geraden in der Mitte der Kernzone, mindestens dreimal so lang wie die x-Höhe, mit Tinte darüber und darunter auf mindestens 30 % der Länge (der Strich kreuzt Buchstaben) und zu 80 % genau auf der Geraden.
4. Die Tinte der Zeile ohne die Striche zerfällt an Lücken in Wörter. Ein Tintenwort gilt als gestrichen, wenn ein Strich die Hälfte seiner Breite deckt.
5. Eine Zuordnung nach Wortbreiten (dynamische Programmierung mit den Zeichenbreiten aus dem Overlay) überträgt das auf die Wörter des Transkripts.

Gerenderte Seiten, Transkript von GLM-OCR:

| Strich       | gestrichen | erkannt | abgeschrieben, nicht erkannt | von GLM-OCR ausgelassen |
| ------------ | ---------- | ------- | ---------------------------- | ----------------------- |
| Ein Strich   | 32         | 18      | 8                            | 6                       |
| Zwei Striche | 16         | 9       | 2                            | 5                       |
| Gekritzel    | 16         | 6       | 6                            | 4                       |
| **Gesamt**   | **64**     | **33**  | **16**                       | **15**                  |

| Messung                            | ohne Tinte    | mit Tinte       |
| ---------------------------------- | ------------- | --------------- |
| Fehlalarme gerendert (2044 Wörter) | 0             | 7 (0,3 %)       |
| Fehlalarme ScaDS (7556 Wörter)     | 0             | 6 (0,08 %)      |
| Wortzahl ScaDS daneben je Seite    | 1,38          | 1,40            |
| Wortzahl gerendert                 | 2094 (+2,4 %) | 2054 (+0,5 %)   |
| Wortzahl daneben je Seite          | 3,13          | 1,13            |
| WER ohne Gestrichenes              | 7,4 %         | 5,9 %           |
| Zeit je Seite (Mac, M4 Pro)        | –             | 0,11 bis 0,15 s |

Nicht erkannt werden vor allem kurze Wörter (der Strich ist kürzer als dreimal die x-Höhe), Striche, die über oder unter der Kernzone liegen, und Gekritzel. Ein Merkmal für Gekritzel (Dichte der Richtungswechsel) trennte auf echter Handschrift nicht von normaler Schrift und ist deshalb nicht eingebaut. Die 7 Fehlalarme sind fast alle das Nachbarwort eines gestrichenen Wortes („~~Üer~~ Über“, „~~Dnan~~ dann“): Der Strich ragt hinein, oder die Zuordnung verrutscht, weil GLM-OCR das gestrichene Wort verlesen oder mit dem Nachbarn verschmolzen hat. Auf ScaDS sind die 6 Fehlalarme lange Verbindungs- und Querstriche der Schreibschrift (etwa der Anstrich von „öffentlichen“ oder der f-Strich in „Schiffs“), 4 davon auf einer Seite (044). Eine echte Streichung ist nicht darunter. Sie senken die Wortzahl um 6 (7624 statt 7630, richtig wären 7556), an ihrer Genauigkeit ändert das kaum etwas (im Mittel 1,40 statt 1,38 Wörter je Seite daneben, die Abweichung kommt von Lesefehlern).

Die Schwellen sind auf denselben Seiten abgestimmt, die Zahlen sind also eher optimistisch. Strenger eingestellt (Kreuzung 0,4, Genauigkeit 0,85) erkennt das Verfahren 26 statt 33 Wörter bei 6 statt 7 Fehlalarmen.

### Kombination (c)

Da GLM-OCR nichts kennzeichnet, ist die Kombination gleich der Tinte allein. Mit Qwen3-VL und `<del>`-Prompt erkennt die Kombination 20 Wörter, genauso viele wie die Tinte mit dem unveränderten Prompt (Tabelle oben). Ein eigener Prompt lohnt sich deshalb für keines der beiden Modelle. `eval/strike.ts --method both` misst die Kombination für künftige Modelle.

## Zweite Fassung: Pfadsuche und Zuordnung über Strichspannen

Ziel war, mehr Durchgestrichenes zu finden (80 % Recall), ohne sichtbaren Text fälschlich zu streichen (95 % Precision), bei höchstens 1 s Zusatzzeit je Seite.

### Proben und Messung

- **Gerendert:** `render.py --strike 8` mit vier Arten (ein Strich, zwei Striche, Gekritzel, neu die Wellenlinie) in sechs unabhängigen Sätzen (`--seed 0` bis `5`) zu je 16 Seiten, also 128 gestrichene Wörter je Satz und 32 je Art und Satz. Sätze 0 bis 3 dienten zum Entwickeln und Lernen der Gewichte, Sätze 4 und 5 sind zurückgehalten und nur für die Schlusszahlen gemessen. Erkannt mit GLM-OCR bei 1152 px auf simon-pc.
- **ScaDS.AI:** Alle 77 Seiten echter Handschrift, jedes gestrichene Wort ist ein Fehlalarm.
- **Recall** zählt nur gestrichene Wörter, die GLM-OCR abgeschrieben hat (erkannt geteilt durch erkannt plus ungekennzeichnet abgeschrieben). Was GLM-OCR selbst auslässt, zählt ohnehin nicht und braucht keine Erkennung, das ist rund ein Viertel. **Precision** ist erkannt geteilt durch erkannt plus Fehlalarme. Fehlalarme lassen sich keiner Art zuordnen, Precision gibt es deshalb nur gesamt.
- Die Bewertung ordnet Wahrheit und Transkript über Wortähnlichkeit zu. Neu zählt eine Buchstabenvertauschung als ein Schritt („Grüeß“ und „Grüße“), und bei sonst gleich guten Zuordnungen gewinnt die, in der Gestrichenes auf Gestrichenes trifft. Vorher galt ein als „Grüße“ gelesenes und richtig erkanntes „~~Grüeß~~“ als Fehlalarm.

### Ergebnis je Art

Zurückgehaltene Sätze 4 und 5 (32 Seiten, 256 gestrichene und 4088 normale Wörter):

| Art          | gestrichen | ausgelassen | Recall vorher | Recall nachher |
| ------------ | ---------- | ----------- | ------------- | -------------- |
| Ein Strich   | 64         | 4           | 65,0 %        | 56,7 %         |
| Zwei Striche | 64         | 14          | 66,0 %        | 66,0 %         |
| Gekritzel    | 64         | 28          | 55,6 %        | 69,4 %         |
| Wellenlinie  | 64         | 12          | 67,3 %        | 73,1 %         |
| **Gesamt**   | **256**    | **58**      | **64,1 %**    | **65,7 %**     |

| Messung                             | vorher   | nachher  |
| ----------------------------------- | -------- | -------- |
| Erkannt / abgeschrieben, unerkannt  | 127 / 71 | 130 / 68 |
| Fehlalarme gerendert (4088 Wörter)  | 33       | 9        |
| Precision gerendert                 | 79,4 %   | 93,5 %   |
| Fehlalarme ScaDS (7556 Wörter)      | 10       | 4        |
| Wortzahl gerendert daneben je Seite | 1,75     | 2,16     |
| Zeit je Seite, Mac M4 Pro           | 0,22 s   | 0,25 s   |

Auf den Entwicklungssätzen 2 und 3 ist der Abstand größer: Recall 51,6 % auf 62,6 % (Strich 53,6 auf 50,0 %, zwei Striche 54,2 auf 66,0 %, Gekritzel 58,5 auf 75,6 %, Welle 39,5 auf 62,8 %), Precision 76,4 % auf 95,1 % (30 auf 6 Fehlalarme). Die Gewichte sind auf diesen Seiten gelernt, die Zahlen sind also optimistisch.

Die Wortzahl liegt mit der neuen Fassung etwas weiter daneben, weil weniger Wörter fälschlich gestrichen werden, die vorher zufällig übersehenes Gestrichenes ausglichen.

Die Zeit ist unter Last anderer Sessions gemessen (Lastmittel um 19, fremde `llama-server` liefen). Die CPU-Zeit ist für beide Fassungen gleich (0,20 s je Seite), die Strichsuche selbst braucht rund 5 ms, der Rest ist die Zeilenfindung, die beide Fassungen teilen.

### Korrektur

`strike-correct.ts` korrigiert die zurückgehaltenen Seiten mit Gemma 4 E2B wie in der App und zählt Marken auf tatsächlich gestrichenen Wörtern, also Fehlalarme durch übersehenes Gestrichenes:

| Strichsuche | Marken je 100 Wörter | davon auf Gestrichenem |
| ----------- | -------------------- | ---------------------- |
| keine       | 14,33                | 3,22                   |
| vorher      | 12,25                | 1,14                   |
| nachher     | 12,09                | 1,18                   |

Die Fehlalarme durch Gestrichenes bleiben praktisch gleich (49 statt 47 Marken auf 32 Seiten, eine Seite fiel vorher aus), weil fast genauso viele gestrichene Wörter unerkannt bleiben wie vorher. Was die Strichsuche überhaupt findet, senkt diese Fehlalarme gegenüber keiner Strichsuche auf ein Drittel. Der Gewinn der zweiten Fassung liegt bei den fälschlich gestrichenen Wörtern, die vorher still ihre Fehlermarken verloren.

### Was sich geändert hat

1. **Pfadsuche statt gerader Striche.** Je Zeile sucht eine dynamische Programmierung zusammenhängende Tintenpfade im mittleren Band der x-Höhe (20 bis 80 %), die von Spalte zu Spalte höchstens eine Zeile steigen oder fallen und Lücken von einer Spalte überbrücken. Damit folgt sie Wellenlinien und den flachen Teilen von Gekritzel. Parallele Pfade (Doppelstrich) bleiben getrennt erhalten.
2. **Bewertung je Pfad.** Eine logistische Regression über sechs Merkmale bewertet jeden Pfad: Länge in x-Höhen, Anteil mit Tinte darüber und darunter (der Strich kreuzt Buchstaben), Anteil genau auf Tinte, Abstand der Höhe von der Mitte, Anteil dünner Stellen und Abweichung von einer Geraden. Gelernt auf den gerenderten Sätzen 0 bis 3. Fehlläufe sind vor allem Verbindungsstriche der Schreibschrift nahe der Grundlinie.
3. **Vergleich mit der Seite.** Ein Pfad zählt, wenn er über −1,5 liegt und den Wert, den die besten 10 % der Pfade dieser Seite erreichen, um mindestens 2 übertrifft. Das hält Schriften mit vielen langen Verbindungsstrichen (Schulausgangsschrift) ruhig, ohne saubere Schrift zu bremsen.
4. **Wörter ohne Strich segmentieren.** Tinte auf einem gefundenen Strich zählt nicht für die Wortgrenzen, und ein Tintenwort wird an den Strichenden geteilt, wenn daneben mindestens eine x-Höhe ungestrichen bleibt. Vorher verband der überstehende Strich das gestrichene Wort mit dem Nachbarn, und beide galten als gestrichen.
5. **Zuordnung über Spannen.** Jedes Tintenwort trägt die Spannen seiner Striche. Nach der Zuordnung zu den Wörtern des Transkripts gilt ein Wort als gestrichen, wenn Striche 60 % seiner geschätzten Breite decken, auch wenn ein Tintenwort zwei Wörter des Transkripts umfasst. Ein gestrichenes Tintenwort ohne Gegenstück im Transkript (GLM-OCR hat es ausgelassen) wird billiger übersprungen. Weicht die Zahl der Tintenwörter um mehr als den Faktor 1,5 von der Zahl der Wörter ab, ist die Zeile unsicher verortet und bleibt ohne Markierung.

### Warum das Ziel verfehlt ist

- **Zuordnung als Grenze.** Gibt man der Zuordnung die wahren Strichboxen statt der gefundenen Striche, erreicht sie auf den Entwicklungssätzen 94 % Recall bei 91 % Precision, mit der Sperre für unsicher verortete Zeilen 89 % bei 93 %. Die verbleibenden Fehler entstehen, wenn GLM-OCR das gestrichene Wort auslässt oder mit dem Nachbarn verschmilzt, wenn es ein verschriebenes gestrichenes Wort als das richtige Folgewort liest („Strand ~~enie~~ eine“ wird „Strand eine“), und wenn eine Zeilenbox nur eine von zwei sichtbaren Zeilen deckt. Mit dem Bild allein ist dann nicht zu entscheiden, welches Wort gemeint ist.
- **Strichsuche.** Für rund 15 % der Striche findet die Pfadsuche keinen Kandidaten, meist weil die Zeilenfindung die Zeile nicht sauber verortet. Ein Teil der einfachen Striche fällt durch die Seitenschwelle, besonders auf Seiten in Schulausgangsschrift.
- **Lesesicherheit hilft nicht.** Auf den Entwicklungssätzen 2 und 3 liest GLM-OCR nur 17 % der abgeschriebenen gestrichenen Wörter mit einer Sicherheit unter 0,7 (32 von 186), aber auch 5 % der normalen (221 von 4082). Selbst als Zusatzbedingung zur Tinte trennt das zu schwach. Eine zweite Anfrage je Wortbox an das Erkennungsmodell braucht für jedes Wortbild eine eigene Bildkodierung und Antwort. Bei mehreren Kandidaten je Seite passt das nicht in 1 s auf CPU (nicht gemessen, die ganze Seite dauert 25 bis 70 s).

### Kompromiss

Eingebaut ist der Arbeitspunkt mit der höchsten Precision bei mindestens gleichem Recall wie vorher. Echte Seiten enthalten viel seltener Gestrichenes als die gerenderten (6 % der Wörter), dort bestimmen die Fehlalarme das Bild, und ein fälschlich gestrichenes Wort verliert seine Fehlermarken still. Lockerer eingestellt (`pageMargin` 1,5) wären es auf den zurückgehaltenen Sätzen 73,2 % Recall bei 90,6 % Precision und auf ScaDS 9 Fehlalarme, also so viele wie vorher.

## Was eingebaut ist

- `withStruckWords` (`src/pipeline/struck-words.ts`) hängt nach jeder erfolgreichen Erkennung die Strichsuche an. Sie läuft im Layout-Worker, scheitert sie, bleibt das Transkript unverändert. Gefundene Wörter werden im gespeicherten Text als `~~Wort~~` markiert.
- Wortzahl (`computeStatistics`, `countPageWords`) zählt Gestrichenes nicht.
- `correctPage` gibt dem Korrekturmodell nur den sichtbaren Text und rechnet die Marken auf den vollen Text zurück. Das Transkript trägt die gestrichenen Stellen im Feld `struck` und als `<rs-struck>` im HTML.
- Die Oberfläche ist unverändert. Im Texteditor sind die `~~` sichtbar.

## Grenzen und nächste Schritte

- Rund ein Drittel der abgeschriebenen gestrichenen Wörter bleibt unerkannt, Überschreibungen ganz. Eigene Handschriftseiten mit echten Streichungen fehlen, die Messung beruht auf gerenderten Strichen, und die Gewichte sind auf gerenderten Strichen gelernt.
- Die Zuordnung zum Transkript ist die Grenze (siehe oben). Eine Wortbox je Wort aus der Erkennung würde sie lösen, GLM-OCR liefert keine.
- Die Information steht als `~~` im Text. Eine Anzeige in der Prüfansicht (etwa grau durchgestrichen) wäre der nächste Schritt für die Oberfläche.
- Zeichnet das Overlay Marken an Wörtern neben einer Streichung, liegt die Position richtig, weil die Marken auf den vollen Zeilentext zurückgerechnet werden.

## Reproduktion

Befehle in [eval/README.md](../../eval/README.md#durchgestrichenes). Die Prompt-Varianten mit `ocr-run.ts --prompt`, die Tinte mit `strike.ts --method ink`.
