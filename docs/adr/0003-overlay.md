# 0003: Korrekturen auf die Seite zeichnen

- Status: Angenommen
- Datum: 2026-10-20

## Kontext

Das Text-Modell liefert Markierungen nach [0002](0002-korrekturschema.md), zeilenweise mit Bounding Box. Daraus entsteht die korrigierte Seite: Die Anmerkungen stehen klein und rot wie von einem Feinliner zwischen den Zeilen des Originals. Das Modul `src/overlay/` zeichnet sie und kennt weder Pipeline noch Modelle. Eingabe sind `Transcript`, Seitengröße und Korrekturprofil, Ausgabe eine SVG-Ebene für die Anzeige und ein PNG für den Export.

## Entscheidung

### Notation

Es gibt keine bundesweit einheitlichen Korrekturzeichen, in der Sekundarstufe I meist nicht einmal Vorgaben ([Friedrich Verlag](https://www.friedrich-verlag.de/deutsch/grammatik/deutschunterricht-korrekturzeichen-und-randkommentare/), [Zeichenliste der HU Berlin](https://www3.informatik.hu-berlin.de/sv/lehre/korrekturzeichen.pdf)). Gewählt ist, was an den meisten Schulen üblich ist: Fehler am Wort anzeichnen, Kürzel am rechten Rand.

| Markierung                          | Zeichnung im Text                                      | Darüber           | Am Rand |
| ----------------------------------- | ------------------------------------------------------ | ----------------- | ------- |
| `rs-error`, ein Wort über 4 Zeichen | Dünne, leicht unregelmäßige Unterstreichung            | `fix` als Schrift | Kürzel  |
| `rs-error`, ein Wort bis 4 Zeichen  | Kringel um das Wort                                    | `fix` als Schrift | Kürzel  |
| `rs-error`, mehrere Wörter          | Unterstreichung über die ganze Stelle                  | `fix` als Schrift | Kürzel  |
| `rs-error` mit leerem `fix`         | Durchstreichung in Höhe der Mittellänge                | nichts            | Kürzel  |
| `rs-missing`                        | Einfügezeichen ∧ unter der Zeile, zwischen den Wörtern | fehlender Text    | Kürzel  |

- Mehrere Kürzel einer Zeile stehen am Rand in Textreihenfolge, getrennt durch Leerzeichen („Z R R G“). Jede Markierung bekommt ihr Kürzel, auch wenn es doppelt vorkommt.
- Kürzel werden in der Schreibweise des Katalogs geschrieben (`SB` wird zu `Sb`), unbekannte Kürzel unverändert. Beim Überfahren zeigt die Ebene Name und Korrektur („R (Rechtschreibung): Schwimbad → Schwimmbad“).
- Satzzeichen als Korrektur (ein Komma) werden größer geschrieben, damit sie lesbar sind.
- Rot ist `#d11f2a` bei 90 % Deckkraft, die Strichstärke wächst mit der Zeilenhöhe (5 %, 1,2 bis 3,5 Pixel). Linien und Kringel haben leichte, aus Zeilen- und Markierungsnummer abgeleitete Zufallsabweichungen. Das Bild ist daher bei jedem Aufruf gleich, wirkt aber von Hand gezogen.

### Platz

- Gewünschte Schriftgröße: 66 % der Zeilenhöhe. Zwischen den Zeilen steht der Platz bis zur Unterkante der Vorzeile (bei der ersten Zeile bis zum Seitenrand) zur Verfügung.
- Zu wenig Platz: Die Schrift der Zeile wird schrittweise kleiner, bis zu 30 % der Zeilenhöhe oder 9 Pixeln.
- Benachbarte Korrekturen einer Zeile werden von links nach rechts aneinandergeschoben, bei Bedarf nach links ausgewichen. Reicht auch die kleinste Schrift nicht, wandert die längste Korrektur an den Rand und steht dort hinter dem Kürzel („G: meinem“). Auch bei zu knappem Zeilenabstand gehen alle Korrekturen der Zeile an den Rand.
- Randtext, der nicht in die Spalte passt, wird verkleinert und zuletzt mit „…“ gekürzt.
- Nichts wird außerhalb der Seite gesetzt.

### Randspalte

Die Spalte beginnt rechts vom Textblock (rechteste Kante aller Zeilen plus ein Abstand) und endet am Seitenrand. Alle Kürzel stehen linksbündig an derselben Stelle in der Höhe der Grundlinie. Bleibt rechts weniger als 4 % der Seitenbreite (mindestens das 1,6-fache der mittleren Zeilenhöhe), gilt die Seite als randlos. Dann stehen die Kürzel rechtsbündig an der rechten Kante des Textblocks im Streifen über der Zeile, und die Korrekturen weichen ihnen aus.

### Wortpositionen

Bekannt sind nur Zeilenboxen. `TextLocator.span(line, start, end)` liefert den x-Bereich eines Zeichenbereichs. Die Standardimplementierung `proportionalLocator` verteilt die Zeilenbreite proportional auf die Zeichen, gewichtet nach Zeichenbreite (schmal: `i l j .`, breit: `m w`, Großbuchstaben und Leerzeichen eigene Gewichte). Eine Auslassung nach einem Leerzeichen sitzt in der Mitte der Lücke. Mit echten Wortboxen ersetzt eine andere Implementierung der Schnittstelle sie, `layoutOverlay` und `AnnotatedPage` nehmen sie über `locator` entgegen.

### Darstellung und Export

`layoutOverlay` rechnet in Seitenpixeln ein Modell aus Strichen und Texten. Daraus entstehen beide Ausgaben mit identischer Geometrie:

- `AnnotatedPage` zeigt Bild und SVG-Ebene (`viewBox` in Seitenkoordinaten, scharf bei jedem Zoom, `pointer-events: none`).
- `rasterizeAnnotatedPage` zeichnet Seite und Modell auf ein Canvas und liefert ein PNG. Der Export geht absichtlich nicht über ein SVG als Bild, weil die Schrift dort in der WebView nicht zuverlässig geladen wird.

Zeilen ohne `bbox` können nicht gezeichnet werden. Das Modell nennt sie in `skippedLines`.

### Schrift

[Caveat](https://github.com/googlefonts/caveat) (SIL OFL 1.1), in `src/overlay/fonts/` als `woff2` auf lateinische Zeichen beschränkt (75 KB, Gewichtsachse erhalten), auf einen Commit von google/fonts festgelegt. Das Laden erfolgt per `@font-face` aus dem Bundle, die CSP bleibt unverändert. Quelle, Lizenz und Befehl zur Erzeugung stehen in `src/overlay/fonts/README.md`.

## Begründung

- Ein gemeinsames Modell für SVG und Canvas hält Anzeige und Export deckungsgleich und die Platzierung testbar ohne Browser.
- Proportionale Schätzung ist billig und liegt bei Handschrift meist innerhalb eines Wortes. Die Schnittstelle erlaubt Wortboxen später ohne Änderung am Rest.
- Kringel für kurze Wörter und Unterstreichung für lange: Unter drei, vier Buchstaben ist eine Linie leicht zu übersehen.

## Folgen

- Die Schätzung der Wortposition kann bei stark ungleichmäßiger Schrift danebenliegen. Echte Wortboxen beheben das.
- Die Breite der Korrekturschrift wird aus Zeichenklassen geschätzt, nicht gemessen. Die Abstände enthalten einen Puffer.
- Stark überlappende Zeilenboxen oder sehr lange Korrekturen enden im Randtext. Dort ist die Information vollständig, aber nicht am Wort.
- Die Schwere von Fehlern wird nicht dargestellt (siehe 0002).
