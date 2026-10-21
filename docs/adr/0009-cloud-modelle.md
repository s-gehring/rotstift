# 0009: Cloud-Modelle je Schritt

- Status: Entwurf
- Datum: 2026-10-21

## Kontext

Rotstift läuft bisher vollständig offline: Erkennung, Rechtschreibung und Grammatik sowie Inhalt und Form laufen über den lokalen `llama-server` ([0001](0001-tech-stack.md)). Auf einem 8-GB-Laptop ohne GPU ist das langsam, und große Modelle passen nicht. Manche Schulen haben einen Vertrag mit einem KI-Anbieter oder einen eigenen Server. Für sie soll jeder Schritt wahlweise ein entferntes Modell nutzen können.

Das widerspricht dem bisherigen Grundsatz, dass Schülerdaten den Rechner nie verlassen. Deshalb gilt: Cloud ist eine bewusste Ausnahme je Schritt, standardmäßig aus, nur nach einer konkreten Warnung, und jederzeit widerrufbar. Solange kein Schritt entfernt läuft, bleibt alles wie bisher.

Die Modellwahl je Schritt kommt aus [0008](0008-modell-je-schritt.md) (im Entwurf). Dieses ADR fügt dort eine weitere Art von Modell hinzu.

## Entscheidung

### Begriffe

- **Schritt**: Erkennung (`transcriber`), Rechtschreibung und Grammatik (`corrector`), Inhalt und Form (`reviewer`).
- **Anbieter**: Ein Endpunkt mit Basis-URL, Protokoll (`openai` oder `anthropic`) und optional einem API-Key. Er entsteht aus einer Vorlage oder von Hand.
- **Entferntes Modell**: Anbieter plus Modellname, gewählt für genau einen Schritt.
- **Freigabe**: Die bestätigte Warnung für ein Paar aus Anbieter und Schritt.

Jeder Endpunkt außer dem eigenen Sidecar gilt als entfernt, auch ein Schulserver im eigenen Netz und auch `localhost`. Eine einzige Regel ist leichter zu prüfen als Ausnahmen.

### Ablauf

1. In den Einstellungen (⚙) bietet die Modellwahl eines Schritts nach den lokalen Modellen den Eintrag „Cloud oder eigener Server …“.
2. Ein Dialog fragt nacheinander: Anbieter (Vorlage oder „Anderer Anbieter“, „Eigener Server“), Basis-URL (aus der Vorlage vorbelegt, änderbar), API-Key (Passwortfeld, bei „Eigener Server“ optional). Es ist kein Anbieter vorausgewählt.
3. „Weiter“ öffnet die Warnung für genau diesen Anbieter und diesen Schritt. Bis hier ist nichts gesendet und nichts gespeichert.
4. Nach der Bestätigung speichert Rust den Key im Schlüsselbund und die Freigabe in der Konfiguration. Erst jetzt darf Rotstift den Anbieter ansprechen: `GET /models` füllt die Modellauswahl, wo der Anbieter das anbietet, sonst ist der Modellname ein Textfeld.
5. Eine Prüfanfrage ohne Schülerdaten testet Key, Modellname und die Fähigkeit, die der Schritt braucht (siehe „Fähigkeiten“). Schlägt sie fehl, steht der Fehler im Dialog am betroffenen Feld, und der Schritt bleibt lokal.
6. Erst nach erfolgreicher Prüfung läuft der Schritt entfernt.

Widerruf: In den Einstellungen steht beim Schritt „Mistral AI · mistral-small-latest“ mit „Ausschalten“. Ausschalten löscht die Freigabe dieses Schritts und stellt das zuletzt gewählte lokale Modell wieder ein. „Anbieter entfernen“ löscht zusätzlich den Key und alle Freigaben dieses Anbieters. Eine laufende Korrektur bricht beim Widerruf ab, bereits gesendete Anfragen lassen sich nicht zurückholen.

Die Freigabe gilt je Anbieter und Schritt, gebunden an den Host der Basis-URL und an die Version des Warntexts. Ändert sich der Host oder wird der Warntext inhaltlich geändert (Version erhöht), muss neu bestätigt werden. Ein anderer Modellname beim selben Anbieter braucht keine neue Freigabe.

### Was je Schritt gesendet wird

| Schritt                       | Inhalt                                                                                                            | Größe                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Erkennung                     | jede Seite als JPEG (Qualität 0,9), so wie importiert und gedreht, plus fester Prompt                             | lange Kante 1536 px, gemessen etwa 0,2–0,5 MB je Seite, als Data-URL ein Drittel mehr |
| Rechtschreibung und Grammatik | erkannter Text der Arbeit mit Zeilennummern, Fach, Sprache, gewählte Fehlerarten, Aufgabenstellung                | wenige KB je Arbeit, eine Anfrage                                                     |
| Inhalt und Form               | erkannter Text mit Zeilennummern, Fach, Textform, Aufgabenstellung, je Merkmal eine Ja-Nein-Frage mit JSON-Schema | wenige KB je Anfrage, etwa 5–12 Anfragen je Arbeit                                    |

Nie gesendet werden Dateinamen, Klassen- oder Schülerlisten, Statistiken, Gewichtungen, Exporte und Bilder bei den Textschritten. Rust prüft das: Anfragen eines Textschritts mit Bildteilen werden abgewiesen. Text und Bild können trotzdem Namen und persönliche Angaben enthalten, die Schülerinnen und Schüler selbst geschrieben haben. Das sagt die Warnung.

Bei 1536 px liegen alle Seiten weit unter den Grenzen der Anbieter (IONOS 12 MiB je Bild, STACKIT 20 MiB je Anfrage, Anthropic 10 MB je Bild) und unter der eigenen Grenze von 8 MiB je Data-URL (`src-tauri/src/llm/request.rs`). Anthropic verkleinert ältere Modelle ohnehin auf 1568 px, OpenAI rechnet mit 2048 px. Die Kante ist je entferntem Modell einstellbar wie `imageMaxEdge` in der Registry.

### Key-Speicher

Der Key liegt im Schlüsselbund des Betriebssystems, über das Crate `keyring` (Version 3) mit Dienst `tv.gehring.rotstift` und der Anbieter-ID als Konto:

- macOS: Schlüsselbund (`apple-native`).
- Windows: Anmeldeinformationsverwaltung (`windows-native`).
- Linux: Secret Service über D-Bus (`sync-secret-service`), also GNOME Schlüsselbund oder KWallet.

Die Webview bekommt den Key nie zurück. Es gibt nur `cloud_set_key`, `cloud_has_key` und `cloud_delete_key`. Nach dem Speichern zeigt die Oberfläche „Schlüssel gespeichert“ und „Ändern“. Der Key steht nie in localStorage, in Dateien, im Protokoll oder in Fehlermeldungen.

Fehlt der Schlüsselbund (Linux ohne Secret Service, gesperrter oder verweigerter Zugriff), meldet der Dialog am Key-Feld „Kein Schlüsselbund verfügbar.“ und der Anbieter wird nicht eingerichtet. Es gibt keinen Ersatz in einer Datei. „Eigener Server“ ohne Key funktioniert weiter.

### Konfiguration und Freigaben

Anbieter (ohne Key), Modellwahl und Freigaben speichert Rust in `cloud.json` im App-Datenordner, nicht im Browser-Speicher. So prüft Rust selbst, ob gesendet werden darf, unabhängig von der Oberfläche. Eine Freigabe enthält Anbieter-ID, Schritt, Host, Warntext-Version und Zeitpunkt. Ist die Datei beschädigt, gilt keine Freigabe.

### Rust-Kommando

`cloud_chat { requestId, step, request }` antwortet in derselben Form wie `llm_chat`, damit `createLlmCorrector`, `createLlmTranscriber` und der Inhalt-und-Form-Schritt unverändert bleiben. Es läuft so ab:

1. Freigabe für Anbieter und Schritt laden. Fehlt sie oder passt der Host nicht: Fehler `consentMissing`, kein Netzwerkzugriff.
2. Anfrage mit `ChatRequest::parse` prüfen, erweitert um `response_format`. Bildteile nur im Schritt Erkennung.
3. Key aus dem Schlüsselbund lesen, falls der Anbieter einen hat.
4. In das Protokoll des Anbieters übersetzen und senden.

Netzwerk:

- HTTPS ist Pflicht. HTTP nur für „Eigener Server“ an Loopback- oder privaten Adressen (10/8, 172.16/12, 192.168/16, fc00::/7), und dann nie mit Key.
- Keine Weiterleitungen (`redirect::Policy::none`), damit Daten und Key nicht an einen anderen Host gehen.
- Verbindungsaufbau höchstens 10 s, ganze Anfrage höchstens 180 s, Antwort höchstens 2 MB.
- Gesendet werden nur `messages`, `temperature`, `max_tokens` (bei OpenAI als `max_completion_tokens`), `stop`, `response_format` und bei Bedarf `logprobs`. `seed`, `top_p` und llama.cpp-eigene Felder entfallen.

Wiederholung: Höchstens zwei weitere Versuche nach 1 s und 4 s, nur bei Verbindungsfehlern, 408, 429, 500, 502, 503 und 504. Ein `Retry-After` bis 30 s wird beachtet, längere Wartezeiten gelten als Fehler. Keine Wiederholung bei 400, 401, 403, 404, 413 und 422. Die Anfragen sind zustandslos, eine Wiederholung erzeugt höchstens Kosten, keine doppelten Daten beim Anbieter.

Abbrechen: Dieselbe Request-ID-Verwaltung wie `llm_cancel`. Der Abbruch verwirft die laufende Anfrage sofort (`tokio::select!`) und verhindert alle folgenden. Was der Anbieter schon erhalten hat, bleibt dort.

Fehlerklassen: `consentMissing`, `keyMissing`, `keychainUnavailable`, `auth` (401, 403), `rateLimited` (429), `notFound` (404, meist ein falscher Modellname), `tooLarge` (413), `badRequest` (400, 422), `server` (5xx), `network`, `timeout`, `cancelled`, `invalidResponse`. Fehlertexte des Anbieters werden weder angezeigt noch protokolliert, weil sie Teile der Anfrage zurückgeben können. Die Oberfläche zeigt einen eigenen Satz dort, wo der Fehler entsteht ([0005](0005-bedienkonzept.md)), etwa an der Arbeit: „Mistral AI hat den Schlüssel abgelehnt.“

Entfernte Schritte belegen keinen lokalen Sidecar. Die `LlmEngine` wird für sie nicht angefragt, es lädt also kein lokales Modell. Anfragen laufen zunächst nacheinander wie lokal.

### Protokoll

Je Anfrage eine Zeile `cloud_request` mit Vorlage (etwa `mistral`, `custom`), Schritt, Dauer, Versuchen, gesendeten Bytes, HTTP-Status und Fehlerklasse. Dazu `cloud_consent` und `cloud_revoke` mit Vorlage und Schritt. Nie Prompts, Antworten, Keys, URLs mit Pfad oder Fehlertexte des Anbieters. Ein Test prüft, dass ein bekannter Key und ein bekannter Satz aus der Anfrage in keiner Protokollzeile stehen.

### Fähigkeiten

| Bedarf      | Schritt         | Lösung                                                                                                                                                              |
| ----------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bilder      | Erkennung       | Prüfanfrage mit einem kleinen erzeugten Bild. Nimmt das Modell keine Bilder, ist es für die Erkennung nicht wählbar.                                                |
| JSON-Schema | Inhalt und Form | Prüfanfrage mit einem kleinen Schema. Ohne Unterstützung ist das Modell für diesen Schritt nicht wählbar. Antworten werden auf unserer Seite immer mit zod geprüft. |
| logprobs    | Erkennung       | Werden nicht angefragt. „Unsicher gelesen“ entfällt bei entfernter Erkennung (`uncertainBelow: null`).                                                              |

JSON-Schemas bleiben in der gemeinsamen Teilmenge: `type: "object"`, alle Felder in `required`, `additionalProperties: false`, `strict: true`, Zahlen mit `minimum` und `maximum`, kein `maxLength` (schneidet Kommentare ab, siehe Eval in #49). So nehmen OpenAI, Mistral und llama.cpp dasselbe Schema an.

logprobs entfallen, weil die Schwelle für „unsicher gelesen“ je Modell kalibriert ist (GLM-OCR 0,95, Qwen3-VL 0,9) und für fremde Modelle keine Kalibrierung vorliegt. Anthropic liefert sie gar nicht, OpenAI nicht für Reasoning-Modelle, bei den übrigen ist es je Modell offen. Die Oberfläche zeigt dann schlicht keine Hinweise auf unsicher gelesene Wörter.

Die Erkennung nutzt bei entfernten Modellen den allgemeinen Prompt des Qwen3-VL-Eintrags, nicht den GLM-OCR-Prompt „Text Recognition:“, der nur für GLM-OCR taugt. Rechtschreibung und Grammatik nutzen System-Prompt und Vorlage des Gemma-Eintrags, Inhalt und Form die Fragen aus dessen eigenem Schritt. Prompts lassen sich je entferntem Modell nicht ändern.

### Anthropic

Der OpenAI-kompatible Endpunkt von Anthropic ignoriert `response_format` und `logprobs` und gilt laut Anthropic nicht als Lösung für den Produktivbetrieb. Die Vorlage Anthropic nutzt deshalb die eigene Messages-API (`/v1/messages`, Kopfzeilen `x-api-key` und `anthropic-version`). Rust übersetzt nur, was wir senden: System-Nachricht, Text- und Bildteile (Data-URL in einen Base64-Block), `temperature`, `max_tokens`, `stop_sequences` und `response_format` in `output_config.format`. Die Antwort wird in die OpenAI-Form zurückübersetzt.

### Anbieter-Vorlagen

Reihenfolge in der Auswahl: Zuerst Anbieter mit Sitz und Rechenzentrum in der EU, alphabetisch, dann die übrigen, dann „Eigener Server“ und „Anderer Anbieter (OpenAI-kompatibel)“. Keiner ist vorausgewählt oder empfohlen. Die Angaben stammen von den Seiten der Anbieter, Stand 21.10.2026. Der Dialog nennt den Standort mit „laut Anbieter“ und verlinkt die AVV-Seite.

| Vorlage                  | Basis-URL                                                                  | Standort laut Anbieter                                                          | AVV                                                                                                                                                                    | JSON-Schema                     | Bilder                           | logprobs                                |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------- | --------------------------------------- |
| IONOS AI Model Hub       | `https://openai.inference.de-txl.ionos.com/v1`                             | Deutschland, keine Unterauftragsverarbeiter, Prompts werden nicht protokolliert | Teil des Vertrags, keine eigene Unterschrift ([Datenschutzpaket](https://cloud.ionos.de/terms-gtc/terms-enterprise-cloud/enterprise-datenschutzpaket/))                | nicht dokumentiert, Prüfanfrage | ja, je Modell, 12 MiB je Bild    | nicht dokumentiert                      |
| Mistral AI               | `https://api.mistral.ai/v1`                                                | EU (Standard), einzelne Funktionen auch außerhalb                               | Teil der Bedingungen, wird nicht gesondert unterschrieben ([DPA](https://legal.mistral.ai/terms/data-processing-addendum)); Training mit API-Daten im Konto abschalten | ja                              | ja, je Modell                    | Parameter vorhanden                     |
| STACKIT AI Model Serving | `https://api.openai-compat.model-serving.eu01.onstackit.cloud/v1`          | Deutschland (Region eu01), keine Speicherung, kein Training                     | Dokument zum Herunterladen ([AGB Cloud Services](https://stackit.com/de/agb/cloud-services)), Abschluss nicht dokumentiert                                             | je Modell, Prüfanfrage          | ja, je Modell, 20 MiB je Anfrage | nicht dokumentiert                      |
| Anthropic                | `https://api.anthropic.com/v1` (Messages-API)                              | USA oder weltweit, keine EU-Region; Löschung nach 30 Tagen                      | Teil der Commercial Terms ([DPA](https://www.anthropic.com/legal/data-processing-addendum))                                                                            | ja (eigene API)                 | ja, 10 MB je Bild                | nein                                    |
| OpenAI                   | `https://api.openai.com/v1`, mit EU-Projekt `https://eu.api.openai.com/v1` | USA; EWR nur mit freigeschaltetem EU-Projekt; Missbrauchsprotokolle bis 30 Tage | über OpenAI ([DPA](https://openai.com/policies/data-processing-addendum/)), Seite bei der Prüfung nicht abrufbar                                                       | ja                              | ja                               | je Modell, nicht bei Reasoning-Modellen |
| Eigener Server           | frei, etwa `http://schulserver:8080/v1`                                    | wie eingetragen                                                                 | Sache der Schule                                                                                                                                                       | Prüfanfrage                     | Prüfanfrage                      | nicht genutzt                           |
| Anderer Anbieter         | frei                                                                       | unbekannt                                                                       | unbekannt                                                                                                                                                              | Prüfanfrage                     | Prüfanfrage                      | nicht genutzt                           |

Die Vorlagen liegen als Daten in einer eigenen Datei neben `models.json`, damit sich URLs ohne Codeänderung pflegen lassen. Modellnamen enthalten sie nicht, sie kommen aus `GET /models` oder von der Lehrkraft.

### Einbindung in die Modellwahl je Schritt

[0008](0008-modell-je-schritt.md) legt je Schritt eine Modellreferenz fest (mitgeliefertes Modell oder eigenes GGUF). Dieses ADR ergänzt eine dritte Art `{ kind: 'remote', providerId, model }`. Die Fabrik, die je Schritt Transcriber, Corrector oder Reviewer baut, erzeugt dafür einen Client, dessen `complete()` `cloud_chat` statt `llm_chat` aufruft. Die Rollen-Einstellungen (Prompt, `maxOutputTokens`, `temperature`, `imageMaxEdge`) kommen aus dem Standardeintrag der Rolle, `uncertainBelow` ist `null`. Ohne gültige Freigabe baut die Fabrik keinen entfernten Client, und die Hauptaktion meldet „Cloud für Erkennung nicht freigegeben.“ statt still lokal zu rechnen.

### Cloud-Zeichen

Solange mindestens ein Schritt entfernt läuft, steht neben „Korrigieren“ ein kleines Wolken-Symbol in Grau (`--ink-muted`), nie in Rot. Tooltip und `aria-label` nennen Schritt und Anbieter, etwa „Erkennung über Mistral AI, Rechtschreibung lokal“. Ein Klick öffnet die Einstellungen beim ersten entfernten Schritt. Das Zeichen ist auch zwischen den Läufen sichtbar.

### Warnung

Ein Dialog je Anbieter und Schritt. Der Titel nennt Schritt und Anbieter. Die Bestätigung braucht ein Häkchen, der Standard-Knopf ist „Abbrechen“. Der Text ist versioniert (`CONSENT_VERSION = 1`).

Erkennung:

> **Erkennung über Mistral AI?**
>
> Rotstift schickt jede Seite als Bild an Mistral AI (api.mistral.ai). Auf den Bildern stehen die Handschrift und oft Namen der Schülerinnen und Schüler. Standort laut Anbieter: EU.
>
> Verantwortlich ist die Schule. Sie braucht einen Auftragsverarbeitungsvertrag mit dem Anbieter und gegebenenfalls die Freigabe des Schulträgers. Rotstift prüft das nicht.
>
> ☐ Die Schule hat das für Mistral AI geklärt.
>
> [Abbrechen] [Bilder senden]

Rechtschreibung und Grammatik, Inhalt und Form:

> **Rechtschreibung und Grammatik über Mistral AI?**
>
> Rotstift schickt den erkannten Text jeder Arbeit mit Fach und Aufgabenstellung an Mistral AI (api.mistral.ai). Bilder werden nicht gesendet. Im Text können Namen und persönliche Angaben stehen. Standort laut Anbieter: EU.
>
> Verantwortlich ist die Schule. Sie braucht einen Auftragsverarbeitungsvertrag mit dem Anbieter und gegebenenfalls die Freigabe des Schulträgers. Rotstift prüft das nicht.
>
> ☐ Die Schule hat das für Mistral AI geklärt.
>
> [Abbrechen] [Text senden]

Bei „Eigener Server“ und „Anderer Anbieter“ steht statt des Anbieters der Host, statt des Standorts „Standort unbekannt“.

### Tests

- Rust: Ohne Freigabe, mit Freigabe für einen anderen Schritt, nach Widerruf und nach geändertem Host erreicht `cloud_chat` einen lokalen Testserver nie (Zähler bleibt 0).
- Rust: Bildteile in einem Textschritt, HTTP mit Key und Weiterleitungen werden abgewiesen, ohne zu senden.
- Rust: Wiederholung nur bei den genannten Status, `Retry-After`, Abbruch während der Anfrage, Antwortgrenze.
- Rust: Übersetzung in die Anthropic-Form und zurück.
- Rust: Key und Inhalt erscheinen in keiner Protokollzeile.
- Frontend: „Abbrechen“ in der Warnung ruft weder `cloud_set_key` noch `cloud_confirm` noch `cloud_chat` auf. Ohne Häkchen ist der Bestätigungsknopf gesperrt.
- Frontend: Die Fabrik baut ohne Freigabe keinen entfernten Client. Das Cloud-Zeichen erscheint genau dann, wenn ein Schritt entfernt läuft.

Echte Anbieter werden nicht getestet. Stellvertreter ist ein lokaler `llama-server` mit `--api-key` (Key-Prüfung) und ohne (Eigener Server). Vorab geprüft: Der Corrector-Prompt, die Inhalt-und-Form-Fragen mit JSON-Schema (auch in der strengen Teilmenge) und die Erkennung mit Bild und logprobs funktionieren über `/v1/chat/completions` mit Bearer-Key; ohne oder mit falschem Key antwortet der Server mit 401.

### Doku

README und CLAUDE.md sagen künftig: Schülerdaten bleiben auf dem Rechner, solange kein Cloud-Modell und kein eigener Server eingeschaltet ist. Der neue Netzwerkzugriff läuft ausschließlich über Rust, die CSP in `tauri.conf.json` bleibt unverändert.

## Folgen

- Lehrkräfte mit schwachem Rechner oder Schulvertrag können große Modelle nutzen, ohne dass sich für alle anderen etwas ändert.
- Das Datenschutzversprechen wird bedingt. Die Warnung, das Häkchen und das dauerhafte Cloud-Zeichen sollen verhindern, dass das unbemerkt geschieht.
- Rust bekommt einen zweiten HTTP-Weg mit Schlüsselbund, Übersetzung für Anthropic und eigener Prüfung der Freigaben.
- „Unsicher gelesen“ fehlt bei entfernter Erkennung.
- Kosten entstehen beim Anbieter. Rotstift zeigt sie nicht an.
