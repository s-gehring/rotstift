# Messung: Eine Klasse auf einem schwachen Rechner (Oktober 2026)

Frage: Wie lange braucht die ganze Kette (Erkennung, Rechtschreibung und Grammatik, Inhalt und Form) für eine Klasse auf einem Rechner ohne GPU, wo geht die Zeit hin, und reicht der Speicher für 8 GB?

## Ergebnis

**Eine Klasse mit 10 Arbeiten zu je 2 Seiten dauert mit 4 Threads 20 min, mit 8 Threads 18 min, also etwa 2 min je Arbeit.** Ohne Inhalt und Form sind es 16 bzw. 15 min. Die Hälfte der Zeit kostet die Erkennung. Modellwechsel fallen nicht ins Gewicht (genau einer je Lauf, auf der NVMe-SSD unter 3 s). Der Sidecar braucht höchstens 3,1 GB, das passt auf 8 GB.

| Lauf                    | Threads |      Klasse | je Arbeit |    Erkennung | Zeilenlage | Rechtschreibung und Grammatik | Inhalt und Form |
| ----------------------- | ------: | ----------: | --------: | -----------: | ---------: | ----------------------------: | --------------: |
| alle drei Stufen        |       4 |    20,0 min |   2,0 min | 614 s (51 %) | 66 s (5 %) |                  320 s (27 %) |    203 s (17 %) |
| Erkennung und Korrektur |       4 |    15,8 min |   1,6 min | 620 s (65 %) | 29 s (3 %) |                  302 s (32 %) |               – |
| alle drei Stufen        |       8 |    18,1 min |   1,8 min | 527 s (49 %) | 43 s (4 %) |                  315 s (29 %) |    198 s (18 %) |
| Erkennung und Korrektur |       8 | ≈ 14,8 min¹ | ≈ 1,5 min |      ≈ 527 s |     ≈ 43 s |                       ≈ 315 s |               – |

Je Einheit: Erkennung 30,7 s je Seite mit 4 Threads und 26,4 s mit 8, Rechtschreibung und Grammatik 16,0 bzw. 15,8 s je Seite, Inhalt und Form 20,3 bzw. 19,8 s je Arbeit. Alle 20 Seiten und 10 Arbeiten kamen in jedem Lauf ohne Fehler durch. „Je Arbeit“ ist die Klassenzeit geteilt durch 10: Der Lauf arbeitet stufenweise, die erste Arbeit ist also erst kurz vor dem Ende fertig.

¹ Abgeleitet aus den Stufen des 8-Thread-Laufs mit allen drei Stufen. Der eigene Lauf wurde von einem fremden Trainingsjob überlagert und verworfen (siehe Testumgebung). Mit 4 Threads stimmen beide Läufe in Erkennung (614 und 620 s) und Korrektur (320 und 302 s) überein, die Ableitung ist darum belastbar.

**8 Threads bringen kaum etwas.** Die Erkennung wird 1,17-mal schneller, Rechtschreibung und Grammatik und Inhalt und Form gar nicht. Die Textschritte erzeugen Token für Token und sind durch die Speicherbandbreite begrenzt, nicht durch die Kerne. Die Erkennung passt zur früheren Messung auf demselben Rechner ([Linux auf simon-pc](evaluations/2026-10-linux-simon-pc.md): 27,1 und 22,8 s je Seite, Faktor 1,19).

## Modellwechsel

Jeder Lauf startet genau zwei Modelle: GLM-OCR für die Erkennung und danach Gemma 4 E2B für Rechtschreibung und Grammatik. Inhalt und Form nutzt dieselbe Gemma-Datei und damit denselben Server, ohne Neustart. Es lief nie mehr als ein Server gleichzeitig.

| Zustand der Modelldatei                       | GLM-OCR laden | Gemma 4 E2B laden | alten Server beenden |
| --------------------------------------------- | ------------: | ----------------: | -------------------: |
| kalt (Seitencache vorher geleert), NVMe       |     1,2–1,3 s |         2,4–2,5 s |          0,15–0,18 s |
| warm (Datei im Seitencache)                   |         0,9 s |             1,3 s |          0,16–0,18 s |
| kalt, SATA-SSD mit 0,5 GB/s (geschätzt)       |         ≈ 3 s |             ≈ 6 s |                      |
| kalt, eMMC oder HDD mit 0,15 GB/s (geschätzt) |        ≈ 10 s |            ≈ 19 s |                      |

Selbst im schlechtesten Fall kosten die beiden Starts zusammen unter 30 s, also unter 3 % eines Laufs. Die Schätzungen teilen die Dateigrößen (1,43 und 2,84 GB) durch die Lesegeschwindigkeit. Gemessen dauert der kalte Start um etwa die Lesezeit der Datei länger als der warme.

## Reihenfolge der Stufen

`createReviewFlow` (`src/review/review-flow.ts`) arbeitet die Klasse stufenweise ab: Erst alle Seiten erkennen, dann für alle Seiten die Zeilenlage bestimmen, dann alle Seiten korrigieren, zuletzt Inhalt und Form für alle Arbeiten. Die Engine (`src/llm/engine.ts`) startet ein Modell nur neu, wenn der laufende Server eine andere Datei geladen hat. Damit gibt es je Lauf einen Wechsel, das ist das Minimum für zwei Modelle. Eine Reihenfolge je Arbeit würde 2 Wechsel je Arbeit kosten, hier also 20.

Unnötige Wechsel gibt es nicht. Nur wenn Inhalt und Form ein anderes Modell nutzt als die Korrektur (unter ⚙ wählbar), kommt ein zweiter Wechsel hinzu, auch das ist das Minimum. Nach dem Lauf bleibt Gemma geladen, der nächste Lauf beginnt darum wieder mit einem Wechsel zur Erkennung.

Nebenbefund: Die Gewichte der Fortschrittsanzeige in `src/app/run.ts` (Erkennung 51 %, Zeilenlage 4 %, Korrektur 30 %, Inhalt und Form 15 % bei allen drei Stufen) liegen nah an den gemessenen Anteilen (51 %, 5 %, 27 %, 17 %). Die Restzeit „noch X min“ ist damit gut kalibriert.

## Speicher

| Prozess                                               | Peak-RSS | Schätzung in der App (ADR 0008) |
| ----------------------------------------------------- | -------: | ------------------------------: |
| Sidecar mit GLM-OCR (mit Repack, wie die App)         |   2,3 GB |                         3,35 GB |
| Sidecar mit Gemma 4 E2B (`--no-repack`, wie auf 8 GB) |   3,1 GB |                         3,63 GB |
| Testprozess in Node (Seitenbilder, Zeilenlage)        |  0,34 GB |                               – |

Von den 3,1 GB bei Gemma sind rund 2,6 GB die per mmap eingeblendete Modelldatei. Diese Seiten kann das System unter Druck verwerfen und neu lesen, sie führen also eher zu Verlangsamung als zu einem Absturz.

**Gesamtbedarf auf 8 GB (Schätzung):** Sidecar 3,1 GB, App mit WebView und Seitenbildern etwa 0,5 bis 1 GB, System im Leerlauf etwa 2,5 bis 3,5 GB (Windows 11 oder macOS). Zusammen 6,1 bis 7,6 GB von 8,6 GB (8 GiB). **Das reicht**, lässt aber wenig Platz für einen offenen Browser. Die Reserve von 3,5 GiB für System und App aus ADR 0008 deckt das ab, und die Schätzungen der App liegen über den Messwerten. Gemessen sind nur Sidecar und Testprozess, App und System sind geschätzt.

## Testumgebung

| Punkt           | Wert                                                                                                                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rechner         | simon-pc: AMD Ryzen 7 5700X (Zen 3, 8 Kerne, 16 Threads), DDR4, NVMe-SSD, Fedora 44                                                                                                                                                                                                             |
| Laufzeit        | llama.cpp b11537, CPU-Build für Linux (`pnpm fetch:runtime`), `--n-gpu-layers 0`, `--threads` 4 oder 8, ohne `taskset`                                                                                                                                                                          |
| Modelle         | GLM-OCR (Q8_0) und Gemma 4 E2B (Q4_0) aus `src-tauri/models.json`, mit den Startparametern der App; Gemma mit `--no-repack` wie auf Rechnern unter 12 GiB                                                                                                                                       |
| Ablauf          | `createReviewFlow` mit echter Engine, `NodeSidecar`, `createLlmTranscriber`, `createSidecarCorrector` und `locateLines`, also derselbe Code wie in der App, nur ohne WebView und Rust-Sidecar                                                                                                   |
| Klasse          | Die 10 selbst geschriebenen Texte aus `eval/samples/content-form/`, je Text in zwei Hälften geteilt und als Handschrift gerendert (20 Seiten mit je 120 bis 160 Wörtern)                                                                                                                        |
| Inhalt und Form | Eine Aufgabenstellung für die ganze Klasse wie in der App: Persönlicher Brief über einen Umzug                                                                                                                                                                                                  |
| Kalt und warm   | Vor den Läufen mit allen drei Stufen wurden die Modelldateien per `posix_fadvise(DONTNEED)` aus dem Seitencache entfernt (mit `fincore` geprüft: 0 B), die anderen Läufe starteten warm                                                                                                         |
| Störungen       | Alle 5 s geprüft: Kein fremder llama-server während der gewerteten Läufe. Ein niedrig priorisierter Fremdprozess (Bilderzeugung auf der GPU) belegte dabei etwa einen Kern. Zwei Läufe wurden wegen Überschneidung mit fremden llama-servern bzw. einem Trainingsjob auf allen Kernen verworfen |

## Einordnung für einen 8-GB-Laptop

Die 4-Thread-Läufe sind ein optimistischer Stellvertreter. Ein Desktop-Zen-3 mit zwei Speicherkanälen ist schneller als ein älterer Laptop mit 4 Kernen, niedrigem Takt und oft nur einem Speicherkanal. Mit 2 Threads war die Erkennung auf demselben Rechner 1,6-mal langsamer als mit 4, und die Textschritte hängen an der Speicherbandbreite, die mit einem Kanal halbiert ist. Für so einen Laptop sind darum etwa 30 bis 40 min für eine Klasse wie diese mit allen drei Stufen zu erwarten (rund 1,5- bis 2-mal die 4-Thread-Zeit). Gemessen ist das nicht.

## Empfehlungen

1. **Dauer vor dem Start nennen.** Die Messung trägt eine einfache Faustregel: Etwa 30 s je Seite für die Erkennung, 15 s je Seite für Rechtschreibung und Grammatik und 20 s je Arbeit für Inhalt und Form, auf schwachen Laptops das Doppelte. Ein Hinweis wie „voraussichtlich 20 bis 40 Minuten“ vor dem Start hilft mehr als die Restzeit, die erst nach der ersten Seite erscheint.
2. **Threads: Vorgabe von llama.cpp lassen.** `threads: null` nimmt die physischen Kerne, auf einem 4-Kern-Laptop also 4. Mehr als 4 Threads bringen für die Textschritte nichts. Eine Obergrenze von 4 Threads für Gemma würde auf Rechnern mit vielen Kernen die Oberfläche entlasten, ohne Zeit zu kosten. Das braucht aber eine Begrenzung auf die Kernzahl in Rust (`min(4, Kerne)`), eine feste Zahl in `models.json` würde Rechner mit 2 Kernen überbuchen.
3. **Reihenfolge behalten.** Ein Wechsel je Lauf ist das Minimum. Weil ein Wechsel unter 3 s kostet, wäre es auf Rechnern unter 12 GiB auch günstig, das Modell nach dem Lauf zu beenden. Dann werden während der Durchsicht der Ergebnisse 3 GB frei, und der nächste Lauf zahlt nur die 1 bis 6 s für den Start. Umgesetzt ist das als Leerlauf-Ende auf allen Rechnern: Der Sidecar wird beendet, wenn er 5 Minuten lang nichts zu tun hatte (`IDLE_STOP_MS` in `src/llm/engine.ts`, Beenden über `llm_stop_if_idle` in `src-tauri/src/llm/runtime.rs`, Eintrag `sidecar_idle_stop` im Protokoll). Die nächste Anfrage startet ihn wie gewohnt neu.
4. **Speichergrenze unverändert lassen.** Die Warnung ab „Bedarf über Arbeitsspeicher minus 3,5 GiB“ passt zu den Messwerten. Gemma 4 E4B (5,2 GB) bleibt auf 8 GB zu Recht markiert.
5. **Im Praxistest messen, was hier fehlt:** Den Speicher der laufenden App (WebView mit 20 Seitenbildern) und die Laufzeit auf einem echten 8-GB-Laptop mit Windows.

Einen Engpass mit kleiner, offensichtlicher Lösung zeigt die Messung nicht. Die Erkennung ist der größte Posten, und dort helfen nur ein schnelleres Modell oder weniger Bild-Token, beides ändert die Qualität und braucht eine eigene Evaluation.

## Wie reproduzieren

```bash
eval/.venv/bin/python -I eval/samples/render.py --content-form --out <Ordner>
ROTSTIFT_INTEGRATION=1 ROTSTIFT_CLASS=<Ordner> ROTSTIFT_CLASS_LABEL=t4-voll \
  ROTSTIFT_THREADS=4 ROTSTIFT_NO_REPACK=1 ROTSTIFT_GPU_LAYERS=0 \
  pnpm vitest run eval/class-run.integration.test.ts
```

`ROTSTIFT_CLASS_CONTENT=0` lässt Inhalt und Form weg. Das Ergebnis steht als JSON in `<Ordner>/results/<Label>.json` (Gesamtzeit, Zeit je Stufe, Modellstarts, Peak-RSS je Modell). Für einen kalten Start vorher die Modelldateien aus dem Seitencache entfernen, unter Linux ohne Root etwa mit `os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)`.
