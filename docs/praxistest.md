# Praxistest vor einem Release

Alle automatischen Tests laufen in Node. Fehler, die nur in der echten Desktop-App auftreten (Sidecar, Modellordner, Dateidialoge, WebView), fallen nur beim manuellen Start auf. Deshalb vor jedem Release diese Liste mit `pnpm dev` und echten Modellen durchgehen.

## Vorbereitung

- `pnpm install`, `pnpm fetch:runtime`, dann `pnpm dev`.
- Testdaten: `~/Rotstift-Testdaten` (ScaDS.AI, CC BY 4.0, nie ins Repo), darin `Aufsatz-3-Seiten.pdf` und einzelne Seiten als PNG.
- Für den Einrichtungstest einmal ohne Modelle starten: den Ordner `models/` im App-Datenverzeichnis vorübergehend umbenennen (macOS: `~/Library/Application Support/tv.gehring.rotstift/`).

## Ablauf

| Schritt                                                                         | Erwartung                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| App starten                                                                     | Leere Ablagefläche, kein Hinweistext, keine Fehlermeldung, Prüfung der Modelle unsichtbar                     |
| PDF und zwei PNGs ins Fenster ziehen                                            | Drei Arbeiten, das PDF mit drei Seiten                                                                        |
| Eine Seite drehen, eine verschieben, eine Arbeit entfernen und „Rückgängig“     | Alles wie erwartet, die entfernte Arbeit ist wieder da                                                        |
| Ohne Modelle „Korrigieren“                                                      | „Einmalige Einrichtung“ mit beiden Modellen und Gesamtgröße                                                   |
| „Herunterladen“, kurz danach abbrechen, erneut starten                          | Download setzt fort, danach Prüfung und automatischer Start des Laufs                                         |
| Mit Modellen „Korrigieren“ (Fach Deutsch)                                       | Ein Fortschrittsbalken mit Prozent und Restzeit, keine Hänger, Abbrechen funktioniert                         |
| Arbeit öffnen, mit Pfeiltasten blättern, „Korrigiert“/„Original“ umschalten     | Rote Marken sitzen auf den Wörtern, die Fehlerliste passt dazu                                                |
| Eine Stelle „unsicher gelesen“ übernehmen und eine verwerfen                    | Kennzahlen ändern sich entsprechend                                                                           |
| „Text bearbeiten“ auf einer Seite, dann „Korrigieren“                           | Nur diese Seite läuft erneut                                                                                  |
| Exportieren: Diese Arbeit als PDF, Klassen-PDF, Tabelle (CSV), Tabelle kopieren | Systemdialog mit vorgeschlagenem Namen, Dateien öffnen sich in Vorschau bzw. Excel, Toast „Gespeichert als …“ |
| „Nur Wörter zählen“ auf neu geladenen Seiten                                    | Wortzahlen je Arbeit, kein Korrekturmodell nötig                                                              |
| ⚙ Einstellungen: Protokoll öffnen und kopieren                                  | Protokoll ohne Schülertexte oder Dateinamen                                                                   |
| App beenden                                                                     | Kein llama-server-Prozess bleibt zurück (`pgrep -fl llama-server`)                                            |

Abweichungen als Issue festhalten, mit Betriebssystem, Modell und dem kopierten Protokoll.
