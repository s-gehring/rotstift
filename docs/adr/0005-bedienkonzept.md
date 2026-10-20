# 0005: Bedienkonzept

- Status: Angenommen
- Datum: 2026-10-20

## Kontext

Bis 0.2 war Rotstift eine lange Seite: Untertitel, ein Erklärabsatz zum Laden, Arbeiten mit Checkboxen und sechs immer sichtbaren Knöpfen je Seite, darunter zwei gleichrangige Startknöpfe mit einem Profilkasten dazwischen, bis zu fünf Hinweiskästen, das Zählergebnis unter dem Import, die Berichtigung als zweite Ansicht und die Modellverwaltung am Seitenende. Alles war gleichzeitig sichtbar, der Ablauf nicht erkennbar, und viele Texte erklärten, was die Oberfläche selbst hätte zeigen sollen.

## Entscheidung

### Grundsätze

1. **Eine Hauptaktion je Zustand.** Sie steht immer an derselben Stelle, oben rechts, und ist der einzige rote Knopf.
2. **Nur zeigen, was jetzt gebraucht wird.** Seltenes steckt im „…“-Menü des Objekts, auf das es wirkt. Einstellungen und Modelle stecken hinter ⚙.
3. **Keine Erklärtexte.** Beschriftungen und Zahlen erklären die Oberfläche. Ein Satz erscheint nur bei einem Fehler, und dann mit einer Handlungsmöglichkeit.
4. **Gute Vorgaben statt Fragen.** Das Fach merkt sich die letzte Wahl, die Modelle folgen dem Arbeitsspeicher, Dateinamen werden vorgeschlagen.
5. **Fehler am Ort.** Ein Fehler steht bei der Arbeit, der Seite oder im Dialog, den er betrifft, nicht als Banner über allem.

### Aufbau

Das Fenster hat eine Kopfzeile und darunter genau eine von zwei Ansichten.

- **Kopfzeile:** Links „Rotstift“, in der Mitte Fortschritt (nur während eines Laufs), rechts die Hauptaktion und ⚙. Im Entwicklungs- und Browsermodus ein kleines Etikett „Demo“.
- **Klasse:** Alle Arbeiten untereinander. Hier wird geladen, sortiert, gestartet und exportiert.
- **Arbeit:** Eine Arbeit groß, mit Korrekturen, Fehlerliste und Text. Hier wird geprüft.

### Ablauf und Hauptaktion

| Zustand            | Hauptaktion oben rechts                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Keine Arbeiten     | keine, die Ablagefläche füllt das Fenster                                                |
| Arbeiten geladen   | Fach-Auswahl und „Korrigieren“, im Pfeilmenü daneben „Nur Wörter zählen“                 |
| Lauf               | Fortschritt in der Kopfzeile („Seite 12 von 61“, Restzeit sobald schätzbar), „Abbrechen“ |
| Fertig             | „Exportieren“ mit Menü                                                                   |
| Neue Arbeiten dazu | wieder „Korrigieren“ bzw. „Wörter zählen“, läuft nur für das Fehlende                    |

- **Korrigieren** erkennt den Text und korrigiert ihn. Die Wortzahl fällt dabei mit ab. **Nur Wörter zählen** erkennt nur und braucht kein Korrekturmodell. Die zuletzt gewählte Art bleibt die Hauptaktion.
- **Fach** ist eine kleine Auswahl links neben dem Knopf (Deutsch, Englisch). Die Sprache folgt aus dem Fach und wird nicht gesondert gewählt. Welche Kürzel markiert werden, steht nicht in der Oberfläche.
- **Exportieren** bietet: Klassen-PDF, Tabelle (CSV), Tabelle kopieren. In der Arbeit-Ansicht zusätzlich und zuerst „Diese Arbeit als PDF“. Gespeichert wird immer über den Systemdialog mit vorgeschlagenem Namen. Erfolg zeigt eine kurze Meldung, die von selbst verschwindet.
- Während eines Laufs sind Sortieren, Entfernen und Laden gesperrt. Die Menüpunkte sind dann ausgegraut, nicht ausgeblendet.

### Klasse-Ansicht

- **Leer:** Eine große Ablagefläche mit „Arbeiten hierher ziehen“, dem Knopf „Dateien auswählen“ und einer leisen Zeile „PDF oder Bilder. Alles bleibt auf diesem Rechner.“ Sonst nichts.
- **Kopf der Liste:** „28 Arbeiten · 61 Seiten“, nach einem Lauf zusätzlich Wörter und Fehler der Klasse und der Link „Übersicht“. Er öffnet die Klassenübersicht (Tabelle je Arbeit, Fehlerarten der Klasse) als Dialog. Ein „…“-Menü enthält „Dateien hinzufügen“ und „Alle entfernen“. Dateien lassen sich jederzeit ins Fenster ziehen.
- **Je Arbeit eine Zeile:** Name, kleine Seitenvorschauen, rechts die Kennzahlen (nach einem Lauf: Wörter, Fehler, bei Bedarf „3 unsicher“), ein Zustand während des Laufs, ein „…“-Menü mit „Umbenennen“, „Zusammenführen mit ▸“ und „Entfernen“. Ein Doppelklick auf den Namen benennt um. Nach einem Lauf öffnet ein Klick auf die Zeile die Arbeit.
- **Seiten:** Nur die Vorschau. Beim Überfahren erscheinen „Drehen“ und ein „…“-Menü: Links drehen, Rechts drehen, Nach vorn, Nach hinten, In andere Arbeit ▸, Ab hier neue Arbeit, Entfernen. Seiten lassen sich zusätzlich per Ziehen umsortieren, auch in eine andere Arbeit. Ein Klick vergrößert die Seite.
- **Ab hier neue Arbeit** verschiebt diese und alle folgenden Seiten in eine neue Arbeit und trennt so einen Stapel, der als ein PDF gescannt wurde. **Zusammenführen** fügt Arbeiten zusammen, die seitenweise gescannt wurden. Beides ersetzt die Checkboxen.
- **Entfernen** fragt nicht nach. Die kurze Meldung danach bietet „Rückgängig“.
- **Fehler einer Seite** (Erkennung oder Korrektur fehlgeschlagen) stehen als kurze Zeile an der Arbeit, mit „Erneut versuchen“. Wird eine Seite nach dem Lauf gedreht oder ihr Text bearbeitet, gilt sie als offen: Die Hauptaktion bietet dann wieder „Korrigieren“ und läuft nur für offene Seiten. Ein eigener Hinweis dazu entfällt.

### Arbeit-Ansicht

- **Kopf:** „‹ Klasse“, der Name, „3 von 28“ mit ‹ und ›, die Kennzahlen der Arbeit, ein Umschalter „Korrigiert | Original“ und das Exportmenü. Pfeiltasten wechseln die Arbeit, Esc führt zurück. Der Umschalter gilt für alle Arbeiten, bis er geändert wird.
- **Inhalt:** Die Seiten groß untereinander mit den Korrekturen als Feinliner-Ebene ([0003](0003-overlay.md)). Rechts eine schmale Spalte mit den Fehlern der Arbeit nach Seiten, beim Überfahren hervorgehoben auf der Seite.
- **Unsicher gelesen:** grau gepunktet auf der Seite. In der Spalte als eigene, eingeklappte Gruppe „3 unsicher gelesen“, je Eintrag „Übernehmen“ und „Verwerfen“. Ein Klick auf die Stelle der Seite öffnet dasselbe.
- **Text:** Im „…“-Menü einer Seite „Text bearbeiten“. Die Spalte zeigt dann den erkannten Text zum Bearbeiten, Wortzahl und Korrekturen passen sich an.
- **Nur Wörter gezählt:** Die Spalte zeigt den erkannten Text mit der Wortzahl je Seite. Teilweise gezählte Arbeiten sagen das an der Zahl („mind. 120“), nicht in einem Satz.

### Einrichtung der Modelle

- Die Modelle werden erst geladen, wenn sie gebraucht werden: Ein Klick auf die Hauptaktion ohne passende Modelle öffnet den Dialog „Einmalige Einrichtung“. Er nennt, was fehlt, mit Gesamtgröße, hat einen Knopf „Herunterladen“, einen gemeinsamen Fortschritt mit Restzeit und klein „Aus Datei importieren …“ für Rechner ohne Internet. Danach startet der Lauf von selbst.
- Prüfung und Laden der Modelle beim Start zeigen nichts, solange sie gelingen. Schlagen sie fehl, erscheint der Fehler in diesem Dialog, mit „Erneut versuchen“.
- **⚙ Einstellungen** (Dialog): Texterkennung (Wahl des Modells, sofern mehr als eines passt, Größe, Löschen), Korrektur (Größe, Löschen), „Modell aus Datei importieren …“, „Protokoll“ (eingeklappt, mit Kopieren) und eine Zeile zu Version und Datenschutz.

### Gestaltung

- Hell oder dunkel nach Systemeinstellung. Ruhige, papierähnliche Flächen, damit die weißen Seiten wirken. Rot (`#d11f2a`, wie der Feinliner) nur für die Hauptaktion, Korrekturen und echte Fehler.
- Systemschrift, Grundgröße 14 px, eine Abstandsskala (4, 8, 12, 16, 24, 32 px), Ecken 6 px, Farben, Abstände und Schatten nur als CSS-Variablen in `src/ui/tokens.css`.
- Wiederverwendbare Bausteine in `src/ui/`: Knopf, Symbolknopf, Menü mit Untermenü, Knopf mit Pfeilmenü, Dialog, Umschalter, Fortschrittsbalken, kurze Meldung. Symbole als Inline-SVG, keine neue Abhängigkeit.
- Alles per Tastatur bedienbar, Menüs und Dialoge mit korrekten Rollen und Fokusführung.

### Wortwahl

- „Korrigieren“ statt „Berichtigen“: Korrigieren tut die Lehrkraft, berichtigen die Schülerin.
- Feste Begriffe: Arbeit, Seite, Klasse, Fach, Korrigieren, Wörter zählen, Exportieren, unsicher gelesen.
- Kurz und ohne Anrede. Höchstens ein Satz, und nur bei Fehlern.

### Was wegfällt

Untertitel, Erklärabsätze zu Laden und Zusammenführen, Demo- und Vorschau-Hinweiskästen, der Hinweis zu Lesefehlern, „Markiert werden: …“, die Sprach-Auswahl, Checkboxen, immer sichtbare Seitenknöpfe, die Ergebnisliste unter dem Import und die Modellverwaltung am Seitenende. Das Etikett „Vorschau“ an der Korrektur entfällt in der Oberfläche. Der Prüfhinweis im exportierten PDF bleibt.

## Folgen

- Die Oberfläche wird neu gebaut, die Fachlogik in Hooks und Modulen bleibt. Tests, die Texte prüfen, ändern sich mit.
- README, Abschnitte „Stand“ und „Erster Start“, beschreibt den neuen Ablauf.
- Neue Funktionen kommen nach diesen Grundsätzen dazu: zuerst fragen, ob sie eine eigene Fläche brauchen oder in ein bestehendes Menü passen.
