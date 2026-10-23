# Rotstift

Desktop-App für Windows, macOS und Linux, die Schülerarbeiten (Scans, Fotos, PDFs) mit einem lokalen KI-Modell korrigiert und die Anmerkungen wie mit rotem Fineliner zwischen die Zeilen des Originals schreibt. Alle Daten bleiben auf dem eigenen Rechner, solange kein Cloud-Modell eingeschaltet ist.

## Hintergrund

Lehrkräfte erzielen mit Cloud-KI gute Ergebnisse beim Korrigieren, dürfen Schülerarbeiten aus Datenschutzgründen aber nicht an externe Dienste geben. Rotstift läuft standardmäßig vollständig lokal, auch auf einfachen Laptops mit 8 GB RAM ohne Grafikkarte. Auf stärkeren Rechnern lassen sich größere Modelle wählen.

## Stand

Rotstift erkennt handschriftliche Texte, zählt ihre Wörter und korrigiert sie, ohne Cloud-Modell komplett offline. Der Ablauf hat drei Schritte: Arbeiten laden, „Korrigieren“ (oder „Nur Wörter zählen“), Ergebnisse prüfen und exportieren. Das Bedienkonzept steht in [ADR 0005](docs/adr/0005-bedienkonzept.md).

- **Laden:** Bilder (PNG, JPEG, WebP) und PDFs ins Fenster ziehen. Jede Datei wird eine Arbeit (eine Schülerin oder ein Schüler) und heißt wie die Datei. Über das „…“-Menü einer Arbeit lässt sie sich umbenennen, mit einer anderen zusammenführen oder entfernen. Seiten lassen sich drehen, umsortieren (auch per Ziehen), in eine andere Arbeit verschieben, und „Ab hier neue Arbeit“ trennt einen Stapel, der als ein PDF gescannt wurde. Entfernen lässt sich rückgängig machen.
- **Korrigieren:** Nach Wahl des Fachs (Deutsch, Englisch, Französisch, Spanisch und „Sachfach“ für alle Fächer, in denen nur die deutsche Sprachrichtigkeit korrigiert wird) liest Rotstift alle Seiten mit einem lokalen KI-Modell (GLM-OCR), korrigiert den Text mit einem zweiten (Gemma 4 E2B) und schreibt die Korrekturzeichen aus [ADR 0002](docs/adr/0002-korrekturschema.md) wie mit rotem Fineliner auf das Original: Unterstreichung, Verbesserung darüber, Fehlerzeichen (etwa R, Z, G, A) am Rand. Ein Fortschrittsbalken zeigt die Restzeit.
- **Prüfen:** Ein Klick auf eine Arbeit öffnet sie groß, mit den Fehlern je Seite in einer Spalte daneben. Pfeiltasten blättern durch die Klasse. Den erkannten Text kann man je Seite bearbeiten, Wortzahl und Korrektur folgen. Die Klassenübersicht zeigt Wörter, Fehler und Fehlerarten je Arbeit und für die Klasse.
- **Gewichten:** Die Klassenübersicht und die Tabelle zeigen neben der Fehlerzahl den gewichteten Fehlerquotienten (gewichtete Fehler je 100 Wörter). Wiederholungsfehler zählen einmal je Arbeit, in den Fremdsprachen zählt die Rechtschreibung halb und die Zeichensetzung nicht. Die Gewichte je Fach lassen sich unter ⚙ Einstellungen, „Fehlergewichtung“ ändern ([ADR 0006](docs/adr/0006-fehlergewichtung.md)).
- **Unsicher gelesen:** Wo die Texterkennung selbst unsicher war, setzt Rotstift keine rote Marke, sondern unterstreicht die Stelle grau gepunktet. Die Lehrkraft übernimmt den Vorschlag als Fehler oder verwirft ihn. Solche Stellen fehlen in Statistik und PDF, solange sie nicht übernommen sind.
- **Nur Wörter zählen:** Erkennt die Seiten ohne Korrektur und braucht kein Korrekturmodell. Getrennte Wörter am Zeilenende zählen einmal, auch über Seitengrenzen derselben Arbeit. Leere Seiten zählen mit 0 Wörtern. Ist eine Arbeit nur teilweise gezählt, steht „mind.“ vor der Zahl.
- **Exportieren:** PDF je Arbeit oder für die ganze Klasse, eine Tabelle als CSV, die deutsches Excel direkt öffnet (UTF-8 mit BOM, Semikolon), oder dieselbe Tabelle in die Zwischenablage. Den Speicherort wählt man im Systemdialog.

Genauigkeit der Wortzahl: Auf echter deutscher Handschrift (ScaDS.AI-Datensatz) lag sie im Mittel rund 2 % neben dem richtigen Wert, auf einzelnen Seiten bis 8 %. Die Zahl ist ein guter Richtwert, für eine exakte Zählung den erkannten Text kurz gegenlesen. Mit einem oder zwei Strichen durchgestrichene Wörter erkennt Rotstift an der Tinte, zählt sie nicht mit und korrigiert sie nicht. Im erkannten Text stehen sie als `~~Wort~~`, so lässt sich eine Streichung auch von Hand setzen oder entfernen. Etwa die Hälfte der gestrichenen Wörter wird so erkannt, Gekritzel und Überschreibungen meist nicht ([Messung](docs/evaluations/2026-10-durchgestrichen.md)).

Genauigkeit der Korrektur: Auf selbst geschriebenen, getippten Schülertexten findet die Korrektur 86 % der Fehler, 97 % der Markierungen stimmen ([Messung](docs/evaluations/2026-10-fehlermarkierung.md)). Auf Handschrift kommen Lesefehler der Texterkennung hinzu. Auf fehlerfreien Seiten bleiben dank der Lesesicherheit rund 1 bis 2 rote Fehlalarme je 100 Wörter, dazu etwa 10 Stellen „unsicher gelesen“ ([Messung](docs/evaluations/2026-10-lesefehler.md)). Deshalb trägt jedes PDF den Hinweis, die automatische Korrektur zu prüfen.

Geschwindigkeit: Die Texterkennung braucht nur auf der CPU rund 12 Sekunden pro Seite auf einem Apple M4 Pro (4 Threads), unter Linux auf einem Ryzen 7 5700X 27 Sekunden mit 4 und 44 Sekunden mit 2 Threads, auf einfachen Laptops entsprechend länger ([Messung](docs/evaluations/2026-10-linux-simon-pc.md)). Mit der Grafikeinheit von Apple Silicon 2 bis 4 Sekunden. Die Korrektur kostet je Seite noch einmal rund 4 Sekunden auf dem M4 Pro und 17 Sekunden auf dem Ryzen. Erkennung und Korrektur laufen nacheinander und nie gleichzeitig, damit 8 GB Arbeitsspeicher reichen.

Geplant:

- Weniger Stellen „unsicher gelesen“ durch eine genauere Texterkennung, Schwelle auf echter Schülerhandschrift prüfen.
- Durchgestrichenes zuverlässiger erkennen, auch Gekritzel und Überschreibungen.

## Erster Start

Rotstift arbeitet mit KI-Modellen, die auf dem eigenen Rechner laufen. Sie werden einmalig heruntergeladen, wenn sie zum ersten Mal gebraucht werden:

1. Arbeiten laden und auf „Korrigieren“ klicken. Fehlen Modelle, öffnet sich „Einmalige Einrichtung“ mit der Gesamtgröße: GLM-OCR (rund 1,4 GB) für die Texterkennung und Gemma 4 E2B mit seinem Kopf für spekulatives Dekodieren (zusammen rund 2,9 GB) für die Korrektur. „Nur Wörter zählen“ braucht nur GLM-OCR.
2. „Herunterladen“ lädt alles in einem Schritt, mit Fortschritt und Restzeit. Ein abgebrochener Download setzt später an derselben Stelle fort. Rotstift prüft jede Datei per SHA256, bevor sie benutzt wird. Danach startet der Lauf von selbst, und Rotstift arbeitet offline. Es werden keine Schülerdaten übertragen.
3. Unter ⚙ „Einstellungen“ lassen sich die Modelle ansehen, löschen oder aus Dateien importieren.

Ab 16 GB Arbeitsspeicher bietet Rotstift in den Einstellungen zusätzlich Qwen3-VL 4B (rund 3 GB) als Texterkennung an. Es zählt genauer, braucht aber etwa doppelt so lange und ist nur zum Wörterzählen gedacht, weil es beim Abschreiben gelegentlich Fehler der Schüler verbessert. Beide Modelle können nebeneinander installiert sein, die Wahl bleibt gespeichert. Während eines Laufs oder solange ein Modell geladen, geprüft, importiert oder gelöscht wird, ist der Wechsel gesperrt. Wird das gewählte Modell gelöscht, gilt wieder GLM-OCR.

Wer einen Vertrag mit einem KI-Anbieter oder einen eigenen Server hat, kann in den Einstellungen je Schritt über „Cloud-Modell …“ ein entferntes Modell wählen (OpenAI-kompatibel, etwa IONOS, Mistral AI, STACKIT oder OpenAI). Das ist standardmäßig aus, Einzelheiten unter „Datenschutz“. Die Entscheidung steht in [ADR 0009](docs/adr/0009-cloud-modelle.md).

Rechner ohne Internet (etwa in Schulen): Die Modelldateien (`.gguf`) auf einem anderen Rechner von Hugging Face herunterladen, per USB-Stick übertragen und in der Einrichtung oder den Einstellungen über „Aus Datei importieren …“ auswählen. Rotstift erkennt die Dateien am Hash und übernimmt nur passende.

Die Modelle stecken in `src-tauri/models.json` (Quelle auf einen Commit festgelegt, SHA256 und Größe je Datei, Startparameter, Prompt). Dort werden sie auch getauscht, sonst ist keine Codeänderung nötig. Der Download akzeptiert nur `https` und Hugging Face als Host (samt deren CDN). Die Dateien liegen im App-Datenverzeichnis unter `models/`.

## Datenschutz

- Keine Telemetrie. Ohne Cloud-Modell greift Rotstift nur zum einmaligen Herunterladen von Modellen von Hugging Face aufs Netz.
- Cloud-Modelle sind standardmäßig aus. Wird für einen Schritt eines gewählt, sendet Rotstift die Daten dieses Schritts (Seitenbilder bei der Erkennung, erkannten Text bei den übrigen Schritten) an den gewählten Anbieter. Vorher erscheint ein Hinweis, der nur mit „Verwenden“ weitergeht (nicht bei einem Server auf demselben Rechner). Ein graues Wolkenzeichen neben „Korrigieren“ zeigt, solange ein Schritt nicht lokal läuft. Für Datenschutz und Verträge mit dem Anbieter ist die Lehrkraft beziehungsweise die Schule verantwortlich.
- Cloud-Aufrufe laufen nur über den Rust-Teil der App, nur über HTTPS (HTTP nur zu eigenen Servern im lokalen Netz und ohne Schlüssel) und ohne Weiterleitungen. Der Schlüssel liegt im Schlüsselbund des Systems, sonst nur bis zum Beenden im Speicher. Das Protokoll enthält nur Anbieter, Schritt, Dauer und Fehlerklasse, nie Inhalte oder Schlüssel.
- Die Modelle laufen über einen eingebetteten llama.cpp-Server auf dem eigenen Rechner. Er lauscht nur auf `127.0.0.1` und verlangt einen zufälligen Schlüssel, den nur die App kennt.
- Der Quellcode ist offen, damit Schulen und Datenschutzbeauftragte das prüfen können.

## Testversion installieren

Testversionen liegen unter [Releases](https://github.com/s-gehring/rotstift/releases). Die Installer sind nicht von Apple oder Microsoft signiert, daher warnt das Betriebssystem beim ersten Start. Die Warnung lässt sich einmalig bestätigen:

- **macOS (15 und neuer):** Die App in den Ordner „Programme“ ziehen und öffnen. macOS meldet, Rotstift könne nicht geprüft werden. Dann unter Systemeinstellungen → Datenschutz & Sicherheit nach unten scrollen, bei Rotstift „Dennoch öffnen“ wählen und mit dem Passwort bestätigen. Hilft das nicht: `xattr -dr com.apple.quarantine /Applications/Rotstift.app`.
- **Windows:** Bei der SmartScreen-Meldung „Weitere Informationen“ und dann „Trotzdem ausführen“ wählen.
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
| `pnpm dev:web`          | Nur das Frontend im Browser (Port 1420), mit „Demo-Klasse laden“ (Heftseiten)    |
| `pnpm build`            | Installer für das aktuelle Betriebssystem bauen                                  |
| `pnpm check`            | Typprüfung, Lint, Format, Tests, dazu `cargo fmt`, `clippy` und `cargo test`     |
| `pnpm format`           | Prettier und `cargo fmt` anwenden                                                |
| `pnpm test`             | Vitest einmal ausführen (`pnpm test:watch` beobachtet)                           |
| `pnpm test:integration` | Echter Sidecar auf Beispielseiten (braucht Modell und Datensatz, siehe Test)     |

Ein Tag `v*` baut über `.github/workflows/release.yml` Installer für alle Plattformen als Release-Entwurf. Vorher die Desktop-App nach [docs/praxistest.md](docs/praxistest.md) mit echten Modellen durchgehen.

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
