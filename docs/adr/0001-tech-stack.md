# 0001: Tech-Stack

- Status: Angenommen
- Datum: 2026-10-19

## Kontext

In r/lehrerzimmer berichtet eine Lehrkraft, dass Cloud-KI gescannte Schülerarbeiten gut bewertet, der Einsatz aber am Datenschutz scheitert. Rotstift soll dieselbe Hilfe vollständig lokal bieten:

- Bilder und PDFs per Drag and drop laden, Seiten drehen und sortieren.
- Ein Knopf „Berichtigen“: Handschrift transkribieren, als HTML mit standardisierten Korrekturzeichen annotieren, die Anmerkungen klein und rot zwischen die Zeilen des Originals schreiben.
- Ergebnis: Korrigiertes Dokument und Statistik (Wörter, Fehler, Schwere).

Randbedingungen aus dem Interview:

- Läuft auf Windows, macOS und Linux. Lehrkräfte testen früh, also Installer von Anfang an.
- Muss auf einem schwachen Laptop mit 8 GB RAM ohne GPU laufen, stärkere Modelle sollen wählbar sein.
- Die KI-Runtime wird eingebettet, keine separate Installation wie Ollama.
- Korrekturprofile je Fach und Sprache, das Modell wird dazu passend vorgeschlagen.
- Öffentliches Repo unter GPL-3.0.

## Entscheidung

| Bereich       | Wahl                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Desktop-Hülle | Tauri 2 mit dünner Rust-Schicht (Fenster, Dateizugriff, Sidecar-Steuerung, Modell-Download, Hardware)  |
| KI-Runtime    | llama.cpp `llama-server` als eingebetteter Sidecar, Modelle im GGUF-Format                             |
| Frontend      | TypeScript strict, Vite, React; pdf.js zum Rendern, pdf-lib zum Schreiben, Zod für das Korrekturschema |
| Qualität      | Vitest, oxlint mit tsgolint, Prettier; `cargo fmt`, `clippy`, `cargo test`; alles hinter `pnpm check`  |
| Daten         | Keine Datenbank, keine Telemetrie; Netzwerk nur für Modell-Downloads                                   |
| CI            | GitHub Actions: `check` auf Linux, Build auf Linux, Windows, macOS; Tag `v*` erzeugt Release-Entwurf   |

Pipeline: Seite rendern, Vision-Modell transkribiert mit Zeilenpositionen, HTML, Text-Modell setzt standardisierte Korrektur-Tags, Schema-Prüfung, Overlay in roter Handschrift auf dem Original, Export als PDF und Statistik. Zwei kleine Modelle laufen nacheinander, damit beide in 8 GB passen.

## Begründung

- Tauri nutzt die System-WebView statt eines gebündelten Chromium. Installer bleiben bei wenigen Megabyte und die RAM-Grundlast gering, was auf 8-GB-Rechnern dem Modell zugutekommt. Sidecars und Installer für alle drei Plattformen sind eingebaut.
- `llama-server` gibt es als offizielle Binaries für CPU, Metal und Vulkan. Es unterstützt Vision-Modelle, lädt Gewichte per mmap und spricht eine OpenAI-kompatible API. Derselbe Client kann daher optional ein stärkeres lokales Modell oder einen Server im Schulnetz ansprechen.
- Das Web-Ökosystem hat die ausgereiftesten Bausteine für PDF-Darstellung, PDF-Erzeugung und Drag and drop. React ist aus anderen Projekten bekannt.
- Offener Quellcode erlaubt Schulen und Datenschutzbeauftragten, die Datenschutzzusage zu prüfen.

## Verworfene Alternativen

- **Electron mit node-llama-cpp:** Durchgängig TypeScript und einheitliches Chromium, aber rund 100 MB Installer und 200 bis 400 MB RAM-Grundlast, die auf schwachen Laptops dem Modell fehlen.
- **llama.cpp per Rust-Bindings im Prozess:** Eigene Kompilierung je Plattform und Backend macht die CI aufwendig. Der Sidecar liefert dieselbe Funktion mit offiziellen Binaries.

## Konsequenzen

- Rust wird als zweite Toolchain gebraucht, bleibt aber auf die Systemanbindung beschränkt.
- Die Darstellung hängt von der System-WebView ab (WebView2, WKWebView, WebKitGTK) und muss auf allen drei Plattformen getestet werden.
- Installer sind zunächst unsigniert, Tester müssen Warnungen von macOS und Windows bestätigen.

## Offene Punkte

- Modellauswahl: Qualität der Handschrifterkennung auf 8 GB ohne GPU mit einem Evaluationsset aus selbst geschriebenen Proben messen.
- Code-Signing und Notarisierung für macOS und Windows.
- Strategien für schwache Rechner (mmap, Teil-Offload) und ein Standard für die Fehlerschwere.
