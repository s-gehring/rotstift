# Evaluation: Durchgestrichenes (Oktober 2026)

Frage: Wie geht die Texterkennung mit durchgestrichenen Wörtern um, und wie erkennt Rotstift sie, damit sie nicht mitgezählt und nicht korrigiert werden? Verglichen werden (a) ein Prompt, der Gestrichenes kennzeichnen oder weglassen lässt, (b) eine Analyse der Tinte je Wort mit den Zeilenpositionen aus [ADR 0004](../adr/0004-zeilenpositionen.md) und (c) beides zusammen.

## Ergebnis

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

| Prompt                                                              | erkannt | abgeschrieben | ausgelassen | Wortzahl daneben je Seite | WER   |
| ------------------------------------------------------------------- | ------- | ------------- | ----------- | ------------------------- | ----- |
| `Text Recognition:` (Registry)                                      | 0       | 49            | 15          | 3,13 (2,4 %)              | 7,4 % |
| … `Mark crossed-out words with <del></del>.`                        | 0       | 49            | 15          | 3,06 (2,4 %)              | 7,4 % |
| … mit `~~` statt `<del>`                                            | 0       | 49            | 15          | 3,06 (2,4 %)              | 7,3 % |
| … `Omit crossed-out words.`                                         | 0       | 49            | 15          | 3,06 (2,4 %)              | 7,3 % |
| Deutsche Anweisung, Gestrichenes in `<del>`                         | 0       | 47            | 17          | 3,00 (2,3 %)              | 7,3 % |

GLM-OCR ist auf die festen Aufgaben „Text Recognition:“, „Formula Recognition:“ und „Table Recognition:“ trainiert und folgt freien Anweisungen nicht. Die Lesegenauigkeit ändert sich mit keiner Variante, aber es gibt auch nichts zu gewinnen.

QWEN_PLACEHOLDER

### Tinte (b)

`findStruckWords` in `src/layout/strike.ts` arbeitet auf dem Seitenbild und den Zeilen des Transkripts:

1. `locateLines` liefert die Box jeder Zeile, die Tinte wird wie in `ink.ts` binarisiert und entzerrt.
2. Je Zeile bestimmt das Zeilenprofil die Kernzone (x-Höhe).
3. Gesucht werden Striche: Durchgehende Tinte entlang leicht geneigter Geraden in der Mitte der Kernzone, mindestens dreimal so lang wie die x-Höhe, mit Tinte darüber und darunter auf mindestens 30 % der Länge (der Strich kreuzt Buchstaben) und zu 80 % genau auf der Geraden.
4. Die Tinte der Zeile ohne die Striche zerfällt an Lücken in Wörter. Ein Tintenwort gilt als gestrichen, wenn ein Strich die Hälfte seiner Breite deckt.
5. Eine Zuordnung nach Wortbreiten (dynamische Programmierung mit den Zeichenbreiten aus dem Overlay) überträgt das auf die Wörter des Transkripts.

Gerenderte Seiten, Transkript von GLM-OCR:

| Strich            | gestrichen | erkannt | abgeschrieben, nicht erkannt | von GLM-OCR ausgelassen |
| ----------------- | ---------- | ------- | ---------------------------- | ----------------------- |
| Ein Strich        | 32         | 18      | 8                            | 6                       |
| Zwei Striche      | 16         | 9       | 2                            | 5                       |
| Gekritzel         | 16         | 6       | 6                            | 4                       |
| **Gesamt**        | **64**     | **33**  | **16**                       | **15**                  |

| Messung                              | ohne Tinte   | mit Tinte    |
| ------------------------------------ | ------------ | ------------ |
| Fehlalarme gerendert (2044 Wörter)   | 0            | 7 (0,3 %)    |
| Fehlalarme ScaDS (7556 Wörter)       | 0            | 6 (0,08 %)   |
| Wortzahl ScaDS daneben je Seite      | 1,38         | 1,40         |
| Wortzahl gerendert                   | 2094 (+2,4 %) | 2054 (+0,5 %) |
| Wortzahl daneben je Seite            | 3,13         | 1,13         |
| WER ohne Gestrichenes                | 7,4 %        | 5,9 %        |
| Zeit je Seite (Mac, M4 Pro)          | –            | 0,11 bis 0,15 s |

Nicht erkannt werden vor allem kurze Wörter (der Strich ist kürzer als dreimal die x-Höhe), Striche, die über oder unter der Kernzone liegen, und Gekritzel. Ein Merkmal für Gekritzel (Dichte der Richtungswechsel) trennte auf echter Handschrift nicht von normaler Schrift und ist deshalb nicht eingebaut. Die 7 Fehlalarme sind fast alle das Nachbarwort eines gestrichenen Wortes („~~Üer~~ Über“, „~~Dnan~~ dann“): Der Strich ragt hinein, oder die Zuordnung verrutscht, weil GLM-OCR das gestrichene Wort verlesen oder mit dem Nachbarn verschmolzen hat. Auf ScaDS sind die 6 Fehlalarme lange Verbindungs- und Querstriche der Schreibschrift (etwa der Anstrich von „öffentlichen“ oder der f-Strich in „Schiffs“), 4 davon auf einer Seite (044). Eine echte Streichung ist nicht darunter. Sie senken die Wortzahl um 6 (7624 statt 7630, richtig wären 7556), an ihrer Genauigkeit ändert das kaum etwas (im Mittel 1,40 statt 1,38 Wörter je Seite daneben, die Abweichung kommt von Lesefehlern).

Die Schwellen sind auf denselben Seiten abgestimmt, die Zahlen sind also eher optimistisch. Strenger eingestellt (Kreuzung 0,4, Genauigkeit 0,85) erkennt das Verfahren 26 statt 33 Wörter bei 6 statt 7 Fehlalarmen.

### Kombination (c)

Da GLM-OCR nichts kennzeichnet, ist die Kombination gleich der Tinte allein. Mit einem Modell, das `<del>` setzt, ließen sich beide Quellen vereinen (`eval/strike.ts --method both`).

## Was eingebaut ist

- `withStruckWords` (`src/pipeline/struck-words.ts`) hängt nach jeder erfolgreichen Erkennung die Strichsuche an. Sie läuft im Layout-Worker, scheitert sie, bleibt das Transkript unverändert. Gefundene Wörter werden im gespeicherten Text als `~~Wort~~` markiert.
- Wortzahl (`computeStatistics`, `countPageWords`) zählt Gestrichenes nicht.
- `correctPage` gibt dem Korrekturmodell nur den sichtbaren Text und rechnet die Marken auf den vollen Text zurück. Das Transkript trägt die gestrichenen Stellen im Feld `struck` und als `<rs-struck>` im HTML.
- Die Oberfläche ist unverändert. Im Texteditor sind die `~~` sichtbar.

## Grenzen und nächste Schritte

- Gekritzel, Überschreibungen und kurze gestrichene Wörter werden meist nicht erkannt. Eigene Handschriftseiten mit echten Streichungen fehlen, die Messung beruht auf gerenderten Strichen.
- Die Information steht als `~~` im Text. Eine Anzeige in der Prüfansicht (etwa grau durchgestrichen) wäre der nächste Schritt für die Oberfläche.
- Zeichnet das Overlay Marken an Wörtern neben einer Streichung, liegt die Position richtig, weil die Marken auf den vollen Zeilentext zurückgerechnet werden.

## Reproduktion

Befehle in [eval/README.md](../../eval/README.md#durchgestrichenes). Die Prompt-Varianten mit `ocr-run.ts --prompt`, die Tinte mit `strike.ts --method ink`.
