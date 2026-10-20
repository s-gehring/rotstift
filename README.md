# Rotstift

Desktop-App für Windows, macOS und Linux, die Schülerarbeiten (Scans, Fotos, PDFs) mit einem lokalen KI-Modell korrigiert und die Anmerkungen wie mit rotem Fineliner zwischen die Zeilen des Originals schreibt. Alle Daten bleiben auf dem eigenen Rechner.

## Hintergrund

Lehrkräfte erzielen mit Cloud-KI gute Ergebnisse beim Korrigieren, dürfen Schülerarbeiten aus Datenschutzgründen aber nicht an externe Dienste geben. Rotstift läuft vollständig lokal, auch auf einfachen Laptops mit 8 GB RAM ohne Grafikkarte. Auf stärkeren Rechnern lassen sich größere Modelle wählen.

## Stand

Version 0.1 zählt die Wörter handschriftlicher Texte, komplett offline:

- Bilder (PNG, JPEG, WebP) und PDFs per Drag and drop laden, Seiten drehen, sortieren und entfernen.
- „Wörter zählen“ liest jede Seite mit einem lokalen KI-Modell (GLM-OCR) und zeigt die Wortzahl je Seite und gesamt. Der erkannte Text lässt sich korrigieren, die Zahlen passen sich sofort an.
- Getrennte Wörter am Zeilenende zählen einmal, auch über Seitengrenzen derselben Datei. Leere Seiten zählen mit 0 Wörtern.

Genauigkeit: Auf echter deutscher Handschrift (ScaDS.AI-Datensatz) lag die Wortzahl im Mittel rund 2 % neben dem richtigen Wert, auf einzelnen Seiten bis 8 %. Die Zahl ist ein guter Richtwert, für eine exakte Zählung den erkannten Text kurz gegenlesen. Durchgestrichenes behandelt Rotstift noch nicht gesondert.

Geschwindigkeit: Nur auf der CPU eines schnellen Rechners (Apple M4 Pro, 4 Threads) rund 12 Sekunden pro Seite, auf einfachen Laptops entsprechend länger. Mit der Grafikeinheit von Apple Silicon 2 bis 4 Sekunden.

Geplant:

- Korrekturprofile je Fach und Sprache, mit einem zur Hardware passenden Modellvorschlag und stärkeren Modellen zur Wahl.
- Korrektur-Pipeline: Text als HTML mit standardisierten Korrekturzeichen annotieren, Anmerkungen in roter Schrift auf das Original übertragen.
- Export: Korrigiertes PDF und Statistik (Wörter, Fehler nach Art und Schwere).

## Erster Start

Zum Wörterzählen liest Rotstift die Handschrift mit einem KI-Modell, das auf dem eigenen Rechner läuft. Das Standardmodell GLM-OCR (rund 1,4 GB) wird beim ersten Mal heruntergeladen:

1. Seiten laden und auf „Texterkennung einrichten“ klicken. Solange das Modell fehlt, ist „Wörter zählen“ ausgegraut.
2. Im Dialog stehen Größe und Quelle. Der Download ist einmalig, danach arbeitet Rotstift komplett offline, und es werden keine Schülerdaten übertragen.
3. Der Download zeigt Fortschritt und Restzeit, lässt sich abbrechen und später an derselben Stelle fortsetzen. Rotstift prüft die Datei per SHA256, bevor sie benutzt wird.
4. Unter „Texterkennung verwalten“ lässt sich das Modell wieder löschen.

Ab 16 GB Arbeitsspeicher bietet Rotstift zusätzlich Qwen3-VL 4B (rund 3 GB) an, im Einrichtungsdialog und unter „Texterkennung verwalten“. Es zählt genauer, braucht aber etwa doppelt so lange und ist nur zum Wörterzählen gedacht. Beide Modelle können nebeneinander installiert sein, die Wahl bleibt gespeichert. Beim Wechsel wird der laufende Erkennungsprozess beendet, bereits gezählte Seiten behalten ihr Ergebnis. Der Wechsel ist gesperrt, solange gezählt wird, die Texterkennung startet oder ein Modell geladen, geprüft, importiert oder gelöscht wird. Wird das gewählte Modell gelöscht, gilt wieder GLM-OCR.

Rechner ohne Internet (etwa in Schulen): Beide Modelldateien (`.gguf`) auf einem anderen Rechner von Hugging Face herunterladen, per USB-Stick übertragen und im Dialog über „Modell aus Datei importieren“ auswählen. Rotstift erkennt die Dateien am Hash und übernimmt nur passende.

Das Modell steckt in `src-tauri/models.json` (Quelle auf einen Commit festgelegt, SHA256 und Größe je Datei, Startparameter, Prompt). Dort wird auch das Modell getauscht, sonst ist keine Codeänderung nötig. Der Download akzeptiert nur `https` und Hugging Face als Host (samt deren CDN). Die Dateien liegen im App-Datenverzeichnis unter `models/`.

## Datenschutz

- Keine Telemetrie, keine Cloud-Dienste. Netzwerkzugriff nur zum einmaligen Herunterladen von Modellen von Hugging Face.
- Die Modelle laufen über einen eingebetteten llama.cpp-Server auf dem eigenen Rechner. Er lauscht nur auf `127.0.0.1` und verlangt einen zufälligen Schlüssel, den nur die App kennt.
- Der Quellcode ist offen, damit Schulen und Datenschutzbeauftragte das prüfen können.

## Testversion installieren

Testversionen liegen unter [Releases](https://github.com/s-gehring/rotstift/releases). Sie sind nicht signiert, daher warnt das Betriebssystem beim ersten Start:

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
scripts/          Werkzeuge, etwa der Download der llama.cpp-Runtime
src-tauri/        Tauri-Hülle in Rust (Fenster, Dateizugriff, llama-server-Sidecar)
docs/adr/         Architekturentscheidungen
```

Die Entscheidung für den Tech-Stack steht in [docs/adr/0001-tech-stack.md](docs/adr/0001-tech-stack.md).

## Lizenz

[GPL-3.0-or-later](LICENSE). Die Installer enthalten llama.cpp (MIT), der Lizenztext liegt im Bundle unter `llama/LICENSE-llama.cpp`.
