# Rotstift

Desktop-App für Windows, macOS und Linux, die Schülerarbeiten (Scans, Fotos, PDFs) mit einem lokalen KI-Modell korrigiert und die Anmerkungen wie mit rotem Fineliner zwischen die Zeilen des Originals schreibt. Alle Daten bleiben auf dem eigenen Rechner.

## Hintergrund

Lehrkräfte erzielen mit Cloud-KI gute Ergebnisse beim Korrigieren, dürfen Schülerarbeiten aus Datenschutzgründen aber nicht an externe Dienste geben. Rotstift läuft vollständig lokal, auch auf einfachen Laptops mit 8 GB RAM ohne Grafikkarte. Auf stärkeren Rechnern lassen sich größere Modelle wählen.

## Stand

Version 0.2 zählt die Wörter handschriftlicher Texte und berichtigt sie als Vorschau, komplett offline:

- Bilder (PNG, JPEG, WebP) und PDFs per Drag and drop laden, Seiten drehen, sortieren und entfernen. Jede Datei wird eine Arbeit (eine Schülerin oder ein Schüler) und heißt wie die Datei, der Name lässt sich direkt ändern. Seitenweise gescannte Arbeiten lassen sich zusammenführen, einzelne Seiten in eine andere Arbeit verschieben.
- „Wörter zählen“ liest jede Seite mit einem lokalen KI-Modell (GLM-OCR) und zeigt die Wortzahl je Seite, je Arbeit, für die ganze Klasse und im Durchschnitt. Der erkannte Text lässt sich korrigieren, die Zahlen passen sich sofort an.
- Getrennte Wörter am Zeilenende zählen einmal, auch über Seitengrenzen derselben Arbeit. Leere Seiten zählen mit 0 Wörtern. Ist eine Arbeit nur teilweise gezählt, steht das überall dabei, statt einer zu niedrigen Summe.
- „Als CSV speichern“ legt eine Tabelle (Name, Seiten, Wörter, Hinweis, Gesamtzeile) an, die deutsches Excel direkt öffnet (UTF-8 mit BOM, Semikolon). „In die Zwischenablage kopieren“ liefert dieselbe Tabelle tabulatorgetrennt. „Als PDF speichern“ und „Klassen-PDF speichern“ legen die Seiten mit Wortzahlen als PDF ab. Den Speicherort wählt man immer im Systemdialog.
- **„Berichtigen“ (Vorschau):** Nach Wahl eines Korrekturprofils (derzeit Deutsch, Englisch, Französisch, Spanisch und „Sachfach“ für alle Fächer, in denen nur die deutsche Sprachrichtigkeit korrigiert wird) erkennt Rotstift alle Seiten, korrigiert den Text mit einem zweiten lokalen Modell (Gemma 4 E2B) und schreibt die Korrekturzeichen aus [ADR 0002](docs/adr/0002-korrekturschema.md) wie mit rotem Fineliner auf das Original: Unterstreichung, Verbesserung darüber, Fehlerzeichen (etwa R, Z, G, A) am Rand. Dazu kommen eine Fehlerliste je Seite, eine Statistik je Arbeit und für die Klasse sowie „Als PDF speichern“ und „Klassen-PDF mit Korrekturen speichern“.
- **„Unsicher gelesen“:** Wo die Texterkennung selbst unsicher war, setzt Rotstift keine rote Marke, sondern unterstreicht die Stelle in der Prüfansicht grau gepunktet. Antippen zeigt den Vorschlag, die Lehrkraft übernimmt ihn als Fehler oder verwirft ihn. Solche Stellen fehlen in Statistik und PDF, solange sie nicht übernommen sind.

Genauigkeit der Wortzahl: Auf echter deutscher Handschrift (ScaDS.AI-Datensatz) lag sie im Mittel rund 2 % neben dem richtigen Wert, auf einzelnen Seiten bis 8 %. Die Zahl ist ein guter Richtwert, für eine exakte Zählung den erkannten Text kurz gegenlesen. Durchgestrichenes behandelt Rotstift noch nicht gesondert.

Genauigkeit der Berichtigung: Auf selbst geschriebenen, getippten Schülertexten findet die Korrektur 86 % der Fehler, 97 % der Markierungen stimmen ([Messung](docs/evaluations/2026-10-fehlermarkierung.md)). Auf Handschrift kommen Lesefehler der Texterkennung hinzu. Auf fehlerfreien Seiten bleiben dank der Lesesicherheit rund 1 bis 2 rote Fehlalarme je 100 Wörter, dazu etwa 10 Stellen „unsicher gelesen“ ([Messung](docs/evaluations/2026-10-lesefehler.md)). Deshalb ist „Berichtigen“ als Vorschau gekennzeichnet, und jedes PDF trägt den Hinweis, die automatische Korrektur zu prüfen.

Geschwindigkeit: Die Texterkennung braucht nur auf der CPU rund 12 Sekunden pro Seite auf einem Apple M4 Pro (4 Threads), unter Linux auf einem Ryzen 7 5700X 27 Sekunden mit 4 und 44 Sekunden mit 2 Threads, auf einfachen Laptops entsprechend länger ([Messung](docs/evaluations/2026-10-linux-simon-pc.md)). Mit der Grafikeinheit von Apple Silicon 2 bis 4 Sekunden. Die Korrektur kostet je Seite noch einmal rund 4 Sekunden auf dem M4 Pro und 17 Sekunden auf dem Ryzen. Erkennung und Korrektur laufen nacheinander und nie gleichzeitig, damit 8 GB Arbeitsspeicher reichen.

Geplant:

- Weniger Stellen „unsicher gelesen“ durch eine genauere Texterkennung, Schwelle auf echter Schülerhandschrift prüfen.
- Durchgestrichenes erkennen und nicht mitzählen.
- Weitere Fächer und Sprachen als Korrekturprofile, Statistik nach Schwere der Fehler.
- Signierte Installer für Windows und macOS.

## Erster Start

Zum Wörterzählen liest Rotstift die Handschrift mit einem KI-Modell, das auf dem eigenen Rechner läuft. Das Standardmodell GLM-OCR (rund 1,4 GB) wird beim ersten Mal heruntergeladen:

1. Seiten laden und auf „Texterkennung einrichten“ klicken. Solange das Modell fehlt, ist „Wörter zählen“ ausgegraut.
2. Im Dialog stehen Größe und Quelle. Der Download ist einmalig, danach arbeitet Rotstift komplett offline, und es werden keine Schülerdaten übertragen.
3. Der Download zeigt Fortschritt und Restzeit, lässt sich abbrechen und später an derselben Stelle fortsetzen. Rotstift prüft die Datei per SHA256, bevor sie benutzt wird.
4. Unter „Texterkennung verwalten“ lässt sich das Modell wieder löschen.

Ab 16 GB Arbeitsspeicher bietet Rotstift zusätzlich Qwen3-VL 4B (rund 3 GB) an, im Einrichtungsdialog und unter „Texterkennung verwalten“. Es zählt genauer, braucht aber etwa doppelt so lange und ist nur zum Wörterzählen gedacht. Beide Modelle können nebeneinander installiert sein, die Wahl bleibt gespeichert. Beim Wechsel wird der laufende Erkennungsprozess beendet, bereits gezählte Seiten behalten ihr Ergebnis. Der Wechsel ist gesperrt, solange gezählt wird, die Texterkennung startet oder ein Modell geladen, geprüft, importiert oder gelöscht wird. Wird das gewählte Modell gelöscht, gilt wieder GLM-OCR.

Zum Berichtigen braucht Rotstift ein zweites Modell, Gemma 4 E2B (rund 2,8 GB). Beim ersten „Berichtigen“ öffnet sich „Korrekturmodell einrichten“ mit denselben Möglichkeiten wie oben: Download mit Fortsetzen, Prüfung per SHA256, Import aus Datei. Verwaltet wird es unter „Korrektur verwalten“.

Rechner ohne Internet (etwa in Schulen): Die Modelldateien (`.gguf`) auf einem anderen Rechner von Hugging Face herunterladen, per USB-Stick übertragen und im Dialog über „Modell aus Datei importieren“ auswählen. Rotstift erkennt die Dateien am Hash und übernimmt nur passende.

Die Modelle stecken in `src-tauri/models.json` (Quelle auf einen Commit festgelegt, SHA256 und Größe je Datei, Startparameter, Prompt). Dort werden sie auch getauscht, sonst ist keine Codeänderung nötig. Der Download akzeptiert nur `https` und Hugging Face als Host (samt deren CDN). Die Dateien liegen im App-Datenverzeichnis unter `models/`.

## Datenschutz

- Keine Telemetrie, keine Cloud-Dienste. Netzwerkzugriff nur zum einmaligen Herunterladen von Modellen von Hugging Face.
- Die Modelle laufen über einen eingebetteten llama.cpp-Server auf dem eigenen Rechner. Er lauscht nur auf `127.0.0.1` und verlangt einen zufälligen Schlüssel, den nur die App kennt.
- Der Quellcode ist offen, damit Schulen und Datenschutzbeauftragte das prüfen können.

## Testversion installieren

Testversionen liegen unter [Releases](https://github.com/s-gehring/rotstift/releases). Solange keine Signierzertifikate hinterlegt sind (siehe [docs/signieren.md](docs/signieren.md)), sind sie nicht signiert, daher warnt das Betriebssystem beim ersten Start:

- **Windows:** Bei der SmartScreen-Meldung „Weitere Informationen“ und dann „Trotzdem ausführen“ wählen.
- **macOS:** Nach dem ersten Startversuch unter Systemeinstellungen, Datenschutz & Sicherheit, „Dennoch öffnen“ wählen. Meldet macOS, die App sei beschädigt: `xattr -dr com.apple.quarantine /Applications/Rotstift.app`.
- **Linux:** Das `.deb` oder `.rpm` installieren oder das AppImage ausführbar machen (`chmod +x`). Mindestens Ubuntu 22.04, Debian 12 oder eine vergleichbar aktuelle Distribution.

## Entwicklung

Voraussetzungen:

- Node 22 (siehe `.nvmrc`) und pnpm 12 (Version aus `packageManager`).
- Rust über rustup, die Version kommt aus `rust-toolchain.toml`. Unter macOS: `brew install rustup`.
- Linux zusätzlich die Tauri-Systempakete: `libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`.

Schnellstart:

```bash
pnpm install
pnpm fetch:runtime
pnpm dev
```

`pnpm fetch:runtime` lädt die gepinnte llama.cpp-Version samt SHA256-Prüfung nach `src-tauri/binaries/`. Ohne diesen Schritt bricht der Rust-Build ab. Modelle (GGUF) lädt die App selbst (siehe „Erster Start“), sie gehören nie ins Repo.

| Befehl                  | Zweck                                                                            |
| ----------------------- | -------------------------------------------------------------------------------- |
| `pnpm dev`              | App mit Hot Reload starten                                                       |
| `pnpm fetch:runtime`    | llama.cpp-Sidecar für das aktuelle System laden (`--target <triple>` für andere) |
| `pnpm dev:web`          | Nur das Frontend im Browser (Port 1420)                                          |
| `pnpm build`            | Installer für das aktuelle Betriebssystem bauen                                  |
| `pnpm check`            | Typprüfung, Lint, Format, Tests, dazu `cargo fmt`, `clippy` und `cargo test`     |
| `pnpm format`           | Prettier und `cargo fmt` anwenden                                                |
| `pnpm test`             | Vitest einmal ausführen (`pnpm test:watch` beobachtet)                           |
| `pnpm test:integration` | Echter Sidecar auf Beispielseiten (braucht Modell und Datensatz, siehe Test)     |

Ein Tag `v*` baut über `.github/workflows/release.yml` Installer für alle Plattformen als Release-Entwurf.

## Struktur

```text
src/              Frontend (React, TypeScript)
src/stats/        Statistik über korrigierte Texte
src/llm/          Client für das lokale Modell (über Rust-Commands)
src/models/       Modell-Registry, Einrichtungsdialog und Modellverwaltung
src/pipeline/     Seiten erkennen: Adapter auf das lokale Modell, Fortschritt, Wiederholung
src/overlay/      Korrekturen wie mit rotem Feinliner auf die Seite zeichnen (SVG-Ebene, PNG-Export)
scripts/          Werkzeuge, etwa der Download der llama.cpp-Runtime
src-tauri/        Tauri-Hülle in Rust (Fenster, Dateizugriff, llama-server-Sidecar)
docs/adr/         Architekturentscheidungen
```

Die Entscheidung für den Tech-Stack steht in [docs/adr/0001-tech-stack.md](docs/adr/0001-tech-stack.md), die Notation der Korrekturen auf der Seite in [docs/adr/0003-overlay.md](docs/adr/0003-overlay.md).

## Lizenz

[GPL-3.0-or-later](LICENSE). Die Installer enthalten llama.cpp (MIT), der Lizenztext liegt im Bundle unter `llama/LICENSE-llama.cpp`.
