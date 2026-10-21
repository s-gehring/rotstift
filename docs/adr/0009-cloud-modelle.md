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
- **Anbieter**: Ein OpenAI-kompatibler Endpunkt (`/chat/completions`) mit Basis-URL und optional einem API-Key. Er entsteht aus einer Vorlage oder von Hand.
- **Entferntes Modell**: Anbieter plus Modellname, gewählt für genau einen Schritt.
- **Freigabe**: Die bestätigte Warnung für ein Paar aus Anbieter und Schritt.

Jeder Endpunkt außer dem eigenen Sidecar gilt als entfernt, auch ein Schulserver im eigenen Netz und auch `localhost`. Für alle gelten dieselben Regeln mit einer Ausnahme: Loopback-Adressen (`localhost`, 127.0.0.0/8, `::1`) brauchen keine Warnung und keine Freigabe, weil die Daten den Rechner nicht verlassen. Rust löst den Host vorher auf und verbindet sich nur mit der geprüften Adresse, damit ein umgebogener Name nicht nach außen führt. Das Cloud-Zeichen erscheint auch bei Loopback, weil die Daten an einen fremden Prozess gehen.

### Ablauf

1. In den Einstellungen (⚙) bietet die Modellwahl eines Schritts nach den lokalen Modellen den Eintrag „Cloud oder eigener Server …“.
2. Ein Dialog fragt nacheinander: Anbieter (Vorlage oder „Anderer Anbieter“, „Eigener Server“), Basis-URL (aus der Vorlage vorbelegt, änderbar), API-Key (Passwortfeld, bei „Eigener Server“ optional). Es ist kein Anbieter vorausgewählt.
3. „Weiter“ öffnet die Warnung für genau diesen Anbieter und diesen Schritt (bei Loopback entfällt sie). Bis hier ist nichts gesendet und nichts gespeichert.
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

Bei 1536 px liegen alle Seiten weit unter den Grenzen der Anbieter (IONOS 12 MiB je Bild, STACKIT 20 MiB je Anfrage) und unter der eigenen Grenze von 8 MiB je Data-URL (`src-tauri/src/llm/request.rs`). OpenAI rechnet ohnehin mit höchstens 2048 px. Die Kante ist je entferntem Modell einstellbar wie `imageMaxEdge` in der Registry.

### Key-Speicher

Der Key liegt im Schlüsselbund des Betriebssystems, über das Crate `keyring` (Version 3) mit Dienst `tv.gehring.rotstift` und der Anbieter-ID als Konto:

- macOS: Schlüsselbund (`apple-native`).
- Windows: Anmeldeinformationsverwaltung (`windows-native`).
- Linux: Secret Service über D-Bus (`sync-secret-service`), also GNOME Schlüsselbund oder KWallet.

Die Webview bekommt den Key nie zurück. Es gibt nur `cloud_set_key`, `cloud_has_key` und `cloud_delete_key`. Nach dem Speichern zeigt die Oberfläche „Schlüssel gespeichert“ und „Ändern“. Der Key steht nie in localStorage, in Dateien, im Protokoll oder in Fehlermeldungen.

Fehlt der Schlüsselbund (Linux ohne Secret Service, gesperrter oder verweigerter Zugriff), meldet der Dialog am Key-Feld „Kein Schlüsselbund verfügbar. Der Schlüssel gilt nur bis zum Beenden.“ Rust hält den Key dann nur im Speicher, nie in einer Datei. Nach einem Neustart fragt die App beim ersten entfernten Aufruf erneut nach dem Key, an der Hauptaktion und nicht mitten im Lauf. Freigabe und Anbieter bleiben gespeichert.

### Konfiguration und Freigaben

Anbieter (ohne Key), Modellwahl und Freigaben speichert Rust in `cloud.json` im App-Datenordner, nicht im Browser-Speicher. So prüft Rust selbst, ob gesendet werden darf, unabhängig von der Oberfläche. Eine Freigabe enthält Anbieter-ID, Schritt, Host, Warntext-Version und Zeitpunkt. Ist die Datei beschädigt, gilt keine Freigabe.

### Rust-Kommando

`cloud_chat { requestId, step, request }` antwortet in derselben Form wie `llm_chat`, damit `createLlmCorrector`, `createLlmTranscriber` und der Inhalt-und-Form-Schritt unverändert bleiben. Es läuft so ab:

1. Freigabe für Anbieter und Schritt laden. Fehlt sie oder passt der Host nicht: Fehler `consentMissing`, kein Netzwerkzugriff. Bei Loopback entfällt dieser Schritt.
2. Anfrage mit `ChatRequest::parse` prüfen, erweitert um `response_format`. Bildteile nur im Schritt Erkennung.
3. Key aus dem Schlüsselbund lesen, falls der Anbieter einen hat.
4. Auf die erlaubten Felder kürzen und senden.

Netzwerk:

- HTTPS ist Pflicht. HTTP nur für „Eigener Server“ an Loopback- oder privaten Adressen (10/8, 172.16/12, 192.168/16, fc00::/7), und dann nie mit Key.
- Keine Weiterleitungen (`redirect::Policy::none`), damit Daten und Key nicht an einen anderen Host gehen.
- Verbindungsaufbau höchstens 10 s, ganze Anfrage höchstens 180 s, Antwort höchstens 2 MB.
- Gesendet werden nur `messages`, `temperature`, `max_tokens` (bei den OpenAI-Vorlagen als `max_completion_tokens`), `stop` und `response_format`. `seed`, `top_p`, `logprobs` und llama.cpp-eigene Felder entfallen.

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
| logprobs    | Erkennung       | Werden nicht angefragt. „Unsicher gelesen“ entfällt bei entfernter Erkennung (`uncertainBelow: null`), siehe unten.                                                 |

JSON-Schemas bleiben in der gemeinsamen Teilmenge: `type: "object"`, alle Felder in `required`, `additionalProperties: false`, `strict: true`, Zahlen mit `minimum` und `maximum`, kein `maxLength` (schneidet Kommentare ab, siehe Eval in #49). So nehmen OpenAI, Mistral und llama.cpp dasselbe Schema an.

logprobs entfallen, weil die Schwelle für „unsicher gelesen“ je Modell kalibriert ist (GLM-OCR 0,95, Qwen3-VL 0,9) und für fremde Modelle keine Kalibrierung vorliegt. OpenAI liefert sie nicht für Reasoning-Modelle, bei den übrigen Anbietern ist es je Modell offen.

Als Ersatz wurde geprüft, ob das Modell unleserliche Wörter selbst kennzeichnet, etwa als `[?Haus]`. Stellvertreter war Qwen3-VL 4B lokal über `/v1/chat/completions`, 13 Seiten aus dem ScaDS-Datensatz mit Ground Truth, Temperatur 0:

| Prompt                                                                                                                | Falsch gelesene Wörter                           | Markierte Wörter          | Bemerkung                                                                  |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------- |
| Prompt der Registry                                                                                                   | 5,4 % (ohne eine Seite in Wiederholungsschleife) | keine                     |                                                                            |
| plus „Wenn du ein Wort nicht sicher lesen kannst, schreibe … [?Haus]. Nutze das nur, wenn du wirklich unsicher bist.“ | 8,0 %                                            | 0                         | setzt stattdessen einmal ein `?` mitten ins Wort                           |
| plus „Kennzeichne jedes Wort, bei dem du dir nicht sicher bist … Lieber ein Wort zu viel …“                           | 28,3 %                                           | 372, alle auf einer Seite | 12 Seiten ohne Markierung, eine Seite kippt in eine Schleife aus `[?Haus]` |

Die Markierung taugt also nicht: Das Modell kennzeichnet keine seiner rund 100 Lesefehler, und die Zusatzanweisung verschlechtert die Erkennung. Bei entfernter Erkennung entfällt „unsicher gelesen“ deshalb ganz. Die Oberfläche zeigt dann keine Hinweise auf unsicher gelesene Wörter. Ob große Cloud-Modelle das besser können, lässt sich nur mit einem echten Anbieter messen, mit öffentlichen Seiten wie ScaDS und nie mit Schülerarbeiten. Bis dahin bleibt es aus.

Die Erkennung nutzt bei entfernten Modellen den allgemeinen Prompt des Qwen3-VL-Eintrags, nicht den GLM-OCR-Prompt „Text Recognition:“, der nur für GLM-OCR taugt. Rechtschreibung und Grammatik nutzen System-Prompt und Vorlage des Gemma-Eintrags, Inhalt und Form die Fragen aus dessen eigenem Schritt. Prompts lassen sich je entferntem Modell nicht ändern.

### Anbieter-Vorlagen

Reihenfolge in der Auswahl: Zuerst Anbieter mit Sitz und Rechenzentrum in der EU, alphabetisch, dann OpenAI, dann „Eigener Server“ und „Anderer Anbieter (OpenAI-kompatibel)“. Keiner ist vorausgewählt oder empfohlen. Die Angaben stammen von den Seiten der Anbieter. Der Dialog nennt den Standort mit „laut Anbieter“ und verlinkt die AVV-Seite.

| Vorlage                  | Basis-URL                                                         | Standort laut Anbieter                                                                                             | AVV                                                           | JSON-Schema                     | Bilder                                | logprobs                |
| ------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------- | ------------------------------------- | ----------------------- |
| IONOS AI Model Hub       | `https://openai.inference.de-txl.ionos.com/v1`                    | Deutschland, keine Unterauftragsverarbeiter, Prompts werden nicht protokolliert und nicht zum Training genutzt [1] | Teil des Vertrags, keine eigene Unterschrift [2]              | nicht dokumentiert, Prüfanfrage | ja, je Modell, 12 MiB je Bild [3]     | nicht dokumentiert      |
| Mistral AI               | `https://api.mistral.ai/v1`                                       | EU als Standard [4]; Training mit API-Daten je nach Tarif, bis widersprochen wird [5]                              | Teil der Bedingungen, wird nicht gesondert unterschrieben [6] | ja [7]                          | ja, je Modell [8]                     | Parameter vorhanden [7] |
| STACKIT AI Model Serving | `https://api.openai-compat.model-serving.eu01.onstackit.cloud/v1` | Deutschland (Region eu01) [9], keine Speicherung, kein Training [10]                                               | Dokument zum Herunterladen, Abschluss nicht dokumentiert [11] | je Modell, Prüfanfrage          | ja, je Modell, 20 MiB je Anfrage [12] | nicht dokumentiert      |
| OpenAI                   | `https://api.openai.com/v1`                                       | USA; kein Training mit API-Daten, Missbrauchsprotokolle bis 30 Tage [13]                                           | DPA [14], Seite bei der Prüfung nicht abrufbar                | ja [15]                         | ja [16]                               | je Modell               |
| OpenAI (EU-Projekt)      | `https://eu.api.openai.com/v1`                                    | EWR und Schweiz, nur mit einem freigeschalteten EU-Projekt [13]                                                    | wie OpenAI                                                    | ja                              | ja                                    | je Modell               |
| Eigener Server           | frei, etwa `https://ki.schule.example/v1`                         | wie eingetragen                                                                                                    | Sache der Schule                                              | Prüfanfrage                     | Prüfanfrage                           | nicht genutzt           |
| Anderer Anbieter         | frei                                                              | unbekannt                                                                                                          | unbekannt                                                     | Prüfanfrage                     | Prüfanfrage                           | nicht genutzt           |

Zusatzsatz in der Warnung, wenn der Anbieter außerhalb der EU sitzt oder API-Daten je nach Tarif zum Training nutzt:

| Vorlage             | Zusatzsatz                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Mistral AI          | „Mistral AI kann die Daten je nach Tarif zum Training nutzen, bis die Schule widerspricht.“ [5]        |
| OpenAI              | „Standort laut Anbieter: USA.“ (ersetzt die Standortzeile) [13]                                        |
| OpenAI (EU-Projekt) | „Die Daten bleiben laut Anbieter nur dann im EWR, wenn der Schlüssel zu einem EU-Projekt gehört.“ [13] |

Quellen, alle abgerufen am 21.10.2026:

1. https://docs.ionos.com/cloud/ai/ai-model-hub/governance-and-compliance/data-handling
2. https://cloud.ionos.de/terms-gtc/terms-enterprise-cloud/enterprise-datenschutzpaket/
3. https://docs.ionos.com/cloud/ai/ai-model-hub/how-tos/image-input
4. https://help.mistral.ai/en/articles/347629-where-do-you-store-my-data-and-are-you-compliant-with-gdpr
5. https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-models und Abschnitt 2.3 in [6]
6. https://legal.mistral.ai/terms/data-processing-addendum
7. https://docs.mistral.ai/api/
8. https://docs.mistral.ai/capabilities/vision/
9. https://docs.stackit.cloud/platform/regions/
10. https://docs.stackit.cloud/products/data-and-ai/ai-model-serving/faq/
11. https://stackit.com/de/agb/cloud-services
12. https://docs.stackit.cloud/products/data-and-ai/ai-model-serving/basics/available-shared-models/
13. https://developers.openai.com/api/docs/guides/your-data
14. https://openai.com/policies/data-processing-addendum/
15. https://developers.openai.com/api/docs/guides/structured-outputs
16. https://developers.openai.com/api/docs/guides/images-vision

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
> [Zusatzsatz der Vorlage, falls vorhanden]
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
> [Zusatzsatz der Vorlage, falls vorhanden]
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
- Rust: Loopback ohne Freigabe erlaubt, ein Name, der auf eine andere Adresse auflöst, nicht.
- Rust: Key nur im Speicher, wenn der Schlüsselbund fehlt; keine Datei enthält ihn.
- Rust: Key und Inhalt erscheinen in keiner Protokollzeile.
- Frontend: „Abbrechen“ in der Warnung ruft weder `cloud_set_key` noch `cloud_confirm` noch `cloud_chat` auf. Ohne Häkchen ist der Bestätigungsknopf gesperrt.
- Frontend: Die Fabrik baut ohne Freigabe keinen entfernten Client. Das Cloud-Zeichen erscheint genau dann, wenn ein Schritt entfernt läuft.

Echte Anbieter werden nicht getestet. Stellvertreter ist ein lokaler `llama-server` mit `--api-key` (Key-Prüfung) und ohne (Eigener Server). Vorab geprüft: Der Corrector-Prompt, die Inhalt-und-Form-Fragen mit JSON-Schema (auch in der strengen Teilmenge) und die Erkennung mit Bild und logprobs funktionieren über `/v1/chat/completions` mit Bearer-Key; ohne oder mit falschem Key antwortet der Server mit 401.

### Doku

README und CLAUDE.md sagen künftig: Schülerdaten bleiben auf dem Rechner, solange kein Cloud-Modell und kein eigener Server eingeschaltet ist. Der neue Netzwerkzugriff läuft ausschließlich über Rust, die CSP in `tauri.conf.json` bleibt unverändert.

## Folgen

- Lehrkräfte mit schwachem Rechner oder Schulvertrag können große Modelle nutzen, ohne dass sich für alle anderen etwas ändert.
- Anthropic fehlt in Version 1: Sein OpenAI-kompatibler Endpunkt ignoriert `response_format` und gilt laut Anthropic nicht als Lösung für den Produktivbetrieb. Ein Ausbau über die eigene Messages-API mit einer kleinen Übersetzung in Rust ist möglich.
- Das Datenschutzversprechen wird bedingt. Die Warnung, das Häkchen und das dauerhafte Cloud-Zeichen sollen verhindern, dass das unbemerkt geschieht.
- Rust bekommt einen zweiten HTTP-Weg mit Schlüsselbund und eigener Prüfung der Freigaben.
- „Unsicher gelesen“ fehlt bei entfernter Erkennung. Eine Markierung durch das Modell selbst wurde geprüft und taugt mit dem Stellvertreter nicht.
- Kosten entstehen beim Anbieter. Rotstift zeigt sie nicht an.
