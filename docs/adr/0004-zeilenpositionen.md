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
5. Die Zuordnung der erkannten Zeilen zu den Transkriptzeilen ist eine dynamische Programmierung über Zeichenzahl und Tintenbreite. Sie erlaubt 1:1, mehrere erkannte Zeilen zu einer Transkriptzeile (Vereinigung), eine erkannte Zeile zu mehreren Transkriptzeilen (horizontale Teilung nach Zeichenzahl, vertikal bei sehr hohen Bändern) und das Überspringen auf beiden Seiten. Leere Transkriptzeilen bekommen `null`.

Das Ergebnis je Transkriptzeile ist `{ bbox, confidence } | null`. `bbox` ist achsparallel in Pixeln des übergebenen Bildes. Bei schrägen Seiten wird die Box entsprechend höher, `skewDegrees` liefert den Winkel für die Darstellung.

## Verworfen

- Ein Vision-Modell nach Zeilenkoordinaten fragen: GLM-OCR liefert in unserer Nutzung nur Text, Koordinaten kämen im offiziellen Ablauf von einem separaten Layout-Modell. Qwen3-VL 4B liefert Zeilenboxen im Format `bbox_2d` mit relativen Koordinaten, driftet aber auf echter Handschrift nach unten ab, braucht rund 20 s je Seite auf einer GPU und wäre ein zweites Modell im Arbeitsspeicher.

## Folgen

- Mehrspaltige Seiten, Tabellen und stark verwinkelte Fotos werden nicht unterstützt. Dort liefert die Zuordnung `null` oder niedrige Konfidenz.
- Die Eingabe ist das Bild, das auch der Transkription dient (bereits gedreht). Der Aufrufer ist dafür zuständig, die Boxen in dasselbe Koordinatensystem zu bringen wie die Seite im Overlay.
