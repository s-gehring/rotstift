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
Bedarf = 1,05 × (Modell + mmproj + Kopf) + Grundbedarf + Kopfpuffer + Repack
Grundbedarf = 1,4 GB für die Erkennung (Bildkodierung), 0,65 GB für die Textschritte
Kopfpuffer = 0,15 GB, wenn der Eintrag einen MTP-Kopf hat (siehe Spekulatives Dekodieren)
Repack = 0,47 × Modell, wenn der Eintrag repackt (cpuRepack, oder ab 12 GiB Arbeitsspeicher) und die repackte Kopie in den Speicher passt
```

Die Faktoren sind an den gemessenen Peaks kalibriert, nicht an der Dateigröße allein:

| Modell               | Repack | gemessen | geschätzt |
| -------------------- | ------ | -------: | --------: |
| Gemma 4 E2B          | nein   |   3,4 GB |   3,63 GB |
| Gemma 4 E4B          | nein   |   5,2 GB |   5,47 GB |
| Gemma 4 E2B mit Kopf | nein   |  3,3 GB¹ |   3,85 GB |
| Gemma 4 E4B mit Kopf | nein   |  5,1 GB¹ |   5,68 GB |
| GLM-OCR              | nein   |  2,49 GB |    2,9 GB |
| GLM-OCR              | ja     |   3,2 GB |   3,35 GB |
| Qwen3-VL 4B Q4_K_M   | nein   |  4,42 GB |    4,5 GB |

¹ Auf simon-pc, wo dieselben Modelle ohne Kopf 3,1 und 4,9 GB brauchen ([Gründlicher Modus](../evaluations/2026-10-gruendlich.md#spekulatives-dekodieren)). Der Kopf kostet also rund 0,2 GB, die Zeilen ohne Kopf sind auf dem Mac gemessen. Die Erkennung ohne Repack ist mit fünf Seiten je Modell gemessen. Qwen3-VL mit Repack lag in einer älteren Messung mit mehr Bild-Tokens bei 6,4 GB, die Schätzung (5,67 GB) liegt dort darunter; gewarnt wird auf 8 GB trotzdem.

Neben jedem Eintrag steht „braucht etwa X GB“. Übersteigt der Bedarf den Arbeitsspeicher abzüglich 3,5 GiB für System und App (auf 8 GiB also 4,5 GiB oder 4,83 GB), ist der Text rot. Gemma 4 E4B (5,68 GB) ist auf 8 GB markiert, GLM-OCR (3,35 GB), Gemma 4 E2B (3,85 GB) und Qwen3-VL (4,5 GB ohne Repack, siehe [Gründlichkeit](#modelle-größer-als-der-speicher)) nicht. Gesperrt wird nichts. Der Einrichtungsdialog nutzt dieselbe Schätzung und nennt das Modell mit dem größten Bedarf.

### Fehler am Schritt, ein Klick zurück

Scheitert Auflösen, Download, Prüfsumme, GGUF-Kopf oder Probestart, steht der Fehler beim Schritt in ⚙, bei einem anderen als dem empfohlenen Modell mit der Handlung „Empfohlenes Modell nutzen“. Der Klick setzt die Auswahl des Schritts auf die Empfehlung, löscht aber nichts. Typische Texte:

- „Dieses Modell kennt die eingebaute Laufzeit nicht (Architektur granitehybrid).“
- „Dieses Modell kennt die eingebaute Laufzeit nicht (Projektor minicpmv4_7).“
- „Dieses Modell verlangt eine Anmeldung bei Hugging Face.“
- „Für die Erkennung fehlt die Bilddatei (mmproj).“
- „mmproj-F16.gguf ist eine Bilddatei (mmproj), kein Modell.“

Scheitert das Laden erst während eines Laufs, meldet der Lauf das wie bei jedem anderen Modell. Ein eigenes Modell, das Unsinn ausgibt, ist kein Fehler im Sinne der App. Ungültige Antworten laufen durch die vorhandene Reparaturrunde und landen sonst als „Seite ohne Ergebnis“ bei der Arbeit.

### Gründlichkeit

Ergänzt am 2026-10-22 nach der Messung in [Gründlicher Modus](../evaluations/2026-10-gruendlich.md) (#68).

Über den Schritten steht in ⚙ die Auswahl „Gründlichkeit“. Sie setzt die Modelle aller Schritte und die zweite Lesung auf einmal:

| Stufe             | Erkennung | Zweite Lesung          | Rechtschreibung und Grammatik | Inhalt und Form  |
| ----------------- | --------- | ---------------------- | ----------------------------- | ---------------- |
| Schnell (Vorgabe) | GLM-OCR   | aus                    | Gemma 4 E2B Q4_0              | Gemma 4 E2B Q4_0 |
| Gründlich         | GLM-OCR   | LightOnOCR-3 0.8B Q8_0 | Gemma 4 E4B Q4_0              | Gemma 4 E2B Q4_0 |
| Sehr gründlich    | GLM-OCR   | LightOnOCR-3 0.8B Q8_0 | Gemma 4 26B A4B Q4_0          | Gemma 4 E2B Q4_0 |

Begründung aus #68:

- **Rechtschreibung und Grammatik** gewinnt mit dem größeren Modell: Recall 86,9 % (E2B), 91,8 % (E4B), 93,4 % (26B A4B), bei gleich wenigen Fehlalarmen. Mehr Rechenzeit mit demselben Modell (Denken, zweiter Durchgang, Stichproben) bringt nichts.
- **Inhalt und Form** wird mit keinem Modell messbar besser (18, 17 und 16 von 24 Mängeln mit E2B, E4B und 26B A4B). Auf simon-pc braucht E4B 53 statt 28 s je Arbeit bei einem Treffer weniger, 26B A4B trifft 16 von 24. Der Schritt bleibt darum in jeder Stufe bei Gemma 4 E2B. Die Schritte eines Laufs laufen nacheinander, ein eigenes Modell kostet also nur einen zusätzlichen Wechsel je Lauf (Korrektur, dann Inhalt und Form), warm rund 1 s. Der Preis der größeren Modelle fällt so nur bei der Rechtschreibung und Grammatik an, wo sie Recall bringen.
- **Erkennung:** Ein größeres Modell für 8 GB gibt es nicht. Die zweite Lesung mit LightOnOCR-3 0.8B halbiert die Fehlalarme aus Lesefehlern (1,4 auf 0,7 je 100 Wörter echter Handschrift) und hebt den Anteil rot markierter echter Fehler von 60 auf 63 %.

Die Auswahl zeigt die Stufe, deren Modelle gerade gewählt sind. Ändert jemand darunter einen Schritt, steht dort „Eigene Auswahl“. Die Auswahl je Schritt bleibt wie oben. Keine Stufe ist gesperrt. Den kurzen Zusatz „dauert deutlich länger“ trägt eine Stufe, wenn eines ihrer Modelle nach der Kurve für Modelle über dem Speicher mindestens doppelt so lange braucht. Auf 8 GB ist das nur Sehr gründlich, Gründlich mit E4B nicht. Ein Cloud-Schritt wird beim Wählen einer Stufe ausgeschaltet. Fehlen Modelle der Stufe, fragt der Start wie bisher nach der Einrichtung.

#### Zweite Lesung

LightOnOCR-3 0.8B steht als eigener Eintrag in `models.json` (Rolle `transcriber`, ohne Prompt, 1536 px), taucht aber nicht in der Auswahl der Erkennung auf: Als alleiniges Modell verbessert es Schülerfehler ([Erkennung genauer](../evaluations/2026-10-erkennung-genauer.md)). In ⚙ steht unter der Erkennung ein eigener Abschnitt „Zweite Lesung“ mit Schalter, Größe, Bedarf, Zustand und Löschen. Ist sie an und das Modell fehlt, fragt der Start nach der Einrichtung. Bei einer Erkennung in der Cloud gibt es keine zweite Lesung.

Die Regel aus #68 (`src/correction/second-reading.ts`): Beide Lesungen werden Wort für Wort ausgerichtet. Ein Wort bleibt sicher, wenn LightOn es gleich liest und GLM-OCR sich zu mindestens 0,8 sicher ist. Jede andere Marke auf dem Wort wird zum Hinweis „unsicher gelesen“. Scheitert die zweite Lesung einer Seite, gilt die erste wie bisher.

Die zweite Lesung ist ein eigener Durchgang des Erkennungsschritts: Der Runner liest zuerst alle Seiten mit GLM-OCR und danach alle Seiten mit LightOnOCR-3, erst dann wird bestätigt (`PageTranscriber.secondRead`, `awaitingSecond` am Eintrag der Seite). Das kostet einen Modellwechsel je Lauf statt zwei je Seite. Ein Lauf mit 100 Seiten startet die beiden Erkennungsmodelle so je einmal statt je 100-mal, auf 8 GB, wo jeder Wechsel kalt ist (Lesen von der Platte), ein deutlicher Unterschied.

- Der Seitenzähler (`batch`) zählt nur erste Lesungen. Fortschritt und Restdauer zählen die zweite Lesung als eigene Einheit (siehe Restdauer).
- Abbruch mitten in der zweiten Lesung lässt alle Seiten mit ihrer ersten Lesung stehen, ohne Bestätigung.
- Scheitert die zweite Lesung einer Seite, auch durch Hänger oder Absturz, gilt ihre erste Lesung wie bisher. Sie ist kein Fehler der Seite. Mehrere Hänger oder Abstürze in einem Lauf beenden den Durchgang (wie beim Lesen), die übrigen Seiten behalten die erste Lesung.
- Hat der Nutzer den Text einer Seite inzwischen bearbeitet, wird ihre Lesesicherheit nicht mehr verändert.
- „Erneut versuchen“ für eine Seite liest sie beide Male und wechselt dafür zweimal. Die Zählung nutzt die zweite Lesung ebenfalls, wenn sie an ist.

#### Modelle größer als der Speicher

Nichts wird gesperrt, auch nicht auf 8 GB. Ein Modell über dem freien Speicher läuft aus der Datei:

- llama.cpp lädt die Gewichte per mmap (`--load-mode auto`, Vorgabe). Die App gibt weder `--mlock` noch `--no-mmap`, `--load-mode` oder `--lazy-mode`. Das Betriebssystem kann Seiten der Datei verwerfen und neu lesen.
- `--repack` kopiert die Gewichte in anonymen Speicher, der nicht aus der Datei nachgeladen werden kann. Die App repackt darum nur, wenn die repackte Kopie in den Speicher passt (Bedarf mit Repack unter Arbeitsspeicher minus 3,5 GiB), sonst startet sie mit `--no-repack`. Gleiche Regel in Rust (`start_options`) und TS (`repacks`). Folge: Qwen3-VL läuft auf 8 GB jetzt ohne Repack (4,5 statt 5,67 GB) und ist dort nicht mehr markiert.
- Liegt auch der Bedarf ohne Repack über dem Speicher, wartet die App bis zu 12 h statt 15 min auf eine Antwort (`fromDisk` in den Startoptionen).

#### Spekulatives Dekodieren

Ergänzt am 2026-10-23 nach [Gründlicher Modus](../evaluations/2026-10-gruendlich.md#spekulatives-dekodieren) (#73).

Gemma 4 E2B, E4B und 26B A4B laufen mit ihrem MTP-Kopf (Multi-Token-Prediction), sobald er eingerichtet ist: llama-server schlägt mit dem Kopf mehrere Token vor und prüft sie in einem Schritt (`--spec-type draft-mtp --model-draft <Kopf>`). Bei Temperatur 0 ändert das keine Marke und spart 28 bis 51 % der Korrekturzeit. Es ist der einzige Hebel, der auch die Vorgabe Schnell schneller macht.

- **Datei:** Der Kopf steht in `models.json` als `files.draft` des Korrekturmodells, `mtp-gemma-4-*-it-Q4_0.gguf` von ggml-org, gepinnt auf denselben Commit wie das Modell und mit SHA-256 geprüft wie jede Modelldatei. 60 MB für E2B und E4B, 250 MB für 26B A4B. Er wird mit dem Modell geladen, geprüft, aus Datei importiert und gelöscht und zählt in Größe und Speicherbedarf mit (siehe Speicherbedarf). Nur ein geprüftes Korrekturmodell darf einen Kopf haben, Rust und TS lehnen ihn bei Erkennungsmodellen und eigenen Modellen ab.
- **Nie blockierend:** Ob ein Modell bereit ist, hängt nur an Modell und mmproj. Fehlt der Kopf, ist er unvollständig oder ohne gültige Prüfmarke, läuft das Modell ohne Spekulation weiter. Eine bestehende Installation bekommt den Kopf mit dem nächsten Download des Modells, etwa in der nächsten Einrichtung. Der Downloader überspringt dabei die vorhandenen Dateien. `model_status` meldet `draftReady`.
- **Start:** Rust gibt den Kopf nur mit, wenn er vollständig ist und eine gültige Prüfmarke hat. Beendet sich der Server mit Kopf schon beim Start oder lässt sich die Kopf-Datei nicht auflösen, startet er sofort ohne ihn neu, protokolliert `sidecar_draft_failed` und lässt diesen Kopf bis zum nächsten Start der App weg. Andere Fehler (Zeitüberschreitung beim Laden, fehlendes Hauptmodell, fehlender Sidecar) gibt er unverändert zurück, ohne den Kopf zu sperren. `sidecar_start` protokolliert, ob ein Kopf dabei war.
- **Inhalt und Form** nutzt denselben Server und damit auch den Kopf. Ob das dort hilft, ist nicht gemessen, die Antworten sind kurze JSON-Objekte.
- Cloud-Schritte und eigene Modelle laufen ohne Kopf.

Gemessen mit `src/llm/mtp.integration.test.ts` auf dem Mac (Apple M4 Pro, 12 Kerne, 48 GB, gebündelter llama-server `b11551`, Threads wie in der App), Gemma 4 E2B auf den 8 Seiten aus `eval/samples/texts` (vier Texte mit und ohne Fehler), abwechselnd ohne und mit Kopf, je zweimal:

| Variante  | s je Seite | 8 Seiten     | Marken | angenommene Token    | Peak-RSS |
| --------- | ---------: | ------------ | ------ | -------------------- | -------: |
| ohne Kopf | 2,09, 2,11 | 16,8, 16,9 s | 38, 38 |                      | 2,92 GiB |
| mit Kopf  | 1,16, 1,17 | 9,3, 9,3 s   | 38, 38 | 1109 von 1182 (94 %) | 3,09 GiB |

Die korrigierten Texte sind in allen vier Läufen Zeichen für Zeichen gleich. Der Kopf spart auf dem Mac 45 %, mehr als auf simon-pc mit 4 Threads (28 %), weil das Prüfen mehrerer Token Rechenleistung braucht, die der Mac mit allen Kernen hat. Drei fremde llama-server waren geladen, aber untätig (0,1 % CPU), die Last lag bei 4 von 12 Kernen.

#### Restdauer

Die Schätzung vor dem Start und die Restdauer rechnen je Modell, nicht nur je Schritt (`src/models/speed.ts`). Startwert ist die Faustregel des Schritts (30 s je Seite Erkennung, 15 s je Seite Korrektur, 20 s je Arbeit Inhalt und Form) mal einem Faktor je Schritt relativ zu GLM-OCR oder Gemma 4 E2B. Die Faktoren stammen seit dem 2026-10-23 aus der Messung auf simon-pc mit 4 Threads ([Faktoren für die Restdauer](../evaluations/2026-10-gruendlich.md#faktoren-für-die-restdauer), #73):

| Modell            | Erkennung | Zweite Lesung | Korrektur | Inhalt und Form |
| ----------------- | --------: | ------------: | --------: | --------------: |
| GLM-OCR           |         1 |               |           |                 |
| Qwen3-VL 4B       |       3,1 |               |           |                 |
| LightOnOCR-3 0.8B |           |           0,9 |           |                 |
| Gemma 4 E2B       |           |               |         1 |               1 |
| Gemma 4 E4B       |           |               |      1,95 |             1,9 |
| Gemma 4 26B A4B   |           |               |       1,9 |             2,1 |

Ein eigenes Modell bekommt die Größe seiner Gewichte (Modell und mmproj) relativ zur Vorgabe des Schritts. Dazu kommen zwei Aufschläge:

- **MTP-Kopf:** ×0,7 in der Korrektur, wenn der Kopf des Korrekturmodells eingerichtet ist (`draftReady`). Der gelernte Wert steht dann unter einem eigenen Schlüssel (`correct:gemma-4-e2b-q4+mtp`), damit ein früher ohne Kopf gelernter Wert die Ersparnis nicht verdeckt. Inhalt und Form bekommt keinen Faktor, dort ist Spekulation nicht gemessen.
- **Modell über dem Speicher:** Der Aufschlag hängt am Anteil `m` der Gewichte, der nicht in den Speicher passt, den die Registry dem Modell lässt (Arbeitsspeicher minus 3,5 GiB): `1 + 11 × (m ÷ ⅔)²`. Passt die Datei, gibt es keinen Aufschlag, auch wenn Kontext und Puffer darüber liegen, denn E4B läuft auf 8 GB per mmap ohne Zeitverlust (gemessen 1,0). 26B A4B fehlen auf 16 GB 8 % (Kurve 1,17, gemessen 1,18) und auf 8 GB 67 % (Kurve 12,1, gemessen 11,9 von einer NVMe). Sehr gründlich auf 8 GB ergibt damit 23 für die Korrektur und 25 für Inhalt und Form wie in der Messung. Die Kurve nimmt die NVMe-Werte. Von einer SATA-SSD dauert es fast fünfmal so lange (57 statt 12), das korrigiert die gelernte Rate nach den ersten Seiten. Den Plattentyp erkennt die App nicht: Unter Linux unterscheidet `rotational` eine SATA-SSD nicht von einer NVMe, und der Weg vom Modellordner zum Gerät führt über btrfs, LVM oder Verschlüsselung; unter Windows bräuchte es WMI. Billig und zuverlässig ist das nicht. Der pauschale Faktor 10 entfällt.

Die zweite Lesung ist ein eigener Schritt mit eigenem Wert (`confirm`, Startwert 30 s mal Faktor des Zweitlesers), damit der Wert der Erkennung nicht zwischen zwei Modellen pendelt. Gelernt wird wie bisher aus dem Lauf, aber getrennt je Schritt und Modell (`rotstift.model-rates`). Die alten Werte je Schritt (`rotstift.step-rates`) gelten beim ersten Start für die Vorgabemodelle. Ab 5 h nennt die Schätzung ganze Stunden („etwa 7 h“).

Gemessen mit `eval/class-run.integration.test.ts` auf dem Mac (Apple M4 Pro, 48 GB, nur CPU), eine gerenderte Seite mit Inhalt und Form (`brief-ohne-rahmen-1`), alle Modelle in den Speicher passend. Der Mac war durch drei fremde llama-server belastet, die Zeiten zeigen das Verhältnis, nicht den schwachen Laptop:

| Stufe          | Erkennung | Korrektur | Inhalt und Form | Seite gesamt | Modellstarts      |
| -------------- | --------: | --------: | --------------: | -----------: | ----------------- |
| Schnell        |     3,9 s |     5,7 s |           4,3 s |       14,1 s | GLM, E2B          |
| Gründlich      |     8,6 s |     8,5 s |           6,7 s |       24,0 s | GLM, LightOn, E4B |
| Sehr gründlich |     7,8 s |    15,1 s |           6,1 s |       29,1 s | GLM, LightOn, 26B |

Die Zeiten enthalten das Laden der Modelle (GLM 0,5 bis 1,1 s, LightOn 1,0 bis 1,4 s, E2B 2,2 s, E4B 3,2 s, 26B A4B 10,2 s). Ohne Laden rechnet die Korrektur mit E2B 3,5 s, mit E4B 5,3 s und mit 26B A4B 4,9 s. Auf einer einzelnen Seite mit 48 GB ist das Mixture-of-Experts-Modell also so schnell wie E4B. Der Faktor 3,5 folgt trotzdem den zehn Arbeiten aus #68, bis simon-pc misst. Peak des 26B-Servers: 13,7 GB.

Dieselbe Messung mit der Gesamtzeit einer Klasse (`eval/class-run.integration.test.ts`, 3 Arbeiten zu je 2 Seiten, Brief mit Inhalt und Form, gleicher Mac, Modelle im Speicher). „Vorher“ liest jede Seite beide Male nacheinander (`ROTSTIFT_CLASS_PAGEWISE=1`) und nutzt für Inhalt und Form das Modell der Korrektur, „nachher“ ist der eigene Durchgang mit Gemma 4 E2B für Inhalt und Form. Modellwechsel sind die Modellstarts des Servers im Protokoll des Laufs. Der Mac war durch fremde llama-server belastet (Last 6 bis 23), die Zeiten schwanken darum um 10 bis 20 %, die Wechsel nicht.

| Stufe          | Gesamtzeit vorher | Gesamtzeit nachher | Modellwechsel vorher | Modellwechsel nachher |
| -------------- | ----------------: | -----------------: | -------------------: | --------------------: |
| Schnell        |            61,1 s |             61,1 s |                    2 |                     2 |
| Gründlich      |      96,8, 90,5 s |       78,1, 86,8 s |                   13 |                     4 |
| Sehr gründlich |           111,4 s |             85,6 s |                   13 |                     4 |

Gründlich wurde zweimal in vertauschter Reihenfolge gemessen. Schnell läuft unverändert (keine zweite Lesung, ein Modell für beide Textschritte) und wurde einmal gemessen. Nachher sind es vier Starts: GLM-OCR, LightOnOCR-3, das größere Textmodell und Gemma 4 E2B für Inhalt und Form. Vorher sind es zwölf Starts der beiden Erkennungsmodelle (je Seite zwei) und einer für das Textmodell. Die Zeiten der Erkennung allein fallen bei Gründlich von 48,6 und 45,1 auf 36,7 und 40,0 s, bei Sehr gründlich von 45,6 auf 38,9 s. Inhalt und Form mit E2B braucht bei Sehr gründlich 13,3 statt 26,0 s. Auf einem 8-GB-Rechner, wo jeder Wechsel kalt von der Platte liest, spart der Durchgang entsprechend mehr.

## Kandidaten

Gemessen am 21.10.2026 auf einem M4 Pro (48 GB), nur CPU, 8 Threads, llama.cpp `b11537`, mit Prompts und Parametern der App (Textschritte `--no-repack --reasoning off`). Qualität aus den Evals in [eval/README.md](../../eval/README.md), Zeiten aus einem zweiten Lauf ohne andere llama-server auf dem Rechner. Neue Kandidaten aus der Recherche: Modelle von April bis Oktober 2026, die als GGUF mit llama.cpp auf der CPU in etwa 5 GB laufen.

### Erkennung

20 ScaDS-Seiten (Lesefehler) und 16 gerenderte Schülertexte mit 172 eingebauten Fehlern (erhalten oder eigenmächtig verbessert).

| Modell                               | Lizenz     | falsch gelesene Wörter (ScaDS) | Fehler erhalten / verbessert | Schleifen | s/Seite | Peak-RAM | listen         |
| ------------------------------------ | ---------- | -----------------------------: | ---------------------------: | --------: | ------: | -------: | -------------- |
| **GLM-OCR (Q8_0)**, empfohlen        | MIT        |                         20,1 % |                   91 % / 0 % |      0/20 |     7,5 |   3,2 GB | ja (empfohlen) |
| Granite Vision 4.1 4B (Q4_K_M), neu  | Apache-2.0 |                         17,6 % |                  56 % / 37 % |      3/20 |    22,1 |  7,7 GB¹ | nein           |
| MiniCPM-V 4.7 1B (Q4_K_M), neu       | Apache-2.0 |                        33,9 %² |                 63 % / 17 %² |     2/20² |   97,4² |  2,6 GB² | nein           |
| Qwen3-VL 4B (Q4_K_M), schon gelistet | Apache-2.0 |                        11,1 %³ |                 78 % / 18 %³ |     1/20³ |   23,3³ |  6,4 GB³ | ja             |

¹ Mit Repack wie die übrigen Erkennungskandidaten, RSS nach dem Laden 6,0 GB. ² Mit llama.cpp `b11551` und 1536 px wie in `eval/ocr-candidates.json`, `b11537` kennt den Projektortyp `minicpmv4_7` nicht. ³ Aus [Erkennung genauer](../evaluations/2026-10-erkennung-genauer.md), nicht neu gemessen; dort auch LightOnOCR-3 0.8B und 4B und Qwen3.5 2B, die ebenfalls Schülerfehler verbessern.

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

Alle gelisteten Kandidaten stehen unter Apache-2.0 oder MIT, Weitergabe als Download ist erlaubt. Für die Gründlichkeit neu: Gemma 4 26B A4B (Apache-2.0, `ggml-org/gemma-4-26B-A4B-it-GGUF`) und LightOnOCR-3 0.8B (Apache-2.0, Modell `lightonai/LightOnOCR-3-0.8B`, GGUF von `mradermacher/LightOnOCR-3-0.8B-GGUF`). Verworfen wegen Lizenz, ohne Messung: LFM2.5-VL-3B und LFM2.5-2.6B (LFM1.0, nur unter 10 Mio. USD Umsatz frei) und Surya OCR 2 (Modified OpenRAIL-M, nur Forschung, privat und Start-ups). Gemma 4 E4B steht wie E2B unter Apache-2.0 (Modellkarte von `ggml-org/gemma-4-E4B-it-GGUF`).

## Folgen

- `models.json` bekommt `customTemplates` und Gemma 4 E4B, `selection.json` hat einen Eintrag je Platz, `custom-models.json` kommt neu dazu.
- Neue Netzwerkzugriffe: zwei API-Pfade auf `huggingface.co` und ein Range-Request für den GGUF-Kopf. Keine neuen Hosts, CSP unverändert.
- Ohne Messung keine Lesesicherheit für eigene Erkennungsmodelle.
- MiniCPM-V 4.7 lädt seit dem Update auf llama.cpp `b11551`, liest aber schlechter als GLM-OCR und verbessert Schülerfehler.
- Offen: Eine Reihenfolge „erst alle Seiten erkennen, dann alle korrigieren“, die Wechsel je Lauf begrenzt, ist nicht Teil dieser Entscheidung.
- Gemma 4 E2B, E4B und 26B A4B laden ihren MTP-Kopf mit (60 bzw. 250 MB mehr), die Restdauer rechnet mit Faktoren je Schritt und einem Aufschlag nach dem fehlenden Speicher (Gründlichkeit, Restdauer).
