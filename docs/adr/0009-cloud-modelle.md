# 0009: Cloud-Modelle je Schritt

- Status: Angenommen
- Datum: 2026-10-21

## Kontext

Rotstift läuft bisher vollständig offline: Erkennung, Rechtschreibung und Grammatik sowie Inhalt und Form laufen über den lokalen `llama-server` ([0001](0001-tech-stack.md)). Auf einem 8-GB-Laptop ohne GPU ist das langsam, und große Modelle passen nicht. Manche Schulen haben einen Vertrag mit einem KI-Anbieter oder einen eigenen Server. Für sie soll jeder Schritt wahlweise ein entferntes Modell nutzen können.

Das widerspricht dem bisherigen Grundsatz, dass Schülerdaten den Rechner nie verlassen. Deshalb gilt: Cloud ist eine bewusste Ausnahme je Schritt, standardmäßig aus, nur nach einem Hinweis und jederzeit widerrufbar. Solange kein Schritt entfernt läuft, bleibt alles wie bisher.

Die Modellwahl je Schritt kommt aus [0008](0008-modellwahl-je-schritt.md). Dieses ADR legt neben die lokale Wahl eines Schritts eine entfernte, die sie überdeckt.

Nachtrag: [0011](0011-personenbezug-entfernen.md) legt fest, dass vor dem Senden standardmäßig der Personenbezug entfernt wird und die Erkennung dann lokal bleibt. Wo dieses ADR „gesendet“ sagt, gilt es ohne Schutz oder nach dem Schwärzen, wie die Tabelle unten zeigt.

## Entscheidung

### Begriffe

- **Schritt**: Erkennung (`transcriber`), Rechtschreibung und Grammatik (`corrector`), Inhalt und Form (`reviewer`).
- **Anbieter**: Ein Endpunkt mit Basis-URL und optional einem API-Key. Er spricht entweder die OpenAI-kompatible Schnittstelle (`/chat/completions`) oder die Messages-API von Anthropic (`/messages`, siehe „Anthropic“). Er entsteht aus einer Vorlage oder von Hand, von Hand immer OpenAI-kompatibel.
- **Entferntes Modell**: Anbieter plus Modellname, gewählt für genau einen Schritt.
- **Freigabe**: Der bestätigte Hinweis für ein Paar aus Anbieter und Schritt.

Jeder Endpunkt außer dem eigenen Sidecar gilt als entfernt, auch ein Schulserver im eigenen Netz und auch `localhost`. Für alle gelten dieselben Regeln mit einer Ausnahme: Loopback-Adressen (`localhost`, 127.0.0.0/8, `::1`) brauchen keinen Hinweis und keine Freigabe, weil der Satz „Dieses Modell läuft nicht auf diesem Rechner“ dort falsch wäre. `localhost` verbindet Rust fest mit 127.0.0.1, damit ein umgebogener Name nicht nach außen führt. Bei HTTP löst Rust den Host vorher auf, sendet nur, wenn alle Adressen privat sind, und verbindet sich nur mit diesen. Das Cloud-Zeichen erscheint auch bei Loopback, weil die Daten an einen fremden Prozess gehen.

### Ablauf

1. In den Einstellungen (⚙) steht unter den lokalen Modellen eines Schritts der Knopf „Cloud-Modell …“, nur in der Desktop-App.
2. Ein Formular fragt: Anbieter (Vorlage, „Eigener Server“ oder „Anderer Anbieter“, kein Eintrag vorausgewählt), Adresse (nur bei „Eigener Server“ und „Anderer Anbieter“, die übrigen Vorlagen haben eine feste URL), Schlüssel (Passwortfeld, bei „Eigener Server“ und „Anderer Anbieter“ optional) und Modell (Textfeld, bei Anthropic eine Auswahl aus der Modellliste des Anbieters, siehe „Anthropic“).
3. „Verwenden“ lässt Rust Vorlage, Adresse und Modell prüfen. Fehlt für diesen Host und Schritt eine Freigabe, antwortet Rust mit `consentMissing`, und die Oberfläche zeigt den Hinweis (bei Loopback entfällt er). Bis hier ist nichts gesendet und nichts gespeichert.
4. Nach „Verwenden“ im Hinweis speichert Rust den Schlüssel im Schlüsselbund und Wahl samt Freigabe in `cloud.json`.
5. Eine Prüfanfrage ohne Schülerdaten testet Schlüssel, Modellname und die Fähigkeit, die der Schritt braucht (siehe „Fähigkeiten“). Schlägt sie fehl, schaltet die Oberfläche den Schritt wieder aus und zeigt den Fehler am betroffenen Feld.
6. Erst nach erfolgreicher Prüfung läuft der Schritt entfernt.

Widerruf: In den Einstellungen steht beim Schritt das Modell mit „Cloud“ oder „Eigener Server“, darunter Anbieter und Host, daneben „Ausschalten“. Ausschalten löscht Wahl und Freigabe dieses Schritts, ebenso die Wahl eines lokalen Modells im selben Schritt. Den Schlüssel löscht Rust, sobald kein Schritt mehr dieselbe Adresse nutzt. Die lokale Wahl bleibt die ganze Zeit erhalten und gilt danach wieder. Rust prüft die Wahl vor jeder Anfrage, ein laufender Durchgang sendet nach dem Ausschalten also nichts mehr. Bereits gesendete Anfragen lassen sich nicht zurückholen.

Die Freigabe gilt je Anbieter und Schritt, gebunden an den Host der Basis-URL und an `CONSENT_VERSION`. Ändert sich der Host oder wird der Hinweis inhaltlich geändert (Version erhöht), muss neu bestätigt werden. Ein anderer Modellname oder Schlüssel beim selben Host braucht keine neue Freigabe. Der Hinweis erscheint also beim Wählen, nicht bei jedem Lauf.

### Was je Schritt gesendet wird

| Schritt                       | Inhalt ohne Schutz                                                                                                | Mit Schutz (Standard bei Cloud-Anbietern, siehe [0011](0011-personenbezug-entfernen.md))                         | Größe                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Erkennung                     | jede Seite als JPEG (Qualität 0,9), so wie importiert und gedreht, plus fester Prompt                             | nichts: Die Erkennung läuft lokal, Cloud-Anfragen der Erkennung lehnt Rust ab                                    | lange Kante 1536 px, gemessen etwa 0,2–0,5 MB je Seite, als Data-URL ein Drittel mehr |
| Rechtschreibung und Grammatik | erkannter Text der Arbeit mit Zeilennummern, Fach, Sprache, gewählte Fehlerarten, Aufgabenstellung                | derselbe Text nach dem Schwärzen: Kennungen sind durch Platzhalter ersetzt, die Antwort wird lokal zurückgesetzt | wenige KB je Arbeit, eine Anfrage                                                     |
| Inhalt und Form               | erkannter Text mit Zeilennummern, Fach, Textform, Aufgabenstellung, je Merkmal eine Ja-Nein-Frage mit JSON-Schema | derselbe Text nach dem Schwärzen, sonst unverändert                                                              | wenige KB je Anfrage, etwa 5–12 Anfragen je Arbeit                                    |

Nie gesendet werden Dateinamen, Klassen- oder Schülerlisten, Statistiken, Gewichtungen, Exporte und Bilder bei den Textschritten. Rust prüft das: Anfragen eines Textschritts mit Bildteilen werden abgewiesen. Text und Bild können trotzdem Namen und persönliche Angaben enthalten, die Schülerinnen und Schüler selbst geschrieben haben. Der Hinweis spricht deshalb allgemein von Daten aus den Schülerarbeiten.

Bei 1536 px liegen alle Seiten weit unter den Grenzen der Anbieter (IONOS 12 MiB je Bild, STACKIT 20 MiB je Anfrage) und unter der eigenen Grenze von 8 MiB je Data-URL (`src-tauri/src/llm/request.rs`). OpenAI rechnet ohnehin mit höchstens 2048 px. Die Kante ist für entfernte Modelle fest (`MAX_IMAGE_EDGE`).

### Key-Speicher

Der Key liegt im Schlüsselbund des Betriebssystems, über das Crate `keyring` (Version 4) mit Dienst `tv.gehring.rotstift`. Das Konto ist `cloud-` plus ein Hash der Basis-URL, sodass zwei Schritte mit derselben Adresse einen Schlüssel teilen:

- macOS: Schlüsselbund.
- Windows: Anmeldeinformationsverwaltung.
- Linux: Secret Service über D-Bus (zbus, ohne libdbus), also GNOME Schlüsselbund oder KWallet.

Die Webview bekommt den Key nie zurück. Sie erfährt nur, ob einer da ist und wo er liegt (`system` oder `session`). Der Key steht nie in localStorage, in Dateien, im Protokoll oder in Fehlermeldungen.

Schlägt das Speichern im Schlüsselbund fehl (Linux ohne Secret Service, gesperrter oder verweigerter Zugriff), hält Rust den Key nur im Speicher, nie in einer Datei. Die Einstellungen sagen dann „Schlüssel gilt nur bis zum Beenden.“ Nach einem Neustart meldet die Hauptaktion „Für Mistral AI fehlt der Schlüssel. Bitte in den Einstellungen eingeben.“, und dort steht ein Schlüsselfeld beim Schritt. Wahl und Freigabe bleiben gespeichert.

### Konfiguration und Freigaben

Je Schritt speichert Rust Vorlage, Basis-URL, Modell und Freigabe (ohne Key) in `cloud.json` im App-Datenordner, nicht im Browser-Speicher. So prüft Rust selbst, ob gesendet werden darf, unabhängig von der Oberfläche. Eine Freigabe enthält Host, `CONSENT_VERSION` und Zeitpunkt. Ist die Datei beschädigt, gilt sie als leer. Geschrieben wird über eine temporäre Datei und Umbenennen.

### Rust-Kommando

`cloud_chat { requestId, step, request }` antwortet in derselben Form wie `llm_chat`, damit `createLlmCorrector`, `createLlmTranscriber` und der Inhalt-und-Form-Schritt unverändert bleiben. Es läuft so ab:

1. Wahl des Schritts aus `cloud.json` laden. Fehlt sie: `notConfigured`. Fehlt die Freigabe oder passt der Host nicht: `consentMissing`. In beiden Fällen kein Netzwerkzugriff. Bei Loopback entfällt die Freigabe.
2. Anfrage mit `ChatRequest::parse` prüfen. Bildteile nur im Schritt Erkennung.
3. Key lesen, falls die Vorlage einen verlangt oder einer gespeichert ist. Über HTTP wird nie ein Key gesendet.
4. Bei HTTP und `localhost` die Adressen festlegen (siehe „Begriffe“), auf die erlaubten Felder kürzen und senden.

Netzwerk:

- HTTPS ist Pflicht. HTTP nur für „Eigener Server“ an Loopback- oder privaten Adressen (10/8, 172.16/12, 192.168/16, fc00::/7), und dann nie mit Key.
- Keine Weiterleitungen (`redirect::Policy::none`), damit Daten und Key nicht an einen anderen Host gehen.
- Verbindungsaufbau höchstens 10 s, ganze Anfrage höchstens 180 s, Antwort höchstens 2 MB.
- Gesendet werden nur `model`, `messages`, `temperature`, `max_tokens` (bei den OpenAI-Vorlagen als `max_completion_tokens`), `stop` und `response_format`. `seed`, `top_p` und `logprobs` entfallen. Bei Anthropic gilt die Übersetzung aus „Anthropic“.

Wiederholung: Höchstens zwei weitere Versuche nach 1 s und 4 s, nur bei Verbindungsfehlern, 408, 429, 500, 502, 503, 504 und 529 (Anthropic: überlastet). Ein `Retry-After` bis 30 s wird beachtet, längere Wartezeiten gelten als Fehler. Keine Wiederholung bei 400, 401, 403, 404, 413 und 422. Die Anfragen sind zustandslos, eine Wiederholung erzeugt höchstens Kosten, keine doppelten Daten beim Anbieter.

Abbrechen: Dieselbe Request-ID-Verwaltung wie `llm_cancel`. Der Abbruch verwirft die laufende Anfrage sofort (`tokio::select!`) und verhindert alle folgenden. Was der Anbieter schon erhalten hat, bleibt dort.

Fehlerklassen: `notConfigured`, `consentMissing`, `keyMissing`, `invalidAddress`, `insecure`, `invalidRequest`, `auth` (401, 403), `rateLimited` (429), `notFound` (404, meist ein falscher Modellname), `tooLarge` (413), `badRequest` (übrige 4xx, bei Anthropic auch 402 Abrechnung), `server` (5xx), `network`, `timeout` (auch 408), `cancelled`, `invalidResponse`, `storage`. Fehlertexte des Anbieters werden weder angezeigt noch protokolliert, weil sie Teile der Anfrage zurückgeben können. Die Oberfläche zeigt einen eigenen Satz dort, wo der Fehler entsteht ([0005](0005-bedienkonzept.md)), etwa an der Arbeit oder am Schlüsselfeld: „Der Anbieter hat den Schlüssel abgelehnt.“

Entfernte Schritte belegen keinen lokalen Sidecar. Die `LlmEngine` wird für sie nicht angefragt, es lädt also kein lokales Modell. Anfragen laufen zunächst nacheinander wie lokal.

### Protokoll

Je Anfrage eine Zeile `cloud_request` mit Vorlage (etwa `mistral`, `custom`), Schritt, Dauer, Versuchen, gesendeten Bytes, HTTP-Status und Fehlerklasse. Dazu `cloud_consent` und `cloud_revoke` mit Vorlage und Schritt sowie `cloud_models` mit Vorlage, Dauer, Versuchen, Status und Fehlerklasse. Nie Prompts, Antworten, Keys, URLs oder Fehlertexte des Anbieters. Die Zeilen enthalten nur feste Namen und Zahlen, kein Feld übernimmt Text aus Anfrage, Antwort oder Konfiguration.

### Fähigkeiten

| Bedarf      | Schritt         | Lösung                                                                                                                                       |
| ----------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Bilder      | Erkennung       | Prüfanfrage mit einem kleinen erzeugten Bild. Nimmt das Modell keine Bilder, schlägt die Prüfung fehl, und der Schritt bleibt lokal.         |
| JSON-Schema | Inhalt und Form | Prüfanfrage mit einem kleinen Schema. Ohne Unterstützung schlägt die Prüfung fehl. Antworten werden auf unserer Seite immer mit zod geprüft. |
| logprobs    | Erkennung       | Werden nicht angefragt. „Unsicher gelesen“ entfällt bei entfernter Erkennung (`uncertainBelow: null`), siehe unten.                          |

JSON-Schemas bleiben in der gemeinsamen Teilmenge: `type: "object"`, alle Felder in `required`, `additionalProperties: false`, `strict: true`, Zahlen mit `minimum` und `maximum`, kein `maxLength` (schneidet Kommentare ab, siehe Eval in #49). So nehmen OpenAI, Mistral und llama.cpp dasselbe Schema an. Anthropic weist `minimum`, `maximum` und weitere Wertgrenzen ab, Rust entfernt sie dort vor dem Senden (siehe „Anthropic“). Die Grenzen prüft wie immer zod auf unserer Seite.

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

Reihenfolge in der Auswahl: Zuerst Anbieter mit Sitz und Rechenzentrum in der EU, alphabetisch, dann Anthropic und OpenAI, dann „Eigener Server“ und „Anderer Anbieter (OpenAI-kompatibel)“. Keiner ist vorausgewählt oder empfohlen. Die Angaben stammen von den Seiten der Anbieter. Sie stehen nur hier als Recherche, die Oberfläche nennt weder Standort noch AVV.

| Vorlage                  | Basis-URL                                                         | Standort laut Anbieter                                                                                                                                                                                                                                | AVV                                                                          | JSON-Schema                     | Bilder                                | logprobs                |
| ------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------- | ------------------------------------- | ----------------------- |
| IONOS AI Model Hub       | `https://openai.inference.de-txl.ionos.com/v1`                    | Deutschland, keine Unterauftragsverarbeiter, Prompts werden nicht protokolliert und nicht zum Training genutzt [1]                                                                                                                                    | Teil des Vertrags, keine eigene Unterschrift [2]                             | nicht dokumentiert, Prüfanfrage | ja, je Modell, 12 MiB je Bild [3]     | nicht dokumentiert      |
| Mistral AI               | `https://api.mistral.ai/v1`                                       | EU als Standard [4]; Training mit API-Daten je nach Tarif, bis widersprochen wird [5]                                                                                                                                                                 | Teil der Bedingungen, wird nicht gesondert unterschrieben [6]                | ja [7]                          | ja, je Modell [8]                     | Parameter vorhanden [7] |
| STACKIT AI Model Serving | `https://api.openai-compat.model-serving.eu01.onstackit.cloud/v1` | Deutschland (Region eu01) [9], keine Speicherung, kein Training [10]                                                                                                                                                                                  | Dokument zum Herunterladen, Abschluss nicht dokumentiert [11]                | je Modell, Prüfanfrage          | ja, je Modell, 20 MiB je Anfrage [12] | nicht dokumentiert      |
| Anthropic                | `https://api.anthropic.com/v1`                                    | Standard weltweit (`inference_geo: global`), nur USA auf Wunsch und nur per Anfrageparameter [17]; Daten in Ruhe in den USA [17]; Inhalte werden standardmäßig nicht gespeichert, bei einigen Modellen 30 Tage, markierte Inhalte bis zu 2 Jahre [18] | DPA nicht auf den geprüften Seiten, verwiesen wird auf das Trust Center [17] | ja [19]                         | ja [20]                               | nein                    |
| OpenAI                   | `https://api.openai.com/v1`                                       | USA; kein Training mit API-Daten, Missbrauchsprotokolle bis 30 Tage [13]                                                                                                                                                                              | DPA [14], Seite bei der Prüfung nicht abrufbar                               | ja [15]                         | ja [16]                               | je Modell               |
| OpenAI (EU-Projekt)      | `https://eu.api.openai.com/v1`                                    | EWR und Schweiz, nur mit einem freigeschalteten EU-Projekt [13]                                                                                                                                                                                       | wie OpenAI                                                                   | ja                              | ja                                    | je Modell               |
| Eigener Server           | frei, etwa `https://ki.schule.example/v1`                         | wie eingetragen                                                                                                                                                                                                                                       | Sache der Schule                                                             | Prüfanfrage                     | Prüfanfrage                           | nicht genutzt           |
| Anderer Anbieter         | frei                                                              | unbekannt                                                                                                                                                                                                                                             | unbekannt                                                                    | Prüfanfrage                     | Prüfanfrage                           | nicht genutzt           |

Erwogen und verworfen wurde ein Zusatzsatz je Anbieter im Hinweis. Die Entwürfe bleiben als Recherche:

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
17. https://platform.claude.com/docs/en/manage-claude/data-residency
18. https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
19. https://platform.claude.com/docs/en/build-with-claude/structured-outputs
20. https://platform.claude.com/docs/en/build-with-claude/vision
21. https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk
22. https://platform.claude.com/docs/en/api/messages und https://platform.claude.com/docs/en/api/versioning
23. https://platform.claude.com/docs/en/api/models-list
24. https://platform.claude.com/docs/en/api/errors und https://platform.claude.com/docs/en/api/rate-limits

Die Vorlagen liegen als Daten in `src-tauri/cloud-providers.json` neben `models.json`, damit sich URLs ohne Codeänderung pflegen lassen. Modellnamen enthalten sie nicht, die Lehrkraft trägt sie ein. `GET /models` wird bei den OpenAI-kompatiblen Anbietern nicht genutzt, weil die Liste je Anbieter unterschiedlich und oft unvollständig ist. Bei Anthropic ist sie vollständig und Teil der offiziellen API, deshalb kommt die Auswahl dort aus der Liste. Die Vorlage trägt dafür ein Feld `api` (`openai`, Standard, oder `anthropic`).

### Anthropic

Anthropic kommt als Vorlage über die eigene Messages-API. Der OpenAI-kompatible Endpunkt von Anthropic scheidet aus: Er ignoriert `response_format` und gilt laut Anthropic nicht als Lösung für den Produktivbetrieb [21]. Rust übersetzt deshalb die bestehende Anfrage im Format von `llm_chat` in eine Messages-Anfrage und die Antwort zurück. Freigabe, erlaubte Felder, Zeitlimits, Wiederholung, Fehlerklassen, Abbruch und Protokoll gelten unverändert. Die Oberfläche bemerkt den Unterschied nicht.

Die Angaben stammen von den Seiten der Anbieter, abgerufen am 21.10.2026 (Quellen 17–25).

| Thema                 | Anthropic                                                                                                                                                                                                                                                              | Umsetzung                                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anfrage               | `POST /v1/messages` mit `model`, `max_tokens`, `messages` [22]                                                                                                                                                                                                         | `<Basis-URL>/messages`                                                                                                                                                                                                                                |
| Header                | `x-api-key` und `anthropic-version`. Die Seiten empfehlen `2026-10-21`, die meisten Beispiele nutzen `2023-06-01`. Bearer gilt als älterer Weg [22]                                                                                                                    | `x-api-key` und `anthropic-version: 2023-06-01`. Beide Versionen kennen alles, was wir senden. Kein Bearer                                                                                                                                            |
| System-Prompt         | eigenes Feld `system`, kein System-Verlauf am Anfang von `messages` [22]                                                                                                                                                                                               | Alle `system`-Nachrichten werden zu einem Feld `system`                                                                                                                                                                                               |
| Bilder                | Block `image` mit `source: { type: "base64", media_type, data }`, JPEG, PNG, GIF, WebP. Höchstens 10 MB je Bild, 8000 px je Kante, 32 MB je Anfrage [20][22]                                                                                                           | Die Data-URL wird in `media_type` und `data` zerlegt. Unsere 8 MiB je Data-URL und 1536 px liegen darunter                                                                                                                                            |
| Strukturierte Ausgabe | `output_config.format` mit `type: "json_schema"`, ohne Beta-Header. Abgewiesen werden `minimum`, `maximum`, `multipleOf`, `minLength`, `maxLength` und `additionalProperties` ungleich `false`. Erzwungene Werkzeugaufrufe lehnen die neuesten Modelle mit 400 ab [19] | Das Schema aus `response_format` geht nach `output_config.format.schema`. Rust entfernt die abgewiesenen Schlüsselwörter (und `maxItems`, `minItems` über 1) und setzt `additionalProperties: false` an jedem Objekt. Der Weg über Werkzeuge entfällt |
| Temperatur            | Ab der Version `2026-10-21` 400 bei `temperature`, `top_p`, `top_k`. Neuere Modelle lehnen Werte außer dem Standard schon vorher ab [22]                                                                                                                               | `temperature` wird nie gesendet, ebenso wenig `seed`, `top_p` und `logprobs`. Die Antworten sind damit nicht festgelegt, zod prüft sie wie bei allen entfernten Modellen                                                                              |
| `stop`                | `stop_sequences` [22]                                                                                                                                                                                                                                                  | `stop` wird zu `stop_sequences`                                                                                                                                                                                                                       |
| Antwort               | `content` mit Blöcken, `stop_reason`, `usage` [22]                                                                                                                                                                                                                     | Alle `text`-Blöcke werden verkettet, andere ignoriert. `max_tokens` wird zu `length`, `refusal` zu `content_filter`, sonst `stop`. `usage` wird zu `prompt_tokens` und `completion_tokens`                                                            |
| `max_tokens`          | Pflicht [22]                                                                                                                                                                                                                                                           | Die Schritte senden ihren Wert. Fehlt er, setzt Rust je Schritt: Erkennung 4096, Rechtschreibung und Grammatik 4096, Inhalt und Form 512 (kurze Ja-Nein-Antworten). Obergrenze bleibt 4096                                                            |
| Modellliste           | `GET /v1/models` mit `limit` (bis 1000) und `after_id`, Antwort mit `data[].id`, `display_name`, `has_more`, `last_id` [23]                                                                                                                                            | siehe unten                                                                                                                                                                                                                                           |
| Fehler                | 400, 401, 402, 403, 404, 413, 429, 500, 504, 529. Fehlertext im JSON. `retry-after` in Sekunden, nicht an jeder 429 [24]                                                                                                                                               | Gleiche Klassen wie sonst, 529 zählt als `server` und wird wiederholt. Anbieter-Texte werden nicht gelesen, weder angezeigt noch protokolliert                                                                                                        |
| Standort, Daten       | Standard `inference_geo: global`. `us` ist nur ab Claude 4.6 und gegen Aufpreis wählbar. Kein EU-Wert. Daten in Ruhe in den USA. Kein Training ohne Erlaubnis, Aufbewahrung je nach Modell und Vertrag [17][18]                                                        | Rotstift setzt `inference_geo` nicht. Standort steht nur hier, nicht in der Oberfläche                                                                                                                                                                |

Die Modellliste: `cloud_models { template, baseUrl, key }` ruft `GET /models` ab, höchstens fünf Seiten zu 1000, und gibt `id` und `displayName` zurück. Das Kommando sendet keine Schülerdaten, nur den Schlüssel an den festen HTTPS-Host der Vorlage. Es braucht deshalb keine Freigabe und läuft vor „Verwenden“, mit dem eingetippten Schlüssel (oder dem gespeicherten) und ohne ihn zu speichern. Es gilt nur für Vorlagen mit `api: anthropic`, alles andere ist `invalidRequest`. Zeitlimits, Weiterleitungsverbot, Antwortgrenze, Wiederholung und Fehlerklassen sind dieselben wie bei `cloud_chat`.

Im Formular erscheint bei Anthropic statt des Textfelds der Knopf „Modelle laden“ (aktiv, sobald ein Schlüssel eingetragen ist) und danach eine Auswahl ohne Vorauswahl. Die Liste wird weder gefiltert noch geordnet noch kommentiert, nichts wird empfohlen. Ob das gewählte Modell Bilder oder JSON-Schema kann, zeigt wie sonst die Prüfanfrage in „Verwenden“. Wechselt der Anbieter, verfällt die Liste.

### Einbindung in die Modellwahl je Schritt

[0008](0008-modellwahl-je-schritt.md) schlägt eine weitere Herkunft `{ kind: 'remote', providerId, model }` in `source.kind` vor. Gebaut ist es anders: Die entfernte Wahl liegt getrennt in `cloud.json` und überdeckt die lokale Wahl des Schritts, statt sie zu ersetzen. `selection.json` und `custom-models.json` bleiben unverändert. So gilt nach dem Ausschalten sofort wieder das zuletzt gewählte lokale Modell, und die Prüfung der Freigabe liegt in Rust direkt neben der Wahl.

Läuft ein Schritt entfernt, baut die Oberfläche Transcriber, Corrector oder Reviewer mit einem Client, der `cloud_chat` und `cloud_cancel` statt `llm_chat` und `llm_cancel` aufruft, und mit einer Engine, die kein lokales Modell lädt. Die Rollen-Einstellungen (Prompt, `maxOutputTokens`, `temperature`) kommen aus den Vorlagen von [0008](0008-modellwahl-je-schritt.md) (`customTemplates`: Qwen3-VL für die Erkennung, Gemma für die Textschritte), `uncertainBelow` ist `null`. Ohne gültige Freigabe oder ohne nötigen Schlüssel baut die Oberfläche keinen entfernten Client, und die Hauptaktion meldet etwa „Mistral AI ist nicht freigegeben. Bitte in den Einstellungen neu wählen.“ statt still lokal zu rechnen.

### Cloud-Zeichen

Solange mindestens ein Schritt entfernt läuft, steht neben „Korrigieren“ ein kleines Wolkensymbol in Grau (`--color-text-muted`), nie in Rot. Tooltip und `aria-label` nennen alle Schritte, etwa „Texterkennung über Mistral AI, Korrektur lokal, Inhalt und Form lokal“. Ein Klick öffnet die Einstellungen. Das Zeichen ist auch zwischen den Läufen sichtbar.

### Hinweis

Der Hinweis erscheint, wenn für einen Schritt ein Cloud-Modell gewählt wird und für diesen Host und Schritt noch keine Freigabe besteht. Bei Loopback erscheint er nie. Er ist für alle Anbieter und Schritte gleich, ohne Häkchen, ohne Zusatzsatz je Anbieter und ohne Unterscheidung zwischen Bild und Text. Vorausgewählt ist „Abbrechen“. Der Text ist versioniert (`CONSENT_VERSION = 1`).

> **Cloud-Modell verwenden?**
>
> Dieses Modell läuft nicht auf diesem Rechner. Rotstift sendet dafür Daten aus den Schülerarbeiten an den verbundenen Drittanbieter. Für die Einhaltung der DSGVO und aller anderen Gesetze sind Sie selbst verantwortlich.
>
> [Abbrechen] [Verwenden]

### Tests

- Rust: Ohne Wahl, ohne Freigabe, mit Freigabe für einen anderen Schritt, nach geändertem Host und nach Ausschalten erreicht `cloud_chat` einen lokalen Testserver nie (Zähler bleibt 0).
- Rust: Gesendet werden nur die erlaubten Felder, mit dem Key als Bearer.
- Rust: Bildteile in einem Textschritt, HTTP mit Key, HTTP an öffentliche Adressen und Weiterleitungen werden abgewiesen, ohne zu senden.
- Rust: Wiederholung nur bei den genannten Status, `Retry-After`, Abbruch während der Anfrage, Zeitlimit, Antwortgrenze.
- Rust: Loopback ohne Freigabe erlaubt. Der Key bleibt nur im Speicher, wenn der Schlüsselbund fehlt, und wird gelöscht, wenn keine Wahl seine Adresse mehr nutzt.
- Frontend: „Abbrechen“ im Hinweis ruft `cloud_use` nicht mit Bestätigung auf und sendet nichts. „Abbrechen“ hat den Fokus, ein Häkchen gibt es nicht. Bei Loopback erscheint kein Hinweis.
- Rust (Anthropic, Stellvertreter bildet die Messages-API nach): Text mit System-Prompt, Bild als base64-Quelle, JSON-Schema als `output_config` ohne abgewiesene Schlüsselwörter, `max_tokens` je Schritt, Header `x-api-key` und `anthropic-version` ohne Bearer, 401, 429 mit `retry-after` (kurz wird abgewartet, lang ist ein Fehler), 529 mit Wiederholung, 500 nach drei Versuchen, unbrauchbare Antwort, Abbruch. Ohne Freigabe geht nichts an den Stellvertreter.
- Rust (Modellliste): Seiten mit `after_id`, Schlüssel nur im Header und nicht gespeichert, 401, fehlender Schlüssel, andere Vorlagen und fremde Adressen werden abgewiesen.
- Frontend: Bei Anthropic gibt es kein Textfeld und keine Vorauswahl, „Modelle laden“ braucht einen Schlüssel, ein Fehler der Liste steht im Formular, ein Anbieterwechsel verwirft die Liste.
- Frontend: Schlägt die Prüfanfrage fehl, wird der Schritt ausgeschaltet. Ohne Freigabe oder Schlüssel entsteht kein entfernter Client. Entfernte Schritte rufen nur `cloud_chat` und `cloud_cancel` auf. Das Cloud-Zeichen erscheint genau dann, wenn ein Schritt entfernt läuft.

Echte Anbieter werden nicht getestet. Für Anthropic ist der Stellvertreter ein lokaler Server im Test, der die Messages-API nachbildet. Sonst ist der Stellvertreter ein lokaler `llama-server` mit `--api-key` (Key-Prüfung) und ohne (Eigener Server). Vorab geprüft: Der Corrector-Prompt, die Inhalt-und-Form-Fragen mit JSON-Schema (auch in der strengen Teilmenge) und die Erkennung mit Bild und logprobs funktionieren über `/v1/chat/completions` mit Bearer-Key; ohne oder mit falschem Key antwortet der Server mit 401. Für den Weg über eine Nicht-Loopback-Adresse mit HTTPS liest ein Debug-Build zusätzlich die Zertifizierungsstelle aus `ROTSTIFT_DEV_CA`. Release-Builds ignorieren die Variable.

### Doku

README und CLAUDE.md sagen künftig: Schülerdaten bleiben auf dem Rechner, solange kein Cloud-Modell und kein eigener Server eingeschaltet ist. Der neue Netzwerkzugriff läuft ausschließlich über Rust, die CSP in `tauri.conf.json` bleibt unverändert.

## Folgen

- Lehrkräfte mit schwachem Rechner oder Schulvertrag können große Modelle nutzen, ohne dass sich für alle anderen etwas ändert.
- Anthropic läuft über die eigene Messages-API mit einer kleinen Übersetzung in Rust. Dafür gibt es einen zweiten Weg in `cloud_chat` und ein weiteres Kommando (`cloud_models`). Die Schnittstelle zur Oberfläche bleibt gleich.
- Bei Anthropic sind die Antworten nicht festgelegt, weil `temperature` nicht gesendet wird. Die Version `2026-10-21` weist den Parameter ab, neuere Modelle schon vorher.
- Offen: Ob Anthropic-Modelle Handschrift ausreichend lesen und die Ja-Nein-Fragen von Inhalt und Form richtig beantworten, lässt sich nur mit einem echten Schlüssel und öffentlichen Seiten messen, nie mit Schülerarbeiten. Bis dahin ist nichts ermittelt.
- Das Datenschutzversprechen wird bedingt. Der Hinweis und das dauerhafte Cloud-Zeichen sollen verhindern, dass das unbemerkt geschieht. Für Standort, Training und AVV ist die Lehrkraft selbst zuständig, Rotstift nennt sie nicht.
- Rust bekommt einen zweiten HTTP-Weg mit Schlüsselbund und eigener Prüfung der Freigaben.
- „Unsicher gelesen“ fehlt bei entfernter Erkennung. Eine Markierung durch das Modell selbst wurde geprüft und taugt mit dem Stellvertreter nicht.
- Kosten entstehen beim Anbieter. Rotstift zeigt sie nicht an.
