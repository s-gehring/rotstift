# 0008: Modellwahl je Schritt und eigene Modelle

- Status: Entwurf
- Datum: 2026-10-21

## Kontext

Die Korrektur läuft in drei Schritten mit je einem Modell: Erkennung (Rolle `transcriber`, Vorgabe GLM-OCR), Rechtschreibung und Grammatik (`corrector`, Vorgabe Gemma 4 E2B) und Inhalt und Form (eigene dritte Rolle, Vorgabe dieselbe Gemma-Datei). Bisher ist nur die Erkennung wählbar, und nur aus `src-tauri/models.json`. Die Auswahl steht in `selection.json` als ein einziges `modelId`.

Lehrkräfte sollen je Schritt ein anderes Modell nutzen können: ein geprüftes größeres für Rechner mit mehr Speicher, aber auch eines, das wir nicht empfehlen. Dabei gilt weiter: Keine Netzwerkzugriffe außer Modell-Downloads, CSP unverändert, alles läuft auf einem Rechner mit 8 GB ohne GPU.

## Entscheidung

### Auswahl je Schritt

Unter ⚙ hat jeder Schritt eine Auswahl mit drei Arten von Einträgen:

1. **Empfohlen:** das Vorgabemodell des Schritts aus `models.json`.
2. **Geprüfte Kandidaten:** weitere Einträge derselben Rolle aus `models.json`, gemessen mit der Eval (Ergebnisse unten).
3. **Eigenes Modell …:** ein Hugging-Face-Link oder eine lokale GGUF-Datei.

Die Auswahl liegt in `selection.json` je Rolle:

```json
{ "transcriber": "glm-ocr-q8", "corrector": "gemma-4-e2b-q4", "reviewer": "custom-3f9a1c0e2b7d" }
```

Das alte Feld `modelId` wird beim Lesen als `transcriber` übernommen. Eine unbekannte oder gelöschte ID fällt auf die Empfehlung des Schritts zurück, wie heute `forget`.

### Eigene Modelle: Speicherort und Schema

Eigene Einträge stehen nicht in `models.json` (die Datei ist in die App kompiliert und geprüft), sondern in `custom-models.json` neben `selection.json` im App-Datenordner. Ein Eintrag beschreibt nur Herkunft und Dateien, keine Parameter:

```json
{
  "version": 1,
  "models": [
    {
      "id": "custom-3f9a1c0e2b7d",
      "role": "reviewer",
      "source": {
        "kind": "huggingface",
        "repo": "ibm-granite/granite-4.2-3b-GGUF",
        "revision": "c40945d71cd90f249a56985e8155551a9188dc30"
      },
      "files": {
        "model": {
          "name": "granite-4.2-3b-Q4_K_M.gguf",
          "url": "https://huggingface.co/ibm-granite/granite-4.2-3b-GGUF/resolve/c40945d…/granite-4.2-3b-Q4_K_M.gguf",
          "sha256": "e0406663…",
          "bytes": 2244011552
        }
      }
    },
    {
      "id": "custom-8b21d47c90aa",
      "role": "transcriber",
      "source": { "kind": "file" },
      "files": {
        "model": { "name": "…", "sha256": "…", "bytes": 0 },
        "mmproj": { "name": "…", "sha256": "…", "bytes": 0 }
      }
    }
  ]
}
```

- `id` ist `custom-` und die ersten 12 Hex-Zeichen der SHA-256 der Modelldatei, damit derselbe Eintrag nicht zweimal entsteht und die ID zum `^[a-z0-9-]+$` der Registry passt.
- `files.*.name` ist der Dateiname im Modellordner. Kollidiert er mit einer anderen Datei mit anderer Prüfsumme, bekommt er die ersten 8 Hex-Zeichen der Prüfsumme als Präfix.
- Rust prüft die Datei beim Lesen mit denselben Regeln wie `models.json` (Hex-Länge, schlichter `.gguf`-Name, `url_allowed` und gepinnte Revision bei Links). Ungültige Einträge werden übersprungen und im Diagnoseprotokoll vermerkt, nie stillschweigend repariert.
- Die TS-Registry bekommt einen Typ `CustomModel` und eine Funktion, die daraus mit der Schrittvorlage ein vollständiges `ModelInfo` oder `CorrectorInfo` baut. Der übrige Code sieht nur diese vollständigen Einträge.

### Schrittvorlage: Prompt und Parameter

Eigene Modelle nutzen den Prompt des Schritts und das Chat-Template aus der GGUF-Datei (llama-server mit `--jinja`, wie heute). Dafür bekommt `models.json` einen Abschnitt `steps`, je Rolle mit `server`, `request`, `prompt`, `system` und `lineMode`. Die Werte sind die der Empfehlung, mit drei Ausnahmen:

- **Erkennung:** Der Prompt ist nicht „Text Recognition:“ (der gilt nur für GLM-OCR), sondern der allgemeine Transkriptionsauftrag von Qwen3-VL. `imageMaxEdge` 1536, `contextSize` 8192.
- **Lesesicherheit:** `uncertainBelow` ist für eigene Modelle `null`. Die Schwelle hängt stark vom Modell ab (0,8 bis 0,98, siehe [Erkennung genauer](../evaluations/2026-10-erkennung-genauer.md)). Eine ungeprüfte Schwelle erzeugt entweder Hinweise auf jedem dritten Wort oder versteckt Fehler, also gibt es ohne Messung keine Hinweise „unsicher gelesen“.
- **`cpuRepack`** ist `false` (spart auf 8 GB rund 1,3 GB, siehe Gemma E2B), `reasoning` ist `off` für die Textschritte und `auto` für die Erkennung.

Ändert sich ein Prompt der App, gilt er sofort auch für eigene Modelle, weil der Eintrag ihn nicht kopiert.

Eigene Modelle bekommen keine Empfehlung, kein Abzeichen und keine Notiz. Die Auswahl zeigt nur Dateiname und Größe, bei Links zusätzlich den Repo-Namen.

### Hugging-Face-Links auflösen und pinnen

Angenommen werden Links auf eine GGUF-Datei (`/blob/<rev>/<pfad>.gguf` oder `/resolve/<rev>/<pfad>.gguf`) und Repo-Links (`https://huggingface.co/<org>/<repo>`, auch `hf.co`). Rust löst sie in drei Aufrufen auf, alle an `huggingface.co`:

1. `GET /api/models/<org>/<repo>/revision/<rev>` (bei Repo-Links `main`) liefert den Commit (`sha`). Ab hier steht überall der Commit, nie ein Branch.
2. `GET /api/models/<org>/<repo>/tree/<commit>?recursive=true` liefert je Datei Größe und `lfs.oid`, die SHA-256. Bei einem Repo-Link wählt die Lehrkraft eine der `.gguf`-Dateien (ohne `mmproj`), vorausgewählt ist `Q4_K_M`, sonst `Q4_0`.
3. Der Download geht an `resolve/<commit>/<pfad>` und läuft durch den vorhandenen Downloader (Fortsetzen, Abbrechen, Weiterleitung nur zu `*.hf.co`). Die SHA-256 aus Schritt 2 wird nach dem Download geprüft und mit `verified.rs` vermerkt.

Abgelehnt werden mit Fehler am Schritt: andere Hosts, Dateien ohne `lfs.oid`, geteilte Dateien (`-00001-of-0000n.gguf`), Repos, die eine Anmeldung verlangen (HTTP 401 oder `gated`), und Dateien größer als der freie Platz. Anmeldedaten für Hugging Face speichert Rotstift nicht.

Vor dem Download liest Rust mit einem Range-Request die ersten 4 MB der Datei und prüft den GGUF-Kopf: Magic `GGUF`, Version, `general.architecture`. Eine Datei mit der Architektur `clip` ist ein mmproj und kein Modell.

Ob der gebündelte llama-server Architektur und Projektor kennt, zeigt erst das Laden. Deshalb folgt auf jeden Download und jeden Import ein **Probestart**: Der Server lädt das Modell mit den Parametern des Schritts und wird wieder beendet. Erst danach steht das Modell zur Auswahl. Beispiel aus der Messung: MiniCPM-V 4.7 (Oktober 2026) lädt mit der gebündelten Laufzeit `b11537` nicht, weil sie den Projektortyp `minicpmv4_7` nicht kennt; der Kopf allein hätte das nicht gezeigt.

Die CSP bleibt unverändert, weil alle Anfragen aus Rust kommen. Neu sind nur die beiden API-Pfade auf `huggingface.co`; `url_allowed` gilt unverändert.

### Lokale Datei: verlinken, sonst kopieren

Eine gewählte Datei kommt in den Modellordner, und zwar so:

1. **Harter Link**, wenn Quelle und Modellordner auf demselben Laufwerk liegen. Kostet keinen Platz, und die Datei bleibt erhalten, wenn die Lehrkraft das Original löscht oder verschiebt.
2. **Kopie** sonst (USB-Stick, Netzlaufwerk, anderes Laufwerk). Vorher wird der freie Platz geprüft. Auf APFS und Btrfs klont `std::fs::copy` ohne zusätzlichen Platz.

Beim Verlinken oder Kopieren berechnet Rust die SHA-256 und schreibt den Marker aus `verified.rs`. Ändert sich die Datei später (anderer Zeitstempel oder Größe), gilt sie als ungeprüft und wird vor dem nächsten Start neu geprüft.

Ein reiner Verweis auf den Originalpfad wurde verworfen: Modelle liegen bei Lehrkräften meist in „Downloads“ oder auf einem Stick, und eine Korrektur, die Wochen später mit „Datei nicht gefunden“ scheitert, ist schlimmer als 2 bis 5 GB Platz. Der harte Link vermeidet den Platz im häufigsten Fall.

### mmproj für die Erkennung

Die Erkennung braucht zum Modell immer ein mmproj.

- **Link:** Nach dem Auflösen sucht Rust im selben Repo und Commit nach Dateien, deren Name `mmproj` enthält. Gibt es genau eine, wird sie mitgenommen. Gibt es mehrere, ist `f16` vorausgewählt (`F16`, `BF16`, `Q8_0` in dieser Reihenfolge), die Lehrkraft kann wechseln. Gibt es keine, verlangt der Dialog einen zweiten Link oder eine Datei.
- **Datei:** Der Dateidialog erlaubt zwei Dateien. Welche das mmproj ist, entscheidet der GGUF-Kopf (`general.architecture` = `clip`), nicht der Name.
- Für die Textschritte wird ein mmproj abgelehnt, ein Vision-Modell ohne mmproj ist dort erlaubt (es arbeitet dann nur mit Text).

### Eine Datei, mehrere Schritte

Dieselbe Datei kann in mehreren Rollen stehen, etwa Gemma E2B für Rechtschreibung und für Inhalt und Form. Dateien sind über ihre SHA-256 eindeutig, nicht über den Eintrag:

- Die Prüfung „Dateiname doppelt“ in `Registry::validate` wird zu „gleicher Name nur mit gleicher Prüfsumme, Größe und URL“.
- Herunterladen, Prüfen und Löschen arbeiten je Datei. Ein Eintrag gilt als installiert, wenn alle seine Dateien da sind. „Löschen“ entfernt eine Datei nur, wenn kein anderer installierter und ausgewählter Eintrag sie braucht, sonst nur den Eintrag.
- Platzbedarf und Fortschritt zählen jede Datei einmal.

### Wechsel zwischen bis zu drei Modellen

Es läuft immer genau ein llama-server. Drei gleichzeitig würden auf 8 GB nicht passen (zusammen rund 9 GB Peak, siehe unten).

- **Reihenfolge:** Ein Lauf erkennt erst alle Seiten der Klasse, korrigiert dann alle Arbeiten und prüft danach Inhalt und Form aller Arbeiten. Jedes Modell lädt so höchstens einmal je Lauf, nicht einmal je Arbeit.
- **Wiederverwenden:** Zwei Schritte mit derselben Modelldatei teilen sich einen Server. Ihr Startschlüssel ist Datei plus mmproj plus Serverparameter. Weichen nur `contextSize` ab, startet der Server mit dem größeren Wert für beide.
- **Ladezeit:** Ein Wechsel kostet Beenden plus Laden. Gemessen (M4 Pro, Dateien im Seitencache) unten. Auf einem 8-GB-Rechner mit SSD liegt der kalte Start bei etwa Dateigröße durch Lesegeschwindigkeit plus wenigen Sekunden, also 2 bis 10 s. Die Kopfzeile zeigt dabei wie heute „Modellwechsel wird vorbereitet …“.
- Mehrere Server gleichzeitig (ab 16 GB) sind möglich, bringen aber bei der Reihenfolge oben nur die Ladezeit zurück. Das bleibt offen, bis gemessen ist, dass sich das lohnt.

### Speicherwarnung

Für geprüfte Einträge gilt weiter `recommendedRamGb` mit `isLowOnMemory`. Für eigene Modelle schätzt die App den Peak aus der Dateigröße:

- Textschritte: `Bedarf = 1,15 × Dateigröße + 0,5 GB`
- Erkennung: `Bedarf = 1,15 × (Modell + mmproj) + 2 GB` (Bildkodierung)

Die Faktoren stammen aus den Messungen unten mit `--no-repack` (Peak-RAM 1,13- bis 1,29-mal die Dateigröße bei den Textmodellen). Für die Erkennung ohne Repack fehlt noch eine Messung, die Formel ist dort vorläufig. Liegt der Bedarf über 75 % des Arbeitsspeichers (auf 8 GB also über 6 GB), zeigt die Auswahl unter dem Eintrag „Braucht etwa 7 GB Arbeitsspeicher, dieser Rechner hat 8 GB.“ Gesperrt wird nichts. Die Warnung steht vor dem Download und bleibt beim gewählten Eintrag sichtbar.

### Fehler am Schritt, ein Klick zurück

Scheitert Auflösen, Download, Prüfsumme, GGUF-Kopf, Probestart oder das Laden während eines Laufs, steht der Fehler beim Schritt in ⚙ und, während eines Laufs, bei der betroffenen Arbeit, mit genau einer Handlung: „Empfohlenes Modell nutzen“. Der Klick setzt die Auswahl des Schritts auf die Empfehlung, löscht aber nichts. Typische Texte:

- „Dieses Modell kennt die eingebaute Laufzeit nicht (Architektur qwen4).“
- „Diese Bilddatei kennt die eingebaute Laufzeit nicht (Projektor minicpmv4_7).“
- „Dieses Repo verlangt eine Anmeldung bei Hugging Face.“
- „Die Datei passt nicht zur Prüfsumme.“
- „Für die Erkennung fehlt die Bilddatei (mmproj).“

Ein eigenes Modell, das Unsinn ausgibt, ist kein Fehler im Sinne der App. Ungültige Antworten laufen durch die vorhandene Reparaturrunde und landen sonst als „Seite ohne Ergebnis“ bei der Arbeit.

## Kandidaten

Gemessen am 21.10.2026 auf einem M4 Pro (48 GB), nur CPU, 8 Threads, llama.cpp `b11537`, mit Prompts und Parametern der App (Textschritte `--no-repack --reasoning off`). Qualität aus den Evals in [eval/README.md](../../eval/README.md), Zeiten aus einem zweiten Lauf ohne andere llama-server auf dem Rechner. Neue Kandidaten aus der Recherche: Modelle von April bis Oktober 2026, die als GGUF mit llama.cpp auf der CPU in etwa 5 GB laufen.

### Erkennung

20 ScaDS-Seiten (Lesefehler) und 16 gerenderte Schülertexte mit 172 eingebauten Fehlern (erhalten oder eigenmächtig verbessert).

| Modell                               | Lizenz     | falsch gelesene Wörter (ScaDS) | Fehler erhalten / verbessert | Schleifen | s/Seite | Peak-RAM | listen                               |
| ------------------------------------ | ---------- | -----------------------------: | ---------------------------: | --------: | ------: | -------: | ------------------------------------ |
| **GLM-OCR (Q8_0)**, empfohlen        | MIT        |                         20,1 % |                   91 % / 0 % |      0/20 |     7,5 |   3,2 GB | ja (empfohlen)                       |
| Granite Vision 4.1 4B (Q4_K_M), neu  | Apache-2.0 |                         17,6 % |                  56 % / 37 % |      3/20 |    22,1 |  7,7 GB¹ | nein                                 |
| MiniCPM-V 4.7 1B (Q4_K_M), neu       | Apache-2.0 |                              – |                            – |         – |       – |        – | nein, lädt nicht²                    |
| Qwen3-VL 4B (Q4_K_M), schon gelistet | Apache-2.0 |                        11,1 %³ |                 78 % / 18 %³ |     1/20³ |   23,3³ |  6,4 GB³ | ja, wie heute „Nur zum Wörterzählen“ |

¹ Mit Repack wie die übrigen Erkennungskandidaten, RSS nach dem Laden 6,0 GB. ² Die Laufzeit kennt den Projektortyp `minicpmv4_7` nicht. ³ Aus [Erkennung genauer](../evaluations/2026-10-erkennung-genauer.md), nicht neu gemessen; dort auch LightOnOCR-3 0.8B und 4B und Qwen3.5 2B, die ebenfalls Schülerfehler verbessern.

Kein neuer Kandidat für die Erkennung. Granite Vision verbessert 37 % der Schülerfehler (58 von 112 Rechtschreibfehlern), braucht dreimal so lange und passt nicht in 8 GB.

### Rechtschreibung und Grammatik

`eval/profiles.ts --set de`: Vier Schülertexte mit 43 Fehlern, dieselben Texte korrigiert für Fehlalarme.

| Modell                       | Lizenz     | Recall (Art und Stelle) | Precision | Fehlalarme je 100 Wörter | Wortfehler 45 → | s/Seite | Peak-RAM | listen                              |
| ---------------------------- | ---------- | ----------------------: | --------: | -----------------------: | --------------: | ------: | -------: | ----------------------------------- |
| **Gemma 4 E2B (Q4_0)**       | Apache-2.0 |                  86,0 % |    97,4 % |                      0,0 |               6 |     4,2 |   3,4 GB | ja (empfohlen)                      |
| Gemma 4 E4B (Q4_0)           | Apache-2.0 |                  90,7 % |    97,5 % |                      1,0 |               4 |     7,7 |   5,2 GB | ja, ab 16 GB                        |
| Qwen3.5 4B (Q4_K_M)          | Apache-2.0 |                  79,1 % |    91,9 % |                      0,4 |              24 |     7,3 |   3,5 GB | nein                                |
| Granite 4.2 3B (Q4_K_M), neu | Apache-2.0 |                  55,8 % |    92,3 % |                      0,0 |              24 |    11,9 |   2,9 GB | nein (1 von 8 Seiten ohne Ergebnis) |

### Inhalt und Form

`pnpm eval:content-form --variant features`, zehn Arbeiten mit 24 eingebauten Mängeln und zwei saubere, drei Läufe mit Seed 1 bis 3 (T=0, die Läufe sind gleich bis auf E4B: 79 %, 83 %, 83 %).

| Modell                       | Treffer Rand | mit Schluss | Art richtig | Kommentare je saubere Arbeit | Format gültig | s je Arbeit | Peak-RAM | listen                              |
| ---------------------------- | -----------: | ----------: | ----------: | ---------------------------: | ------------: | ----------: | -------: | ----------------------------------- |
| **Gemma 4 E2B (Q4_0)**       |         71 % |        88 % |        94 % |                          0,5 |         100 % |        12,1 |   3,5 GB | ja (empfohlen)                      |
| Gemma 4 E4B (Q4_0)           |  79 bis 83 % |        88 % |        85 % |                          0,5 |         100 % |        19,1 |   5,3 GB | ja, ab 16 GB                        |
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

- `models.json` bekommt `steps` und die dritte Rolle, `selection.json` wird je Rolle geführt, `custom-models.json` kommt neu dazu.
- Der Download-Manager arbeitet je Datei statt je Eintrag.
- Neue Netzwerkzugriffe: zwei API-Pfade auf `huggingface.co`, ein Range-Request für den GGUF-Kopf. Keine neuen Hosts.
- Ohne Messung keine Lesesicherheit für eigene Erkennungsmodelle.
