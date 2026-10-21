# 0008: Modellwahl je Schritt und eigene Modelle

- Status: Angenommen
- Datum: 2026-10-21

## Kontext

Die Korrektur läuft in drei Schritten mit je einem Modell: Erkennung (Rolle `transcriber`, Vorgabe GLM-OCR), Rechtschreibung und Grammatik (`corrector`, Vorgabe Gemma 4 E2B) und Inhalt und Form (eigene dritte Rolle, Vorgabe dieselbe Gemma-Datei). Bisher ist nur die Erkennung wählbar, und nur aus `src-tauri/models.json`. Die Auswahl steht in `selection.json` als ein einziges `modelId`.

Lehrkräfte sollen je Schritt ein anderes Modell nutzen können: ein geprüftes größeres für Rechner mit mehr Speicher, aber auch eines, das wir nicht empfehlen. Dabei gilt weiter: Keine Netzwerkzugriffe außer Modell-Downloads, CSP unverändert, alles läuft auf einem Rechner mit 8 GB ohne GPU.

## Entscheidung

### Auswahl je Schritt

Unter ⚙ zeigt jeder Schritt alle Einträge seiner Rolle, ohne Filter nach Arbeitsspeicher:

1. **Empfohlen:** das Vorgabemodell des Schritts aus `models.json`, vorausgewählt.
2. **Geprüfte Kandidaten:** weitere Einträge derselben Rolle aus `models.json`, gemessen mit der Eval (Ergebnisse unten). Neu ist Gemma 4 E4B für Rechtschreibung und für Inhalt und Form.
3. **Eigene Modelle:** über „Eigenes Modell …“ aus einem Hugging-Face-Link oder einer lokalen GGUF-Datei.

Jede Zeile zeigt Name, Dateigröße, „braucht etwa X GB“ und den Zustand, bei eigenen Modellen zusätzlich das Repo oder „Eigene Datei“. Erklärende Notizen und Abzeichen gibt es nicht.

Es gibt zwei Dateirollen, `transcriber` und `corrector`. Inhalt und Form ist ein dritter Auswahlplatz über die `corrector`-Einträge, keine eigene Rolle; die Rollen stehen damit nur einmal in Rust (`Role`) und in TS (`FileRole`), die Plätze in Rust als `Slot`. Die Auswahl liegt in `selection.json` je Platz:

```json
{ "modelId": "glm-ocr-q8", "correctorId": "gemma-4-e4b-q4", "reviewerId": "custom-3f9a1c0e2b7d" }
```

Eine unbekannte ID fällt auf die Empfehlung des Platzes zurück. Wird ein Eintrag gelöscht, setzt `forget` jeden Platz zurück, der ihn nutzt.

Die Auswahl hält je Platz eine Eintrags-ID, und jeder Eintrag trägt seine Herkunft in `source.kind`. Eine spätere dritte Art `{ kind: 'remote', providerId, model }` passt als weitere Herkunft dazu, ohne dass sich Auswahl, Plätze oder Rollen ändern. Gebaut ist sie nicht.

### Eigene Modelle: Speicherort und Schema

Eigene Einträge stehen nicht in `models.json` (die Datei ist in die App kompiliert und geprüft), sondern in `custom-models.json` im App-Datenordner neben dem Modellordner. Ein Eintrag beschreibt nur Herkunft und Dateien, keine Parameter:

```json
{
  "version": 1,
  "models": [
    {
      "id": "custom-3f9a1c0e2b7d",
      "role": "corrector",
      "source": {
        "kind": "huggingFace",
        "repo": "unsloth/Qwen3.5-4B-GGUF",
        "revision": "<40 Hex-Zeichen>"
      },
      "files": {
        "model": {
          "name": "Qwen3.5-4B-Q4_K_M.gguf",
          "url": "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/<commit>/Qwen3.5-4B-Q4_K_M.gguf",
          "sha256": "…",
          "bytes": 2740000000
        },
        "mmproj": null
      }
    },
    {
      "id": "custom-8b21d47c90aa",
      "role": "transcriber",
      "source": { "kind": "file" },
      "files": {
        "model": { "name": "…", "url": "", "sha256": "…", "bytes": 0 },
        "mmproj": { "name": "…", "url": "", "sha256": "…", "bytes": 0 }
      }
    }
  ]
}
```

- `id` ist `custom-` und die ersten 12 Hex-Zeichen der SHA-256 über die Prüfsummen von Modell und mmproj. Derselbe Eintrag entsteht so nicht zweimal. Stimmen Rolle und Prüfsummen mit einem Eintrag aus `models.json` überein, wird dieser gewählt und kein eigener angelegt.
- `files.*.name` ist der Dateiname im Modellordner. Gibt es schon eine Datei mit derselben Prüfsumme, wird ihr Name übernommen. Kollidiert der Name mit einer Datei anderer Prüfsumme, bekommt er die ersten 8 Hex-Zeichen der Prüfsumme als Präfix.
- Rust prüft jeden Eintrag beim Lesen: ID passt zu den Prüfsummen, Rolle passt zum mmproj, schlichter `.gguf`-Name, Hex-Länge, bei Links eine auf den Commit gepinnte URL auf `huggingface.co`, bei Dateien eine leere URL. Ungültige Einträge werden übersprungen, nie stillschweigend repariert.
- Die TS-Registry baut aus einem `CustomModel` mit `customEntry` ein vollständiges `ModelInfo` oder `CorrectorInfo`. Der übrige Code sieht nur diese vollständigen Einträge.

### Vorlage je Rolle: Prompt und Parameter

Eigene Modelle nutzen Prompt und Parameter eines geprüften Eintrags derselben Rolle und das Chat-Template aus der GGUF-Datei (llama-server mit `--jinja`, wie bisher). Welcher Eintrag das ist, steht in `models.json` unter `customTemplates`:

```json
"customTemplates": { "transcriber": "qwen3-vl-4b-q4", "corrector": "gemma-4-e2b-q4" }
```

Rust und TS prüfen beim Laden, dass beide Vorlagen existieren und die richtige Rolle haben. Der eigene Eintrag übernimmt `server`, `request`, `prompt`, `system` und `lineMode` der Vorlage, mit drei Ausnahmen:

- **Erkennung:** Vorlage ist Qwen3-VL, nicht GLM-OCR, weil „Text Recognition:“ nur für GLM-OCR gilt und der allgemeine Transkriptionsauftrag von Qwen3-VL für andere Vision-Modelle passt.
- **Lesesicherheit:** `uncertainBelow` ist für eigene Modelle `null`, es gibt also keine Hinweise „unsicher gelesen“. Die Schwelle hängt stark vom Modell ab (0,8 bis 0,98, siehe [Erkennung genauer](../evaluations/2026-10-erkennung-genauer.md)), und eine ungeprüfte Schwelle markiert entweder jedes dritte Wort oder versteckt Fehler.
- **`cpuRepack`** ist `false` (spart auf 8 GB rund 1,3 GB, siehe Gemma E2B).

Der Eintrag wird bei jedem Start neu aus der Vorlage gebaut. Ändert sich ein Prompt der App, gilt er sofort auch für eigene Modelle.

### Hugging-Face-Links auflösen und pinnen

Angenommen werden Repo-Links (`https://huggingface.co/<org>/<repo>`, auch `hf.co`), Links auf einen Stand (`/tree/<rev>`) und Links auf eine Datei (`/blob/<rev>/<pfad>` oder `/resolve/<rev>/<pfad>`). Rust löst sie mit zwei API-Aufrufen an `huggingface.co` auf:

1. `GET /api/models/<org>/<repo>/revision/<rev>` (bei Repo-Links `main`) liefert den Commit und ob das Repo eine Anmeldung verlangt. Ab hier steht überall der Commit, nie ein Branch.
2. `GET /api/models/<org>/<repo>/tree/<commit>?recursive=true` liefert je Datei Größe und `lfs.oid`, die SHA-256.

Die Lehrkraft wählt dann eine GGUF-Datei. Vorausgewählt ist bei Modellen `Q4_K_M`, sonst `Q4_0`, sonst `Q8_0`; bei mmproj `F16`, sonst `BF16`, sonst `Q8_0`. Vor dem Anlegen liest Rust mit einem Range-Request die ersten 4 MB jeder gewählten Datei und prüft den GGUF-Kopf: Magic `GGUF`, Version 2 oder 3, `general.architecture`. Eine Datei mit der Architektur `clip` ist ein mmproj und kein Modell.

Der Download geht an `resolve/<commit>/<pfad>` und läuft durch den vorhandenen Downloader (Fortsetzen, Abbrechen, Weiterleitung nur zu `*.hf.co`, Prüfsumme danach).

Abgelehnt werden mit Fehler am Schritt: andere Hosts, Repos mit Anmeldung (HTTP 401 oder 403 oder `gated`), Repos ohne GGUF-Datei, geteilte Dateien (`-00001-of-0000n.gguf`) und Dateien, deren Kopf nicht passt. Anmeldedaten für Hugging Face speichert Rotstift nicht.

Die CSP bleibt unverändert, weil alle Anfragen aus Rust kommen. Neu sind nur die beiden API-Pfade und der Range-Request auf `huggingface.co`. Die Liste erlaubter Hosts bleibt gleich.

### Probestart

Ob der gebündelte llama-server Architektur und Projektor kennt, zeigt erst das Laden. Deshalb folgt auf jeden fertigen Download und jeden Import eines eigenen Modells ein Probestart (`llm_probe_model`): Der Server lädt das Modell mit den Parametern des Schritts und wird wieder beendet. Läuft gerade ein anderes Modell, entfällt der Probestart, damit kein Lauf unterbrochen wird; ein Fehler zeigt sich dann beim ersten Laden. Beispiel aus der Messung: MiniCPM-V 4.7 lädt mit der gebündelten Laufzeit `b11537` nicht, weil sie den Projektortyp `minicpmv4_7` nicht kennt. Der Kopf allein hätte das nicht gezeigt.

### Lokale Datei: verlinken, sonst kopieren

Eine gewählte Datei kommt in den Modellordner, und zwar so:

1. **Harter Link**, wenn Quelle und Modellordner auf demselben Laufwerk liegen. Kostet keinen Platz, und die Datei bleibt erhalten, wenn die Lehrkraft das Original löscht oder verschiebt.
2. **Kopie** sonst (USB-Stick, Netzlaufwerk, anderes Laufwerk). Vorher wird der freie Platz geprüft.

Beim Übernehmen berechnet Rust die SHA-256 und schreibt den Marker aus `verified.rs`. Ein reiner Verweis auf den Originalpfad wurde verworfen: Modelle liegen bei Lehrkräften meist in „Downloads“ oder auf einem Stick, und eine Korrektur, die Wochen später mit „Datei nicht gefunden“ scheitert, ist schlimmer als 2 bis 5 GB Platz.

Ein eigenes Modell aus einer Datei hat keinen Download. Fehlt die Datei später, wird es über „Eigenes Modell …“ neu gewählt.

### mmproj für die Erkennung

Die Erkennung braucht zum Modell immer ein mmproj.

- **Link:** Rust sucht im selben Repo und Commit nach Dateien mit `mmproj` im Namen. Gibt es mehrere, ist die nach der Reihenfolge oben vorausgewählt, die Lehrkraft kann wechseln. Gibt es keine, ist das ein Fehler am Schritt.
- **Datei:** Der Dateidialog erlaubt mehrere Dateien. Welche das mmproj ist, entscheidet der GGUF-Kopf, nicht der Name. Für die Erkennung braucht es genau ein Modell und ein mmproj.
- Für die Textschritte wird ein mmproj abgelehnt.

### Eine Datei, mehrere Schritte

Dieselbe Datei kann in mehreren Einträgen stehen, etwa wenn derselbe Link einmal als Modell für Rechtschreibung und einmal für Inhalt und Form gewählt wird. Dateien sind über ihre SHA-256 eindeutig: Ein neuer Eintrag übernimmt den vorhandenen Dateinamen, und „Löschen“ entfernt eine Datei nur, wenn kein anderer eigener Eintrag sie braucht.

### Wechsel zwischen den Modellen

Es läuft immer genau ein llama-server. Drei gleichzeitig würden auf 8 GB nicht passen. Nutzen zwei Schritte denselben Eintrag, teilen sie sich den laufenden Server. Ein Wechsel kostet Beenden plus Laden, warm rund 1 s (Messung unten). Auf einem 8-GB-Rechner verdrängt jedes Modell das vorige aus dem Seitencache, dort bestimmt die Platte die Zeit, etwa 2 bis 10 s.

### Speicherbedarf und Warnung

Die App schätzt den Peak-Speicher jedes Eintrags, geprüft oder eigen, aus den Dateigrößen (GB = 10⁹ Byte):

```
Bedarf = 1,05 × (Modell + mmproj) + Grundbedarf + Repack
Grundbedarf = 1,4 GB für die Erkennung (Bildkodierung), 0,65 GB für die Textschritte
Repack = 0,47 × Modell, wenn der Eintrag repackt (cpuRepack, oder ab 12 GiB Arbeitsspeicher)
```

Die Faktoren sind an den gemessenen Peaks kalibriert, nicht an der Dateigröße allein:

| Modell             | Repack | gemessen | geschätzt |
| ------------------ | ------ | -------: | --------: |
| Gemma 4 E2B        | nein   |   3,4 GB |   3,63 GB |
| Gemma 4 E4B        | nein   |   5,2 GB |   5,47 GB |
| GLM-OCR            | nein   |  2,49 GB |    2,9 GB |
| GLM-OCR            | ja     |   3,2 GB |   3,35 GB |
| Qwen3-VL 4B Q4_K_M | nein   |  4,42 GB |    4,5 GB |

Die Erkennung ohne Repack ist mit fünf Seiten je Modell gemessen. Qwen3-VL mit Repack lag in einer älteren Messung mit mehr Bild-Tokens bei 6,4 GB, die Schätzung (5,67 GB) liegt dort darunter; gewarnt wird auf 8 GB trotzdem.

Neben jedem Eintrag steht „braucht etwa X GB“. Übersteigt der Bedarf den Arbeitsspeicher abzüglich 3,5 GiB für System und App (auf 8 GiB also 4,5 GiB oder 4,83 GB), ist der Text rot. Gemma 4 E4B (5,47 GB) und Qwen3-VL (5,67 GB) sind auf 8 GB markiert, GLM-OCR (3,35 GB) und Gemma 4 E2B (3,63 GB) nicht. Gesperrt wird nichts. Der Einrichtungsdialog nutzt dieselbe Schätzung und nennt das Modell mit dem größten Bedarf.

### Fehler am Schritt, ein Klick zurück

Scheitert Auflösen, Download, Prüfsumme, GGUF-Kopf oder Probestart, steht der Fehler beim Schritt in ⚙, bei einem anderen als dem empfohlenen Modell mit der Handlung „Empfohlenes Modell nutzen“. Der Klick setzt die Auswahl des Schritts auf die Empfehlung, löscht aber nichts. Typische Texte:

- „Dieses Modell kennt die eingebaute Laufzeit nicht (Architektur granitehybrid).“
- „Dieses Modell kennt die eingebaute Laufzeit nicht (Projektor minicpmv4_7).“
- „Dieses Modell verlangt eine Anmeldung bei Hugging Face.“
- „Für die Erkennung fehlt die Bilddatei (mmproj).“
- „mmproj-F16.gguf ist eine Bilddatei (mmproj), kein Modell.“

Scheitert das Laden erst während eines Laufs, meldet der Lauf das wie bei jedem anderen Modell. Ein eigenes Modell, das Unsinn ausgibt, ist kein Fehler im Sinne der App. Ungültige Antworten laufen durch die vorhandene Reparaturrunde und landen sonst als „Seite ohne Ergebnis“ bei der Arbeit.

## Kandidaten

Gemessen am 21.10.2026 auf einem M4 Pro (48 GB), nur CPU, 8 Threads, llama.cpp `b11537`, mit Prompts und Parametern der App (Textschritte `--no-repack --reasoning off`). Qualität aus den Evals in [eval/README.md](../../eval/README.md), Zeiten aus einem zweiten Lauf ohne andere llama-server auf dem Rechner. Neue Kandidaten aus der Recherche: Modelle von April bis Oktober 2026, die als GGUF mit llama.cpp auf der CPU in etwa 5 GB laufen.

### Erkennung

20 ScaDS-Seiten (Lesefehler) und 16 gerenderte Schülertexte mit 172 eingebauten Fehlern (erhalten oder eigenmächtig verbessert).

| Modell                               | Lizenz     | falsch gelesene Wörter (ScaDS) | Fehler erhalten / verbessert | Schleifen | s/Seite | Peak-RAM | listen            |
| ------------------------------------ | ---------- | -----------------------------: | ---------------------------: | --------: | ------: | -------: | ----------------- |
| **GLM-OCR (Q8_0)**, empfohlen        | MIT        |                         20,1 % |                   91 % / 0 % |      0/20 |     7,5 |   3,2 GB | ja (empfohlen)    |
| Granite Vision 4.1 4B (Q4_K_M), neu  | Apache-2.0 |                         17,6 % |                  56 % / 37 % |      3/20 |    22,1 |  7,7 GB¹ | nein              |
| MiniCPM-V 4.7 1B (Q4_K_M), neu       | Apache-2.0 |                              – |                            – |         – |       – |        – | nein, lädt nicht² |
| Qwen3-VL 4B (Q4_K_M), schon gelistet | Apache-2.0 |                        11,1 %³ |                 78 % / 18 %³ |     1/20³ |   23,3³ |  6,4 GB³ | ja                |

¹ Mit Repack wie die übrigen Erkennungskandidaten, RSS nach dem Laden 6,0 GB. ² Die Laufzeit kennt den Projektortyp `minicpmv4_7` nicht. ³ Aus [Erkennung genauer](../evaluations/2026-10-erkennung-genauer.md), nicht neu gemessen; dort auch LightOnOCR-3 0.8B und 4B und Qwen3.5 2B, die ebenfalls Schülerfehler verbessern.

Kein neuer Kandidat für die Erkennung. Granite Vision verbessert 37 % der Schülerfehler (58 von 112 Rechtschreibfehlern), braucht dreimal so lange und passt nicht in 8 GB.

### Rechtschreibung und Grammatik

`eval/profiles.ts --set de`: Vier Schülertexte mit 43 Fehlern, dieselben Texte korrigiert für Fehlalarme.

| Modell                       | Lizenz     | Recall (Art und Stelle) | Precision | Fehlalarme je 100 Wörter | Wortfehler 45 → | s/Seite | Peak-RAM | listen                              |
| ---------------------------- | ---------- | ----------------------: | --------: | -----------------------: | --------------: | ------: | -------: | ----------------------------------- |
| **Gemma 4 E2B (Q4_0)**       | Apache-2.0 |                  86,0 % |    97,4 % |                      0,0 |               6 |     4,2 |   3,4 GB | ja (empfohlen)                      |
| Gemma 4 E4B (Q4_0)           | Apache-2.0 |                  90,7 % |    97,5 % |                      1,0 |               4 |     7,7 |   5,2 GB | ja, Warnung auf 8 GB                |
| Qwen3.5 4B (Q4_K_M)          | Apache-2.0 |                  79,1 % |    91,9 % |                      0,4 |              24 |     7,3 |   3,5 GB | nein                                |
| Granite 4.2 3B (Q4_K_M), neu | Apache-2.0 |                  55,8 % |    92,3 % |                      0,0 |              24 |    11,9 |   2,9 GB | nein (1 von 8 Seiten ohne Ergebnis) |

### Inhalt und Form

`pnpm eval:content-form --variant features`, zehn Arbeiten mit 24 eingebauten Mängeln und zwei saubere, drei Läufe mit Seed 1 bis 3 (T=0, die Läufe sind gleich bis auf E4B: 79 %, 83 %, 83 %).

| Modell                       | Treffer Rand | mit Schluss | Art richtig | Kommentare je saubere Arbeit | Format gültig | s je Arbeit | Peak-RAM | listen                              |
| ---------------------------- | -----------: | ----------: | ----------: | ---------------------------: | ------------: | ----------: | -------: | ----------------------------------- |
| **Gemma 4 E2B (Q4_0)**       |         71 % |        88 % |        94 % |                          0,5 |         100 % |        12,1 |   3,5 GB | ja (empfohlen)                      |
| Gemma 4 E4B (Q4_0)           |  79 bis 83 % |        88 % |        85 % |                          0,5 |         100 % |        19,1 |   5,3 GB | ja, Warnung auf 8 GB                |
| Qwen3.5 4B (Q4_K_M)          |         83 % |        92 % |        90 % |                          2,0 |         100 % |        19,3 |   3,7 GB | nein, zu viele unbelegte Kommentare |
| Granite 4.2 3B (Q4_K_M), neu |         67 % |        75 % |        88 % |                          1,5 |         100 % |        10,7 |   3,0 GB | nein                                |

### Laden und Wechsel

`eval/model-load.ts`, Median aus drei Starts, Datei im Seitencache:

| Modell                | Dateien | Laden | RSS nach dem Laden |
| --------------------- | ------: | ----: | -----------------: |
| GLM-OCR               | 1,43 GB | 0,8 s |             2,2 GB |
| Gemma 4 E2B           | 2,84 GB | 1,0 s |             3,1 GB |
| Gemma 4 E4B           | 4,59 GB | 1,0 s |             4,9 GB |
| Qwen3.5 4B            | 2,74 GB | 0,8 s |             3,1 GB |
| Granite 4.2 3B        | 2,24 GB | 0,5 s |             2,7 GB |
| Granite Vision 4.1 4B | 3,26 GB | 1,8 s |             6,0 GB |

Warm kostet ein Wechsel also rund 1 s. Kalt bestimmt die Platte die Zeit (Dateigröße durch Lesegeschwindigkeit). Auf einem 8-GB-Rechner verdrängt jedes Modell das vorige aus dem Seitencache, dort ist jeder Wechsel kalt. Die Reihenfolge „erst alle Seiten erkennen, dann alle korrigieren“ hält das bei zwei Wechseln je Lauf.

### Lizenzen

Alle gelisteten Kandidaten stehen unter Apache-2.0 oder MIT, Weitergabe als Download ist erlaubt. Verworfen wegen Lizenz, ohne Messung: LFM2.5-VL-3B und LFM2.5-2.6B (LFM1.0, nur unter 10 Mio. USD Umsatz frei) und Surya OCR 2 (Modified OpenRAIL-M, nur Forschung, privat und Start-ups). Gemma 4 E4B steht wie E2B unter Apache-2.0 (Modellkarte von `ggml-org/gemma-4-E4B-it-GGUF`).

## Folgen

- `models.json` bekommt `customTemplates` und Gemma 4 E4B, `selection.json` hat einen Eintrag je Platz, `custom-models.json` kommt neu dazu.
- Neue Netzwerkzugriffe: zwei API-Pfade auf `huggingface.co` und ein Range-Request für den GGUF-Kopf. Keine neuen Hosts, CSP unverändert.
- Ohne Messung keine Lesesicherheit für eigene Erkennungsmodelle.
- Offen: Modelle, die erst eine neuere Laufzeit kennt (MiniCPM-V 4.7), brauchen ein Update von llama.cpp. Eine Reihenfolge „erst alle Seiten erkennen, dann alle korrigieren“, die Wechsel je Lauf begrenzt, ist nicht Teil dieser Entscheidung.
