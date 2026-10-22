# 0004: Zeilenpositionen auf der Seite

- Status: Angenommen
- Datum: 2026-10-20

## Kontext

Die Korrekturen sollen zwischen die Zeilen der Originalseite gezeichnet werden (siehe [0002](0002-korrekturschema.md), `bbox` von `<rs-line>`). GLM-OCR liefert nur Textzeilen ohne Koordinaten. Jede Transkriptzeile braucht daher ihre Position im Seitenbild. Die Lösung muss auf einem 8-GB-Laptop ohne GPU laufen und darf kein weiteres Modell laden.

## Entscheidung

`src/layout/` bestimmt die Positionen mit klassischer Bildverarbeitung in TypeScript, ohne zusätzliches Modell. Der Einstieg ist `locateLines(image, lines)`. `createLayoutLocator()` führt dasselbe in einem Web Worker aus.

1. Das Bild wird auf höchstens 1200 px Kantenlänge verkleinert und lokal binarisiert (Mittelwert in einem Fenster, Mindestkontrast).
2. Die Schräglage (bis ±6°) ergibt sich aus der Schärfe des Zeilenprofils. Alle weiteren Schritte rechnen in einem entsprechend geschertem Koordinatensystem, die Boxen werden zurückgerechnet.
3. Linien und Ränder fallen weg: lange dünne Läufe und Zeilen mit extrem hoher Tintendichte (Lineatur, Randlinie), dünne Ränder und Scanner-Reste am Seitenrand. Lücken, die dabei in Buchstaben entstehen, werden für die Zusammenhangskomponenten wieder überbrückt.
4. Aus dem Zeilenprofil entstehen Zeilenbänder (Abstand per Autokorrelation, Maxima, flache Täler werden zusammengelegt). Die Trennlinie zwischen zwei Bändern wird je Seitenstreifen am Minimum gesucht und stetig interpoliert, sodass wellige Zeilen funktionieren. Kleine Komponenten (Unterlängen, Punkte) gehören ganz zum überwiegenden Band, große Komponenten werden an der Trennlinie geteilt.
5. Die Zuordnung der erkannten Zeilen zu den Transkriptzeilen ist eine dynamische Programmierung über Zeichenzahl, Tintenbreite und vertikale Geometrie (`src/layout/align.ts`). Sie erlaubt 1:1, mehrere erkannte Zeilen zu einer Transkriptzeile (Vereinigung), eine erkannte Zeile zu mehreren Transkriptzeilen (horizontale Teilung nach Zeichenzahl, vertikal bei sehr hohen Bändern) und das Überspringen auf beiden Seiten. Die Breitenabweichung wird als Streuung des Logarithmus (Annahme 25 %, robust gegen Ausreißer) bewertet, damit die Kosten die echte Streuung echter Handschrift abbilden. Der Zeilenabstand der erkannten Bänder wird gegen den erwarteten Abstand geprüft (leere Transkriptzeilen und übersprungene erkannte Zeilen zählen als zusätzliche Zeilen). Überzählige oder fehlende Zeilen am Seitenanfang und -ende (Überschrift, Seitenzahl) sind billiger als in der Mitte.
6. Die Konfidenz kommt aus den Randwahrscheinlichkeiten eines Vorwärts-Rückwärts-Durchlaufs über dieselbe Kostenfunktion: Sie sagt, wie viel der Wahrscheinlichkeitsmasse auf genau dieser Zuordnung liegt. Gibt es zu einer Zeile gleichwertige Alternativen, liegt die Randwahrscheinlichkeit unter der Schwelle (0,8, für Vereinigung und Teilung 0,7) und nur diese Zeile bekommt `null`. Lieber `null` als eine falsche Box. Die Unsicherheit bleibt lokal: Wo Zeilenbreiten und Abstände eine Stelle eindeutig machen, bleiben die Boxen erhalten, auch wenn an anderer Stelle eine Zeile fehlt.

Das Ergebnis je Transkriptzeile ist `{ bbox, confidence } | null`. `bbox` ist achsparallel in Pixeln des übergebenen Bildes. Bei schrägen Seiten wird die Box entsprechend höher, `skewDegrees` liefert den Winkel für die Darstellung.

### Heftlinien (Ergänzung vom 2026-10-22)

Vor der Binarisierung sucht `findRuling` (`src/layout/ruling.ts`) die Lineatur der Seite. `locateLines` liefert sie als `ruling` im Ergebnis mit: `kind` (`blank`, `lined` oder `grid`), die waagerechten und bei Karos die senkrechten Linien als Polylinien in Pixeln des übergebenen Bildes, Linien- und Spaltenabstand, Winkel und die Randlinien links und rechts (oder `null`).

1. Dünne dunkle Linien geben quer zu ihrer Richtung eine Antwort (heller Rand in 2 bis 3 px Abstand). Der vorherrschende Winkel bis ±10° folgt aus der Schärfe des gescherten Histogramms dieser Antworten.
2. Die Seite wird quer in 8 bis 40 Streifen geteilt. Je Streifen sind Maxima der Abdeckung Kandidaten, die über die Streifen zu Ketten verbunden werden. Eine Kette darf sich krümmen, deshalb ist jede Linie eine Polylinie und Wölbung oder Perspektive auf Fotos sind erlaubt.
3. Eine Kette gilt als Heftlinie, wenn sie lang ist (mindestens 20 % der Streifen), fast lückenlos und in mehreren Streifen fast vollständig bedeckt. Handschrift erfüllt das nicht, auch nicht in derselben Farbe wie die Linien. Die Farbe allein entscheidet nie.
4. Liniert heißt: mindestens fünf Ketten in regelmäßigem Abstand (einfach oder doppelt, ±30 %). Kariert heißt: Auch die senkrechten Ketten sind regelmäßig, mit ähnlichem Abstand. Randlinien sind lange senkrechte Ketten im äußeren Bereich, bei Karos nur, wenn sie sich in Farbe oder Länge vom Raster abheben.
5. Die gefundenen Linien werden aus der Tintenmaske gelöscht, entlang ihres geglätteten Verlaufs und nur so breit wie die Linie. Pixel, die deutlich dunkler sind als die Linie an dieser Stelle, gelten als Tinte und bleiben, so überlebt Bleistift auf Karos. Danach fallen weg: eine oder zwei regelmäßige Spalten kleiner Flecken am Rand der Lineatur (Ringe und Löcher einer Spiralbindung, Lochrand), schmale senkrechte Splitter jenseits der Linienenden (Blattkante), lange dünne Komponenten (Seitenkante, Tischrand) und Zeilenkandidaten, die weit außerhalb der Lineatur liegen.

Fotos werden nicht begradigt. Die Zeilensuche arbeitet auf demselben Bild, nur ohne Linien.

Nach der Zuordnung prüft `markImplausible` (`src/layout/plausible.ts`) jede sichere Zeile gegen den Rest der Seite: eine Box, die höher ist als 2,5 Zeilen je Teilzeile, eine Box mit weniger als 40 % der üblichen Tintendichte und auf linierten Seiten eine flache Box (unter 75 % der üblichen Höhe), die um mehr als ein Viertel Linienabstand anders zu den Heftlinien liegt als die übrigen Zeilen. Auf Karos fällt die letzte Prüfung weg, weil dort jede zweite Karozeile beschrieben wird und die Lage zum Raster nichts über die Zeile sagt. Solche Zeilen gelten als grob platziert (`rough`, Konfidenz 0) wie in [0003](0003-overlay.md), die Box bleibt erhalten. Unter vier sicheren Zeilen wird nichts geprüft.

## Verworfen

- Fotos vor der Zeilensuche begradigen (Homographie aus Seitenkanten oder Heftlinien): Nach dem Löschen der Heftlinien treffen die Boxen auf den gerenderten Fotos auch ohne Begradigen, das Entzerren hätte Rechenzeit und Interpolationsfehler gekostet und die Boxen müssten zurückgerechnet werden.
- Ein Vision-Modell nach Zeilenkoordinaten fragen: GLM-OCR liefert in unserer Nutzung nur Text, Koordinaten kämen im offiziellen Ablauf von einem separaten Layout-Modell. Qwen3-VL 4B liefert Zeilenboxen im Format `bbox_2d` mit relativen Koordinaten, driftet aber auf echter Handschrift nach unten ab, braucht rund 20 s je Seite auf einer GPU und wäre ein zweites Modell im Arbeitsspeicher.

## Folgen

- Mehrspaltige Seiten, Tabellen und stark verwinkelte Fotos werden nicht unterstützt. Dort liefert die Zuordnung `null`.
- Die Lineatur kostet je Seite im Median rund 25 bis 40 ms CPU-Zeit zusätzlich, `findRuling` allein höchstens 41 ms (Messung in [Heftpapier, Phase 2](../evaluations/2026-10-heftpapier.md#phase-2-heftlinien)). Auf blankem Papier ändert sich an den Boxen nichts.
- Weicht das Transkript von der Seite ab (Zeile fehlt, eingefügt, verschmolzen, geteilt), sinkt die Trefferquote deutlich, weil mehrdeutige Zeilen `null` bekommen. Auf den gerenderten Testseiten gibt es keine sicher falschen Boxen, in der Simulation (20 Zeilen, 15 % Breitenstreuung) liegt der Anteil bei einer fehlenden Zeile unter 0,5 %, bei einer eingefügten Zeile um 1,3 %.
- Auf echten Datensätzen ohne Zeilenkoordinaten (ScaDS) lässt sich nur die Abdeckung messen, nicht die Lage der Boxen.
- Die Eingabe ist das Bild, das auch der Transkription dient (bereits gedreht). Der Aufrufer ist dafür zuständig, die Boxen in dasselbe Koordinatensystem zu bringen wie die Seite im Overlay.
