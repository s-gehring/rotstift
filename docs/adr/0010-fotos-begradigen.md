# 0010: Fotos begradigen

- Status: Angenommen
- Datum: 2026-10-22

## Kontext

Viele Lehrkräfte fotografieren Hefte mit dem Handy, statt sie zu scannen. Auf Fotos liegt das Blatt schräg und perspektivisch verzerrt auf dem Tisch, die Seite wölbt sich zur Bindung hin. Seit den Heftlinien ([0004](0004-zeilenpositionen.md)) treffen die Zeilenboxen auf den meisten gerenderten Fotos, auf Linien bis zum Blattrand (`liniert-eng`) bleiben bei starker Perspektive aber ganze Seiten grob. Erkennung, Strichsuche und das Overlay arbeiten auf dem schiefen Bild, die Korrektur sieht entsprechend schief aus. Scans dürfen sich dadurch nicht verändern.

## Entscheidung

Beim Import prüft `planDewarp` (`src/layout/dewarp.ts`, im Worker `dewarp.worker.ts`) jedes Bild einmal auf 1200 px Kantenlänge. Ist es sicher ein verzerrtes Foto, wird die begradigte Seite für alles Weitere verwendet: Vorschau, Erkennung, Zeilen, Strichsuche, Overlay und Export, wie bei einer Scanner-App. Sonst bleibt das Original unverändert. Es gibt keine neue Bedienfläche ([0005](0005-bedienkonzept.md)).

1. **Blatt finden** (`src/layout/sheet.ts`): Dunkle dünne Strukturen (Schrift, Linien) werden per Schließen entfernt, dann je Seite die Helligkeitsstufe zwischen Tisch und Papier gesucht und per Hough-Abstimmung und kleinsten Quadraten zu einer Kante zusammengefasst. Mindestens drei Kanten müssen gefunden sein, eine fehlende wird der Bildrand. Ringbindung und Lochrand ergeben keine durchgehende Kante und verlieren die Abstimmung gegen die Blattkante. Das Blatt gilt nur, wenn außerhalb kaum Tinte liegt (höchstens 30 % der Dichte innen) und mindestens 1,5 % der Fläche Hintergrund sind. So schneidet ein Schatten oder eine zweite Seite keinen Text ab.
2. **Perspektive**: Eine Homographie bildet die vier Ecken auf ein Rechteck ab (`src/layout/homography.ts`). Das Seitenverhältnis kommt aus der Kamerageometrie (Zhang und He) und wird nur übernommen, wenn Brennweite und Abweichung plausibel sind, sonst aus den gemittelten Kantenlängen.
3. **Feinentzerrung über die Heftlinien**: `findRuling` ([0004](0004-zeilenpositionen.md)) liefert auf der (vor-)entzerrten Seite die Heftlinien als Polylinien. Aus ihren Steigungen entsteht ein glattes Steigungsfeld (Spline in x, quadratisch in y, robust gewichtet), entlang dessen ein Gitter aus 33 × 45 Punkten verfolgt wird. Das glättet Wölbung, Restdrehung und Rest-Trapez. Text allein dient nicht als Maß, weil Handschrift auf blankem Papier sonst als Wölbung gelesen wird.
4. **Entscheidung**: Begradigt wird, wenn das Blatt mit mindestens 0,75° Schräge gefunden ist, die Heftlinien um mindestens 0,3 % der Seitenhöhe gewölbt sind oder ihre Winkel um mindestens 1° auseinanderlaufen (Trapez). Drehung allein löst nie aus, sonst würden schief eingelegte Scans gedreht.
5. **Plan**: Das Ergebnis ist ein Gitter in Anteilen der Quellgröße (`DewarpPlan`), unabhängig von der Auflösung. Es wird beim Import an der Seite gespeichert (`PageSource.dewarp`) und bei jedem Zeichnen der Seite mit bilinearer Abtastung angewandt (`drawStraight`), vor der Drehung durch die Lehrkraft. Breite und Höhe der Seite sind die begradigten.

Eine Seite ohne Plan läuft durch denselben Code wie vorher und bleibt Pixel für Pixel gleich.

## Verworfen

- **Steigungsfeld aus der Schrift:** Auf Fotos ohne Linien hätte es Wölbung erkennen können, auf blanken Scans hat es aber die Schwankung der Handschrift als Wölbung gelesen und 76 von 77 ScaDS-Seiten verändert.
- **Begradigen nur für die Zeilensuche, Boxen zurückrechnen:** Die Erkennung und das Overlay blieben schief. Die Lehrkraft soll die Seite so sehen, wie sie korrigiert wird.
- **Ein Modell für die Entzerrung (etwa DocTr, UVDoc):** Ein zweites Modell im Speicher eines 8-GB-Laptops, dazu Downloads, für einen Schritt, den klassische Geometrie auf Heftseiten ausreichend löst.
- **Schalter „Foto begradigen“:** Widerspricht [0005](0005-bedienkonzept.md). Die Lehrkraft dreht weiterhin wie bisher.

## Folgen

- Planen kostet je Seite in WebKit, der Engine der Mac-App, rund 0,13 s auf 1200 px, Anwenden beim Zeichnen auf 2048 px rund 0,17 s (Messung in [Heftpapier, Phase 2: Fotos begradigen](../evaluations/2026-10-heftpapier.md#phase-2-fotos-begradigen)).
- Fotos, die nur gedreht sind und keinen Tisch zeigen, bleiben unbegradigt, auch mit Heftlinien. Die Zeilensuche gleicht die Schräglage dort weiter selbst aus.
- Auf blankem Papier ohne sichtbare Blattkante gibt es kein Maß für die Wölbung. Solche Fotos bleiben wie sie sind.
- Ein Scan, dessen Heftlinien messbar auseinanderlaufen (etwa ein schief aufgelegtes Heft), wird begradigt. In den Messsätzen betrifft das eine von über 1100 Scanseiten.
