# Evaluation: Linux auf einem Desktop-Ryzen (Oktober 2026)

Frage: Läuft Rotstift 0.1.0 unter Linux, und wie schnell zählt es Wörter, wenn nur wenige CPU-Kerne zur Verfügung stehen (Proxy für einen schwachen 8-GB-Laptop)? Bisher war Linux nur durch CI-Builds belegt.

## Ergebnis

**Die Linux-Pakete laufen.** AppImage und rpm starten unter Fedora 44, die Oberfläche wird korrekt gezeichnet, und der mitgelieferte `rotstift-llama-server` (llama.cpp b11537) startet mit den gebündelten Bibliotheken. Auf der CPU zählt GLM-OCR 10 echte Handschriftseiten mit 2 Threads in 44 s, mit 4 Threads in 27 s und mit 8 Threads in 23 s pro Seite, bei 2,6 GiB Peak-RAM des Servers. Die Wortzahl weicht im Mittel um 1,6 bis 1,8 % ab, wie auf dem Mac.

Nicht geprüft ist der Ablauf in der laufenden App (Modell laden, „Wörter zählen“ drücken), siehe „Nicht geprüft“.

## Testumgebung

| Punkt     | Wert                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| Rechner   | Desktop mit AMD Ryzen 7 5700X (Zen 3, 8 Kerne, 16 Threads, 32 MB L3), 62 GB RAM                                             |
| System    | Fedora 44 (x86_64), glibc 2.43, WebKitGTK 2.52.5 (`webkit2gtk4.1`), GTK 3.24.52                                             |
| Grafik    | Nicht benutzt: Server mit `--device none --n-gpu-layers 0`, GUI in einem virtuellen X-Display (Xvfb) mit Software-Rendering |
| Runtime   | llama.cpp b11537, `pnpm fetch:runtime --target x86_64-unknown-linux-gnu` (CPU-Build)                                        |
| Modell    | GLM-OCR (Q8_0) aus `src-tauri/models.json`, Einstellungen wie in der Registry                                               |
| Daten     | ScaDS.AI German Handwriting Full-Page Dataset (Zenodo 18283705, CC BY 4.0), Seiten 000 bis 009                              |
| Threads   | `taskset` auf die logischen CPUs 0 bis N-1, das sind N verschiedene physische Kerne                                         |
| Störungen | Während der gezählten Läufe lief kein anderer `llama-server` auf dem Rechner (geprüft)                                      |

## Geschwindigkeit und Genauigkeit

10 Seiten je Lauf, ein Server pro Lauf, Start des Servers jeweils etwa 1 s (Modell im Seiten-Cache).

| Threads | Mittel s/Seite | schnellste bis langsamste | Peak-RSS Server | Wortzahl-Abweichung (Mittel / Maximum) | Wörter gesamt (Ground Truth 990) |
| ------- | -------------- | ------------------------- | --------------- | -------------------------------------- | -------------------------------- |
| 2       | 43,6           | 23,8 bis 76,0 s           | 2,6 GiB         | 1,8 % / 7,0 %                          | 1004 (+1,4 %)                    |
| 4       | 27,1           | 15,6 bis 44,4 s           | 2,6 GiB         | 1,7 % / 7,0 %                          | 1003 (+1,3 %)                    |
| 8       | 22,8           | 13,5 bis 35,3 s           | 2,6 GiB         | 1,6 % / 7,0 %                          | 1002 (+1,2 %)                    |

Seite 008 (1281 × 1342 px) ist mit auf 1152 px Kantenlänge verkleinertem Bild gemessen, wie es die App tut (siehe „Fund“). Alle anderen Seiten sind kleiner und gehen unverändert in den Test.

Einordnung:

- Von 2 auf 4 Threads wird es 1,6-mal, von 4 auf 8 nur noch 1,2-mal schneller. Mehr als 4 Threads bringen auf diesem Rechner wenig.
- Der Mac (Apple M4 Pro, 4 Threads) braucht rund 12 bis 14 s pro Seite, dieser Ryzen mit 4 Threads 27 s. Ein Laptop-Prozessor mit 2 bis 4 Kernen dürfte nicht schneller sein als die 2-Thread-Zeile. Eine Klasse mit 25 Seiten braucht dort ungefähr 18 Minuten.
- Die Wortzahlen sind pro Thread-Zahl nicht identisch (Seite 002 und 004 unterscheiden sich um 1 bis 2 Wörter), vermutlich weil die Gleitkomma-Summenreihenfolge von der Thread-Zahl abhängt. Der Einfluss auf die Genauigkeit ist vernachlässigbar.
- Die größte Abweichung (7 %) hat Seite 003 bei allen Thread-Zahlen: GLM-OCR liest dort 107 statt 100 Wörter.

## Fund: Integrationstest skaliert das Bild nicht

`src/pipeline/llm.integration.test.ts` schickt das Original-JPEG an den Server, ohne `imageMaxEdge` (1152 px) anzuwenden. Die App verkleinert vorher. Das fällt nur bei Seite 008 auf, die größer als 1152 px ist: Unverkleinert gerät sie mit 4 und mit 8 Threads in eine Wiederholungsschleife und stößt an das Limit von 2048 Ausgabe-Token. Die App meldet das korrekt als „Antwort des Modells war unvollständig“ (130 s bzw. 110 s verbraucht). Mit 2 Threads blieb die Ausgabe knapp unter dem Limit (121 s, 95 statt 92 Wörter). Verkleinert auf 1152 px liefert dieselbe Seite 90 Wörter (−2,2 %) in 35 bis 76 s.

Das ist kein Linux-Fehler, sondern eine Lücke im Test: Er misst auf großen Seiten etwas anderes als die App. Sinnvoll wäre, im Test dieselbe Verkleinerung wie in der App anzuwenden. Der Schutz gegen Schleifen (`max_tokens`, Fehlermeldung statt falscher Zahl) hat auf Linux wie vorgesehen gegriffen.

## Smoke-Test der Pakete

| Prüfung                                           | Ergebnis                                                                                                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AppImage (`Rotstift_0.1.0_amd64.AppImage`, 93 MB) | Startet direkt (FUSE ist vorhanden), bringt eigenes WebKitGTK mit, Fenster zeichnet („Rotstift“, „Arbeit laden“, „Wörter zählen“ ausgegraut bis zur Einrichtung), Prozess läuft über Minuten ohne Absturz und ohne Meldung auf stderr |
| rpm (`Rotstift-0.1.0-1.x86_64.rpm`), entpackt     | `/usr/bin/rotstift` startet gegen das System-WebKitGTK 2.52.5 und zeichnet dasselbe Fenster (gleich großer Screenshot)                                                                                                                |
| Abhängigkeiten des rpm                            | `libgomp`, `libgtk-3.so.0`, `libstdc++ >= 12`, `libwebkit2gtk-4.1.so.0`, `openssl-libs >= 3` sind alle durch installierte Pakete erfüllt                                                                                              |
| `rotstift-llama-server --version`                 | `version: 0.6.0-dev (build 11537)`, alle Bibliotheken gefunden (mit `LD_LIBRARY_PATH` auf das gebündelte `llama/`, wie es die App setzt)                                                                                              |
| App-Datenverzeichnis                              | Wird beim Start angelegt (`tv.gehring.rotstift`, 28 KB, ohne Modell)                                                                                                                                                                  |

Hinweis zum rpm: Der Sidecar hat `RUNPATH $ORIGIN/../lib`, die Bibliotheken liegen im rpm aber unter `/usr/lib/Rotstift/llama`. Ein direkter Aufruf ohne `LD_LIBRARY_PATH` findet `libllama-server-impl.so` nicht. Die App setzt die Variable beim Start (`src-tauri/src/llm/process.rs`), im Alltag stört das also nicht. Ob der Start aus dem installierten rpm in der App klappt, wurde nicht geprüft.

## Nicht geprüft

- Der Ablauf in der App (Dateien importieren, Modell einrichten, „Wörter zählen“): Dafür fehlen auf dem Rechner `cargo` und `webkit2gtk4.1-devel` für einen Debug-Build sowie `xdotool` zum Bedienen der Oberfläche. Installiert wurde nichts. Die Modelle liefen deshalb über den Integrationstest und nicht über die App.
- Drag and drop, PDF-Import, Dateidialog, rpm- und deb-Installation, Wayland, Betrieb mit Grafikbeschleunigung.
- Distributionen mit älterem glibc oder WebKitGTK als Fedora 44. Das AppImage bringt sein WebKitGTK selbst mit, das rpm nutzt das des Systems.

## Wie reproduzieren

Der Integrationstest braucht dafür keinen lokalen Patch mehr: `ROTSTIFT_THREADS` setzt `--threads`, `ROTSTIFT_GPU_LAYERS=0` setzt `--n-gpu-layers 0` und `--device none`, und die Seiten werden vor dem Senden wie in der App auf `imageMaxEdge` verkleinert. Die Messreihe selbst entstand noch mit einem lokalen Patch, der zusätzlich einen fehlgeschlagenen Aufruf als Zeile `FEHLER` ausgab, statt den Lauf abzubrechen. Aufruf je Thread-Zahl N:

```bash
pnpm fetch:runtime --target x86_64-unknown-linux-gnu
ROTSTIFT_INTEGRATION=1 ROTSTIFT_PAGES=10 ROTSTIFT_THREADS=N ROTSTIFT_GPU_LAYERS=0 \
  ROTSTIFT_MODELS_DIR=<Ordner mit den GLM-OCR-Dateien> ROTSTIFT_DATASET=<entpackter Datensatz> \
  taskset -c 0-$((N-1)) pnpm test:integration
```

Quelle der Daten: Thomas Burghardt und Till Nestler (ScaDS.AI Dresden/Leipzig), _ScaDS.AI German Handwriting Full-Page Dataset_, [doi:10.5281/zenodo.18283705](https://doi.org/10.5281/zenodo.18283705), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Der Datensatz liegt nicht im Repo.
