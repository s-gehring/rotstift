# 0007: Korrekturumfang und Aufgabenstellung

- Status: Angenommen
- Datum: 2026-10-21

## Kontext

Bisher markiert Rotstift immer alle Fehlerarten des Fachs ([0002](0002-korrekturschema.md)). Lehrkräfte wollen aber auch nur die Rechtschreibung prüfen lassen, etwa bei einem Diktat, oder nur die Grammatik. Außerdem verlangen manche Aufgaben ausdrücklich einen Stil, den das Modell sonst als Ausdrucksfehler markiert („Schreibe wie ein spätorientalischer Mönch“). Inhalt und Form folgen in einem eigenen Schritt und sind hier nur als Felder vorgesehen.

## Entscheidung

### Umfang

Der Umfang ist ein `CorrectionScope` (`src/correction/scope.ts`) mit den Arten Rechtschreibung, Grammatik, Inhalt und Form, dem Namen der Form und der Aufgabenstellung. Vorgabe: Rechtschreibung und Grammatik an, Inhalt und Form aus, keine Aufgabenstellung. Mindestens eine Art bleibt an.

- **Rechtschreibung** sind die Kürzel der Rollen Rechtschreibung und Zeichensetzung (Deutsch R und Z, Englisch sp und p).
- **Grammatik** sind alle übrigen Kürzel des Profils (Deutsch G, A, Sb, T, Bz, W, im Sachfach nur G).

Abgewählte Arten nennt der Prompt nicht. Das Modell kann sie trotzdem korrigieren; die Ableitung der Marken verwirft dann jede Änderung, deren Kürzel nicht angefragt ist. Was nicht markiert ist, zählt weder in der Statistik noch in der Gewichtung ([0006](0006-fehlergewichtung.md)). Die Tabelle (CSV) zeigt nur Spalten für angefragte Kürzel. Klassenübersicht und PDF listen ohnehin nur Arten mit Fehlern.

Mit der Vorgabe ist der Prompt byteweise derselbe wie vorher. Der Satz mit den Fehlerarten im System-Prompt der Registry ist dafür ein Platzhalter `{kinds}`.

### Aufgabenstellung

Die Aufgabenstellung steht als eigener Abschnitt am Ende des System-Prompts, als Hintergrund gekennzeichnet und nicht als Anweisung. Was sie verlangt (Stil, altertümliche Wörter), ist kein Fehler; falsch geschriebene Wörter werden trotzdem korrigiert. Sie wird vor dem Einsetzen bereinigt: höchstens 2000 Zeichen, keine spitzen Klammern, keine Steuerzeichen außer dem Zeilenumbruch. Platzhalter wie `{text}` darin bleiben wörtlich stehen, weil der Abschnitt erst nach dem Füllen der Vorlage angehängt wird.

### Speicherung und Oberfläche

Die Arten liegen global im Browser-Speicher unter `rotstift.correction-scope`, wie die Fachwahl, nicht je Fach. Wer nur Rechtschreibung prüft, tut das meist fachübergreifend, und die Auswahl steht sichtbar im selben Feld wie das Fach. Formname und Aufgabenstellung gehören zur Klasse: Sie leben nur im Speicher der laufenden Sitzung und werden geleert, sobald die Klasse leer ist (alle Arbeiten entfernt oder „Klasse leeren“).

Das Fach wird ein Aufklappfeld neben „Korrigieren“ ([0005](0005-bedienkonzept.md)): Der Knopf zeigt das Fach, darin stehen Fach, die Kästchen Rechtschreibung und Grammatik und das Feld „Aufgabenstellung“. Ist eine Aufgabenstellung gesetzt, zeigt der Knopf ein graues Dokument-Symbol. Während eines Laufs ist das Feld gesperrt.

## Folgen

- Ein geänderter Umfang gilt für Seiten, die noch nicht korrigiert sind, und für „Erneut korrigieren“. Fertige Seiten behalten ihre Marken. Jede Seite merkt sich die angefragten Kürzel, die Tabelle zeigt die Vereinigung über die Klasse.
- Ein Fachwechsel verwirft wie bisher alle Ergebnisse, ein Wechsel des Umfangs nicht.
- Inhalt und Form werden keine Kürzel, sondern Randkommentare; sie kommen in einer eigenen Entscheidung dazu.
