# Rotstift

Desktop-App für Windows, macOS und Linux, die Schülerarbeiten (Scans, Fotos, PDFs) mit einem lokalen KI-Modell korrigiert und die Anmerkungen wie mit rotem Fineliner zwischen die Zeilen des Originals schreibt. Alle Daten bleiben auf dem eigenen Rechner.

## Hintergrund

Lehrkräfte erzielen mit Cloud-KI gute Ergebnisse beim Korrigieren, dürfen Schülerarbeiten aus Datenschutzgründen aber nicht an externe Dienste geben. Rotstift läuft vollständig lokal, auch auf einfachen Laptops mit 8 GB RAM ohne Grafikkarte. Auf stärkeren Rechnern lassen sich größere Modelle wählen.

## Stand

Projektgerüst: Leeres Fenster, Wortzählung für die Statistik, CI und Release-Builds. Geplant:

- Bilder und PDFs per Drag and drop laden, Seiten drehen und sortieren.
- Korrekturprofile je Fach und Sprache, mit einem zur Hardware passenden Modellvorschlag.
- Korrektur-Pipeline: Handschrift transkribieren, als HTML mit standardisierten Korrekturzeichen annotieren, Anmerkungen in roter Schrift auf das Original übertragen.
- Export: Korrigiertes PDF und Statistik (Wörter, Fehler nach Art und Schwere).

## Datenschutz

- Keine Telemetrie, keine Cloud-Dienste. Netzwerkzugriff nur zum Herunterladen von Modellen.
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

`pnpm fetch:runtime` lädt die gepinnte llama.cpp-Version samt SHA256-Prüfung nach `src-tauri/binaries/`. Ohne diesen Schritt bricht der Rust-Build ab. Modelle (GGUF) gehören in das App-Datenverzeichnis unter `models/`, nie ins Repo.

| Befehl               | Zweck                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| `pnpm dev`           | App mit Hot Reload starten                                                       |
| `pnpm fetch:runtime` | llama.cpp-Sidecar für das aktuelle System laden (`--target <triple>` für andere) |
| `pnpm dev:web`       | Nur das Frontend im Browser (Port 1420)                                          |
| `pnpm build`         | Installer für das aktuelle Betriebssystem bauen                                  |
| `pnpm check`         | Typprüfung, Lint, Format, Tests, dazu `cargo fmt`, `clippy` und `cargo test`     |
| `pnpm format`        | Prettier und `cargo fmt` anwenden                                                |
| `pnpm test`          | Vitest einmal ausführen (`pnpm test:watch` beobachtet)                           |

Ein Tag `v*` baut über `.github/workflows/release.yml` Installer für alle Plattformen als Release-Entwurf.

## Struktur

```text
src/              Frontend (React, TypeScript)
src/stats/        Statistik über korrigierte Texte
src/llm/          Client für das lokale Modell (über Rust-Commands)
scripts/          Werkzeuge, etwa der Download der llama.cpp-Runtime
eval/             Modell-Evaluation für Handschrift (Proben, Harness)
src-tauri/        Tauri-Hülle in Rust (Fenster, Dateizugriff, llama-server-Sidecar)
docs/adr/         Architekturentscheidungen
docs/evaluations/ Messergebnisse und Modellempfehlungen
```

Die Entscheidung für den Tech-Stack steht in [docs/adr/0001-tech-stack.md](docs/adr/0001-tech-stack.md).

## Lizenz

[GPL-3.0-or-later](LICENSE). Die Installer enthalten llama.cpp (MIT), der Lizenztext liegt im Bundle unter `llama/LICENSE-llama.cpp`.
