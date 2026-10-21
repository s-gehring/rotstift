# 0006: Fehlergewichtung

- Status: Angenommen
- Datum: 2026-10-21

## Kontext

[0002](0002-korrekturschema.md) lässt die Schwere eines Fehlers bewusst offen, und die Statistik zählt jeden Fehler gleich. Für die Note rechnen Lehrkräfte anders: Ein Wort, das dreimal gleich falsch geschrieben ist, zählt einmal, mancher Fehler zählt halb oder gar nicht, und aus der Fehlerzahl wird ein Quotient je 100 Wörter. Es gibt dafür keine bundesweite Regel. Die Länder regeln es verschieden, teils nur für einzelne Schulstufen oder die Abiturprüfung, und es gibt auch Länder ohne Fehlerquotient (Schleswig-Holstein hat ihn zum Schuljahr 2024/25 abgeschafft, [News4teachers](https://www.news4teachers.de/2024/04/bundesland-streicht-sogenannten-fehlerquotienten-und-loest-damit-bundesweite-debatte-um-den-wert-der-rechtschreibung-aus/)). Rotstift braucht deshalb eine sinnvolle Vorgabe je Fach, die die Lehrkraft ändern kann.

## Recherche

- **Hessen, Fehlerindex für alle Fächer in Jahrgang 9 und 10** ([Kultusministerium](https://kultus.hessen.de/sites/kultus.hessen.de/files/2022-09/fehlerindex.pdf)): Rechtschreib-, Zeichensetzungs-, Grammatik- und Ausdrucksfehler zählen jeweils als ganze Fehler. Der Index ist Fehlerzahl mal 100 geteilt durch die Wortzahl, bei Arbeiten mit mindestens 100 Wörtern. Ein Wort, das wiederholt gleich falsch geschrieben wird, zählt einmal. „das“ und „dass“ zu verwechseln ist kein Wiederholungsfehler. Bei Zeichensetzung gibt es keine Wiederholungsfehler. Fehlen bei einem eingeschobenen Satz beide Kommas, zählt das einmal. Flüchtigkeitsfehler (fehlende i-Punkte) werden markiert, aber nicht gezählt. Die Note sinkt ab Schwellen je Schulform um ein oder zwei Drittel.
- **Hessen, moderne Fremdsprachen in der Oberstufe** ([Erlass vom 7. August 2020](https://kultus.hessen.de/sites/kultus.hessen.de/files/2021-09/erlass-bewertung_und_beurteilung_von_schriftlichen_arbeiten_in_den_mod._fs.pdf)): Die sprachliche Richtigkeit wird ganzheitlich nach Deskriptoren bewertet, nicht über eine Fehlerzahl. Wiederholungsfehler werden nicht gewertet.
- **Sachsen, Abiturarbeiten** ([Bekanntmachung](https://www.revosax.sachsen.de/vorschrift_gesamt/2991/2699.html)): In den Fremdsprachen sind orthographische Fehler in der Regel halbe Fehler. Gekennzeichnet, aber nicht gewertet werden Wiederholungsfehler, Folgefehler und Interpunktionsfehler in der Fremdsprache. Die Fehlerzahl wird über die Wortzahl in einen Fehlerprozentsatz und über eine Tabelle in Bewertungseinheiten umgerechnet. Ganze und halbe Fehler werden im Text unterschiedlich gekennzeichnet, in der Übersetzung gibt es zusätzlich Doppelfehler.
- **Schleswig-Holstein:** Der Fehlerquotient wurde bis 2024 in den letzten beiden Jahren vor den Abschlussprüfungen angewandt, in der Oberstufe galten drei Fehler je 100 Wörter als Grenze zur mangelhaften Sprachrichtigkeit ([News4teachers](https://www.news4teachers.de/2024/04/bundesland-streicht-sogenannten-fehlerquotienten-und-loest-damit-bundesweite-debatte-um-den-wert-der-rechtschreibung-aus/)).

Was die Quellen gemeinsam haben: Wiederholungen zählen einmal, Zeichensetzung ist ein Sonderfall, und die Fehlerzahl wird auf die Wortzahl bezogen. Was sie trennt: halbe Fehler und die Behandlung der Zeichensetzung in Fremdsprachen. Die Schwellen für die Note sind Ländersache und gehören nicht in die Statistik.

## Entscheidung

### Gewicht

Jede Fehlerart eines Profils hat ein Gewicht aus 0, 0,5, 1, 1,5 und 2. Ein Fehler zählt mit dem Gewicht seiner Art, die gewichtete Fehlerzahl ist die Summe. Der Fehlerquotient ist die gewichtete Fehlerzahl mal 100 geteilt durch die Wortzahl (ohne gestrichenen Text, wie in [0002](0002-korrekturschema.md)). Für die Klasse werden die gewichteten Fehler und die Wörter aller Arbeiten addiert und dann geteilt, nicht die Quotienten gemittelt. „Unsicher gelesen“ geht nur ein, wenn die Lehrkraft die Stelle als Fehler übernommen hat.

### Wiederholungsfehler

Mit „Wiederholungsfehler einmal zählen“ zählt ein Fehler nur einmal je Arbeit (über alle Seiten), wenn Art, Originaltext und Korrektur gleich sind. Nie als Wiederholung gelten Zeichensetzung (Art der Rolle Zeichensetzung im Profil, auch Auslassungen), jede Auslassung und die Verwechslung von „das“ und „dass“. Die Gleichheit ist genau, ohne Normalisierung der Schreibweise. Es werden nur Wiederholungsfehler erkannt, keine Folgefehler: Ob ein Fehler aus einem früheren folgt, kann Rotstift nicht beurteilen.

### Vorgaben je Fach

| Fach                            | Gewichte                                                    | Wiederholungsfehler |
| ------------------------------- | ----------------------------------------------------------- | ------------------- |
| Deutsch                         | Alle Arten 1                                                | einmal              |
| Sachfach                        | R, Z, G je 1                                                | einmal              |
| Englisch, Französisch, Spanisch | Rechtschreibung 0,5, Zeichensetzung 0, alle anderen Arten 1 | einmal              |

Deutsch und Sachfach folgen dem hessischen Fehlerindex: Alle Arten sind ganze Fehler, Wiederholungen zählen einmal, Zeichensetzung nie als Wiederholung. Die Fremdsprachen folgen der sächsischen Regel: Orthographie halb, Zeichensetzung in der Fremdsprache nicht gewertet. Als „schwerer Fehler“ lässt sich eine Art mit Gewicht 1,5 oder 2 versehen (in Sachsen entspricht das dem Doppelfehler der Übersetzung); eine Vorgabe dafür gibt es nicht, weil die Kataloge keine Schwere je Fehler kennen und das Modell sie nicht verlässlich entscheiden könnte (siehe [0002](0002-korrekturschema.md)). Die Vorgaben sind Ausgangspunkte, keine Rechtsauskunft. Wer nach der Verordnung seines Landes anders rechnet, ändert die Gewichte.

### Speicherung und Oberfläche

Die geänderten Gewichte je Fach liegen im Browser-Speicher unter `rotstift.weighting`, wie die Fachwahl. Ungültige oder fremde Inhalte werden ignoriert, Gewichte außerhalb der angebotenen Stufen verworfen, und für fehlende Arten gilt die Vorgabe. In ⚙ Einstellungen steht ein eingeklappter Abschnitt „Fehlergewichtung“ mit Fach, Gewicht je Fehlerart, dem Schalter für Wiederholungsfehler und „Zurücksetzen“.

Die Klassenübersicht zeigt „Fehlerquotient“ (gewichtet) statt der ungewichteten Zahl je 100 Wörter, mit der gewichteten Fehlerzahl als Tooltip. Die Arbeit-Ansicht zeigt dasselbe als Tooltip an den Kennzahlen. Die Tabelle (CSV und Zwischenablage) hat die Spalten „Fehler“, „Fehler je 100 Wörter“, „Gewichtete Fehler“ und „Fehlerquotient“. Die Zahlen im PDF bleiben ungewichtet.

Die Berechnung liegt in `src/stats/weighting.ts` als reine Funktionen und braucht die Transkripte aller korrigierten Seiten einer Arbeit, nicht die Summen je Seite.

## Folgen

- Bei geänderten Gewichten ändern sich die Zahlen sofort, auch für bereits korrigierte Arbeiten. Die Markierungen bleiben unberührt.
- Die Gewichte gelten je Fach und Rechner, nicht je Klasse oder Arbeit.
- Folgefehler, Fehlernester und Schwellen für Notenabzüge sind nicht abgebildet.
- Das PDF zeigt weiter die ungewichtete Zahl. Ändert sich das, braucht es eine Entscheidung, welche Zahl das Dokument für die Schülerin oder den Schüler zeigt.
