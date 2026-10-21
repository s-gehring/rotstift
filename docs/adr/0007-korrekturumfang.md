# 0007: Korrekturumfang, Aufgabenstellung, Inhalt und Form

- Status: Angenommen
- Datum: 2026-10-21

## Kontext

Bisher markiert Rotstift immer alle Fehlerarten des Fachs ([0002](0002-korrekturschema.md)). Lehrkräfte wollen aber auch nur die Rechtschreibung prüfen lassen, etwa bei einem Diktat, oder nur die Grammatik. Außerdem verlangen manche Aufgaben ausdrücklich einen Stil, den das Modell sonst als Ausdrucksfehler markiert („Schreibe wie ein spätorientalischer Mönch“). Inhalt und Form kamen in einem zweiten Schritt dazu (Abschnitt „Inhalt und Form“), nachdem eine Messung gezeigt hatte, dass freie Kommentare des kleinen Modells nicht reichen.

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

Das Fach wird ein Aufklappfeld neben „Korrigieren“ ([0005](0005-bedienkonzept.md)): Der Knopf zeigt das Fach, darin stehen Fach, die Kästchen Rechtschreibung, Grammatik, Inhalt und Form, bei Form das Feld „Textform“ und das Feld „Aufgabenstellung“. Ist eine Aufgabenstellung gesetzt, zeigt der Knopf ein graues Dokument-Symbol. Während eines Laufs ist das Feld gesperrt.

### Inhalt und Form

Inhalt und Form werden keine Kürzel und keine Fehler, sondern kurze Randkommentare. Sie zählen weder in der Statistik noch in der Gewichtung oder im Fehlerquotienten.

**Merkmal-Prüfung statt freier Kommentare.** Das Modell schreibt keinen freien Kommentar, sondern beantwortet je Merkmal eine Ja-Nein-Frage als JSON mit `erfuellt`, `zeile` und bei Aufgabenfragen `kommentar` (höchstens 60 Zeichen). llama-server erzwingt das Schema über `response_format` (Grammatik), mit Temperatur 0. System-Prompt und nummerierter Text stehen vorn und sind für alle Fragen einer Arbeit gleich, damit der Prompt-Cache greift; die Frage steht am Ende. Gemessen mit Gemma 4 E2B an zehn selbst geschriebenen Arbeiten ([Eval](../../eval/README.md), Abschnitt „Inhalt und Form“): Freie Kommentare fanden 46 % der Mängel bei einem unpassenden Kommentar je fehlerfreier Arbeit, die Merkmal-Prüfung 71 % bei 0,5.

**Katalog.** `src/content-form/catalog.ts` listet die gängigen Textformen der Sekundarstufe mit Schreibvarianten (Groß- und Kleinschreibung, Bindestriche, Akzente, Synonyme wie „Mail“ oder „Pro-und-Contra-Erörterung“), dazu für Englisch, Französisch und Spanisch Formen wie „Formal letter“, „Essay“ und „Report“ mit den Namen der drei Sprachen. Je Form gibt es ein bis fünf Merkmale mit festem Kommentar („Ort und Datum fehlen“). Merkmale sind nur, was man ohne Fachwissen am Text prüfen kann (Aufbau, Pflichtteile, Zeitform), keine Urteile über die Qualität. Das Feld „Textform“ ist ein Textfeld mit Vorschlägen aus dem Katalog; freier Text bleibt erlaubt. Für eine unbekannte Form stellt die Prüfung eine allgemeine Frage „Entspricht der Text der Textform „X“?“ mit kurzem Kommentar des Modells.

**Inhalt** sind zwei Fragen: Behandelt der Text das Thema der Aufgabenstellung, und hält er ihre ausdrücklichen Vorgaben ein. Ohne Aufgabenstellung gibt es nichts zu prüfen. Deshalb springt beim Anhaken von Inhalt der Fokus in das Feld „Aufgabenstellung“, und „Korrigieren“ ohne Aufgabenstellung öffnet das Aufklappfeld und zeigt den Fehler direkt am Feld („Aufgabenstellung fehlt“). Für Form ohne Textform gilt dasselbe. Erklärtexte gibt es nicht.

**Lauf.** Nach der Fehlerkorrektur aller Seiten folgt je Arbeit ein eigener Durchlauf über den Text aller Seiten, mit eigener Fortschrittsstufe; Abbrechen wirkt auch hier. Er läuft nur für Arbeiten, deren Seiten alle korrigiert oder leer sind, und nur erneut, wenn sich Fach, Textform, Aufgabenstellung oder ein Seitentext geändert haben. Inhalt und Form gehen auch ohne Rechtschreibung und Grammatik; die Seiten werden dann ohne Modellaufruf ohne Marken abgeschlossen. Das Protokoll bekommt nur Zahlen und Zeiten, keinen Schülertext.

**Anzeige.** Ein Kommentar hängt an seiner Zeile, ein fehlender Teil an der Zeile, an der er stehen müsste. Im Overlay ist er eine kurze Randnotiz in Fineliner-Schrift in der Randspalte, ganz im Bild und ohne die Randzeichen zu überdecken; findet sich bis drei Zeilen über oder unter der Zeile kein Platz, steht auf der Seite nur ein kleines Zeichen „*“, und der Text steht in der Seitenleiste. Der Schlusskommentar hat einen festen Wortlaut aus den Befunden („Inhalt: … Form: …“), keinen freien Modelltext, weil das Modell dabei Platzhalter, erfundene Namen und den Stil der Aufgabe übernahm. Er steht unter dem Text der letzten Seite, wenn dort Platz ist, sonst nur in der Seitenleiste und im PDF. Ohne Befund erscheint auf der Seite nichts, die Seitenleiste zeigt grau „Inhalt und Form: keine Auffälligkeiten“. Kommentare lassen sich wie unsichere Lesungen verwerfen und wiederherstellen; verworfene erscheinen weder auf der Seite noch im Schlusskommentar noch im PDF. Das PDF enthält Randnotizen und Schlusskommentar auf den Seiten und eine Liste auf der Auswertungsseite.

**Doppelte Befunde.** Manche Merkmale betreffen dieselben Wörter wie Fehlerkürzel: „Präsens verwenden“ bei der Inhaltsangabe und T-Marken an den Verben, „Grußformel nicht förmlich“ und eine A-Marke auf „Ciao“. Eine feste Tabelle (`src/content-form/overlap.ts`) ordnet solchen Kommentaren Rollen der Fehlerarten zu (Zeitform, Ausdruck, Grammatik), die über das Profil zu Kürzeln werden. Steht in derselben Zeile eine Marke mit einem dieser Kürzel, bleibt die Marke, die Randnotiz entfällt, und die Seitenleiste führt den Kommentar mit „siehe T“. Im Schlusskommentar bleibt er, weil er dort die Arbeit als Ganzes beschreibt. Die gezählten Fehler ändern sich dadurch nicht. Ein Modell entscheidet hier bewusst nicht; es kommt erst dazu, wenn Messungen Fälle zeigen, die die Regeln nicht lösen.

**Speicherung.** Die Kästchen Inhalt und Form sind global wie die anderen Arten, die Textform gehört wie die Aufgabenstellung zur Klasse.

## Folgen

- Ein geänderter Umfang gilt für Seiten, die noch nicht korrigiert sind, und für „Erneut korrigieren“. Fertige Seiten behalten ihre Marken. Jede Seite merkt sich die angefragten Kürzel, die Tabelle zeigt die Vereinigung über die Klasse.
- Ein Fachwechsel verwirft wie bisher alle Ergebnisse, ein Wechsel des Umfangs nicht.
- Die Merkmal-Prüfung kostet je Arbeit eine Anfrage pro Frage, gemessen rund 11 s für eine Arbeit auf einem Laptop ohne GPU. Neue Textformen sind ein Eintrag im Katalog, keine Prompt-Arbeit.
- Unbekannte Textformen werden schwächer geprüft als bekannte, weil die eine allgemeine Frage weniger trifft als die Merkmale.
