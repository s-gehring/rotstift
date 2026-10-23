# 0012: Abo über eine CLI

- Status: Angenommen
- Datum: 2026-10-23

## Kontext

[0009](0009-cloud-modelle.md) lässt jeden Schritt ein Cloud-Modell über eine HTTP-API mit Schlüssel nutzen, [0011](0011-personenbezug-entfernen.md) entfernt davor standardmäßig den Personenbezug. Viele Lehrkräfte haben aber keinen API-Schlüssel, sondern ein privates Abo: Claude Pro oder Max mit der CLI Claude Code (`claude`), ChatGPT mit der Codex CLI (`codex`). Beide CLIs lassen sich nicht-interaktiv starten und melden sich selbst an. Ein Schlüssel ist dann nicht nötig, und Rotstift muss weder Schlüssel noch Token sehen.

Eine CLI ist kein HTTP-Endpunkt, sondern ein fremdes Programm auf dem Rechner der Lehrkraft. Es liest Einstellungen, Hooks, Speicher und Projektanweisungen aus dem Benutzerordner, kann Werkzeuge ausführen und schickt die Anfrage selbst an den Anbieter. Dieses ADR legt fest, wie Rotstift so ein Programm startet, abschirmt und an Wahl, Freigabe und Schutz aus 0009 und 0011 bindet. Gebaut ist der Adapter für Claude Code, Codex braucht nur noch einen eigenen Adapter.

Privat-Abos sind Verbraucherverträge. Einen Vertrag zur Auftragsverarbeitung gibt es dafür in der Regel nicht, und je nach Kontoeinstellung nutzt der Anbieter die Gespräche zum Training. Für Schulen ist das die wichtigste Grenze dieses Weges.

## Entscheidung

### Begriffe

- **CLI-Anbieter**: Eine Vorlage mit `api: "cli"` in `src-tauri/cloud-providers.json`. Sie hat die feste Adresse `cli://<adapter>`, keinen Schlüssel (`key: "none"`), eine Liste erlaubter Modell-Aliase und die Befehle zum Installieren und Anmelden.
- **Adapter**: Der Teil in Rust, der für eine bestimmte CLI Argumente und Eingabe baut, die Ausgabe liest und Fehler einordnet (`src-tauri/src/cloud/cli/`).
- **Programm**: Der Pfad zur ausführbaren Datei der CLI, gefunden oder von Hand gewählt, samt Version.

| Vorlage       | Anzeige                    | Adresse        | Modelle                   | Zustand                                        |
| ------------- | -------------------------- | -------------- | ------------------------- | ---------------------------------------------- |
| `claude-code` | „Claude-Abo (Claude Code)“ | `cli://claude` | `sonnet`, `opus`, `haiku` | gebaut                                         |
| `codex`       | „ChatGPT-Abo (Codex)“      | `cli://codex`  | noch keine                | ausgeblendet (`hidden`), bis der Adapter kommt |

### Gleiche Regeln wie Cloud-Anbieter

CLI-Anbieter hängen an derselben Wahl je Schritt in `cloud.json` und laufen durch dieselben Kommandos `cloud_use`, `cloud_check`, `cloud_chat`, `cloud_set_protection` und `cloud_clear`. Es gibt keinen zweiten Weg zum Senden.

- **Freigabe:** Der Hinweis „Cloud-Modell verwenden?“ aus 0009 erscheint unverändert. Die Freigabe ist an den „Host“ der Adresse gebunden, also an `claude`, und an `CONSENT_VERSION`. Ein anderer Pfad zum Programm oder ein anderes Modell braucht keine neue Freigabe, weil die Daten an denselben Anbieter gehen.
- **Schutz:** Standardmäßig an, wie bei jedem Cloud-Anbieter (die Adresse ist weder „Eigener Server“ noch Loopback). Ausschalten braucht die eigene Freigabe aus 0011.
- **Sperren:** `cloud_chat` prüft in dieser Reihenfolge Wahl, Freigabe, Schutz (`protectionActive` bei der Erkennung, `notPseudonymized` ohne Flag) und Bildteile in Textschritten, erst danach zweigt es zum Adapter ab. Ein CLI-Anbieter erreicht die CLI also nur nach denselben Prüfungen wie ein HTTP-Anbieter. Ist der Schutz aus, geht auch die Erkennung mit Seitenbildern über die CLI.
- **Cloud-Zeichen und Tooltip:** Die Anzeige nutzt den kurzen Namen (`shortLabel`), etwa „Texterkennung lokal, Korrektur über Claude-Abo, pseudonymisiert, Inhalt und Form lokal“.

Zusätzlich gilt beim Ausschalten des Schutzes für CLI-Anbieter ein Satz im Hinweis aus 0011, vor dem Satz zur Verantwortung:

> Bei einem privaten Abo besteht in der Regel kein Vertrag zur Auftragsverarbeitung, und je nach Kontoeinstellung nutzt der Anbieter die Daten zum Training.

`PROTECTION_CONSENT_VERSION` bleibt 1: Für CLI-Anbieter gibt es noch keine Freigaben, und für die übrigen Anbieter ändert sich der Text nicht. Wird der Satz später geändert, steigt die Version.

### Was gestartet wird

Für Claude Code startet Rust genau diese Argumentliste, ohne Shell, als Liste an `tokio::process::Command`:

```
<programm> -p --input-format stream-json --output-format stream-json --verbose
  --model <alias> --system-prompt <fester Satz> --tools "" --strict-mcp-config
  --setting-sources "" --safe-mode --disable-slash-commands --no-session-persistence
  --permission-mode dontAsk --max-turns 1
```

Mit JSON-Schema (Inhalt und Form, Prüfanfrage des Reviewers) kommen `--max-turns 2` und `--json-schema <schema>` dazu, weil die CLI die strukturierte Antwort als eigenes Werkzeug `StructuredOutput` zurückgibt und dafür zwei Züge zählt (gemessen: `num_turns: 2`).

| Argument                                                        | Wirkung                                                                                                                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-p`, `--input-format/--output-format stream-json`, `--verbose` | Ein Durchlauf ohne Oberfläche, Eingabe als JSON-Zeile über stdin, Ausgabe als JSON-Zeilen. `stream-json` als Eingabe verlangt `stream-json` als Ausgabe. |
| `--model <alias>`                                               | Nur Aliase aus der Vorlage. Rust prüft das Zeichenmuster (kein führendes `-`) und die Liste.                                                             |
| `--system-prompt <fester Satz>`                                 | Ersetzt den Systemprompt von Claude Code samt Umgebungsangaben. Der Satz ist fest und enthält keine Daten.                                               |
| `--tools ""`                                                    | Keine Werkzeuge (kein Dateizugriff, keine Befehle, kein Web). Mit Schema bleibt nur `StructuredOutput`.                                                  |
| `--strict-mcp-config`                                           | Keine MCP-Server, weil keine `--mcp-config` mitgegeben wird.                                                                                             |
| `--setting-sources ""`                                          | Keine Benutzer-, Projekt- und lokalen Einstellungen, also keine Hooks, kein `env`, kein `apiKeyHelper`.                                                  |
| `--safe-mode`                                                   | Keine CLAUDE.md, kein Speicher, keine Skills, Plugins, Agenten, Ausgabestile.                                                                            |
| `--disable-slash-commands`                                      | Keine Skills über Schrägstrich-Befehle.                                                                                                                  |
| `--no-session-persistence`                                      | Keine gespeicherte Sitzung, nichts zum Fortsetzen.                                                                                                       |
| `--permission-mode dontAsk`                                     | Was eine Rückfrage bräuchte, wird abgelehnt.                                                                                                             |
| `--max-turns 1` (2 mit Schema)                                  | Höchstens ein Zug.                                                                                                                                       |

Nicht genutzt wird `--bare`: Es schirmt ebenfalls ab, liest aber nur `ANTHROPIC_API_KEY` und nie die Anmeldung des Abos.

**Eingabe:** Prompt und Bilder gehen nur über stdin, nie als Argument, damit sie nicht in der Prozessliste stehen. Rust schreibt genau eine Nachricht `{"type":"user","message":{"role":"user","content":[…]}}`: zuerst die Bilder als `image`-Blöcke mit base64-Quelle, dann ein Textblock. Der Text beginnt mit den System-Nachrichten der Anfrage zwischen `<anweisungen>` und `</anweisungen>`, danach folgen die Nachrichten der Reihe nach. Eine frühere Antwort des Modells (die Nachbesserung des Correctors) steht zwischen `<bisherige_antwort>` und `</bisherige_antwort>`. Danach schließt Rust stdin.

**Ausgabe:** Rust liest die letzte Zeile mit `"type":"result"`. Erfolg ist `is_error: false` mit `subtype: "success"`. Die Antwort ist `structured_output` als JSON-Text, sonst `result`. `stop_reason: "max_tokens"` wird zu `finish_reason: "length"`, `usage` zu `prompt_tokens` und `completion_tokens`. Die Oberfläche bekommt dieselbe Form wie bei `llm_chat`.

`max_tokens` und `temperature` lassen sich der CLI nicht mitgeben und entfallen, wie bei Anthropic in 0009. zod prüft die Antworten wie immer.

### Abschirmung des Prozesses

- **Umgebung:** Rust leert die Umgebung (`env_clear`) und gibt nur eine feste Liste weiter: `HOME`, `USER`, `LOGNAME`, `TMPDIR`, `LANG`, `LC_ALL`, `LC_CTYPE`, die `XDG_*`-Ordner, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, Proxy-Variablen, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` und die nötigen Windows-Variablen. `PATH` ist der Ordner des Programms vor dem `PATH` der Login-Shell. Dazu setzt der Adapter `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` und `DISABLE_TELEMETRY=1`.
  - Damit fallen `ANTHROPIC_API_KEY` und `ANTHROPIC_AUTH_TOKEN` weg. Laut Anthropic gehen beide der Anmeldung des Abos vor, im Modus `-p` wird ein gesetzter Schlüssel immer benutzt. Rotstift rechnet also immer über das Abo ab, nie versehentlich über einen API-Schlüssel.
  - Ebenso fallen `CLAUDECODE`, `CLAUDE_CODE_*` und `ANTHROPIC_BASE_URL` einer umgebenden Claude-Code-Sitzung weg (etwa bei `pnpm dev` aus Claude Code heraus). `CLAUDE_CODE_SIMPLE` aus so einer Sitzung würde sonst `--bare` einschalten, `ANTHROPIC_BASE_URL` die Anfrage umleiten.
- **Arbeitsordner:** Je Aufruf ein frischer leerer Ordner `rotstift-cli-<zufall>` im Temp-Verzeichnis (Rechte 0700), der danach gelöscht wird. Gemessen: Die CLI legt dafür keinen Eintrag in `~/.claude.json` an.
- **Ohne Shell:** Argumente als Liste. Unter Windows nur `claude.exe`, keine `.cmd`-Dateien, weil die über `cmd.exe` liefen.
- **Zeitlimit und Abbruch:** 300 s je Anfrage, 15 s für `--version`. Die CLI läuft unter Unix in einer eigenen Prozessgruppe, unter Windows in einem eigenen Job-Objekt. Zeitüberschreitung, Abbruch über `cloud_cancel` und Abbruch durch zu große Ausgabe beenden die ganze Gruppe beziehungsweise den Job, also auch Kindprozesse. Nach einem normalen Ende wartet Rust höchstens 2 s auf das Programm, bevor es die Gruppe beendet.
- **Ausgabegrenzen:** stdout höchstens 4 MB (darüber `invalidResponse`), stderr höchstens 64 KB (wird abgeschnitten und nur auf „unknown option“ geprüft).
- **Eine Anfrage nach der anderen:** Ein Schloss in `CloudState` lässt immer nur eine CLI laufen, auch wenn mehrere Schritte über dieselbe CLI gehen.

### Programm finden

`cli_find { template }` sucht automatisch, `cli_pick { template }` öffnet einen Dateidialog in Rust. Beide liefern Pfad und Version oder nichts.

- Gesucht wird im `PATH` der Login-Shell, im eigenen Ordner des Adapters (`~/.claude/local`), in `~/.local/bin` (native Installation), `~/.npm-global/bin`, `~/.bun/bin`, `~/.volta/bin`, in den Installationsordnern der Node-Versionsmanager (`~/.local/share/fnm/node-versions/*/installation/bin`, `~/Library/Application Support/fnm/node-versions/*/installation/bin`, `~/.nvm/versions/node/*/bin`), in `/opt/homebrew/bin`, `/usr/local/bin` und `/usr/bin`. GUI-Apps auf macOS erben den `PATH` des Terminals nicht. Rust startet deshalb einmal je App-Start `$SHELL -l -i -c 'printf …"$PATH"'` (5 s Zeitlimit, ohne Eingabe, mit derselben leeren Umgebung) und merkt sich das Ergebnis. Unter Windows gilt der `PATH` der App.
- Rust fragt jeden Fund nach `--version` und nimmt die neueste Version. Funde, die auf denselben aufgelösten Pfad zeigen, zählen einmal, bei gleicher Version gewinnt die Reihenfolge oben. Lehrkräfte mit mehreren Node-Versionen haben oft mehrere Kopien, die neueste ist meist die, die sie zuletzt installiert und angemeldet haben.
- Angenommen wird nur eine ausführbare Datei mit absolutem Pfad, deren Name zum Adapter passt (`claude`, unter Windows `claude.exe`) und deren `--version` dem Muster `x.y.z (Claude Code)` folgt. Das gilt auch für einen von Hand gewählten Pfad und erneut beim Speichern über `cloud_use`, weil der Pfad aus der Oberfläche kommt.
- Gespeichert wird der Ordner aufgelöst (ohne Symlinks), der Dateiname nicht. fnm legt je Shell einen flüchtigen Ordner `~/.local/state/fnm_multishells/<pid>_<zeit>/bin` an, der auf `node-versions/<version>/installation` zeigt. Gespeichert wird dann `…/node-versions/v22.23.1/installation/bin/claude`, der auch gültig bleibt, wenn der Sitzungsordner verschwindet.
- `cloud.json` bekommt je Wahl `cliPath` und `cliVersion`. Die Oberfläche zeigt beides beim Schritt, etwa „Claude-Abo · /Users/…/claude · Version 2.1.299“.

### Prüfanfrage

`cloud_check` schickt wie in 0009 eine Anfrage ohne Schülerdaten durch denselben Weg (beim Reviewer mit Schema, bei der Erkennung mit einem kleinen erzeugten Bild). Ist die CLI nicht angemeldet, schlägt sie mit `notLoggedIn` fehl, der Schritt wird wieder ausgeschaltet, und das Formular zeigt „Die CLI ist nicht angemeldet.“ mit „Im Terminal anmelden: `claude auth login`, danach erneut „Verwenden“.“ Fehlt das Programm, nennt das Formular den Installationsbefehl aus der Vorlage.

### Fehlerklassen

Neu sind fünf Klassen, die übrigen kommen aus 0009:

| Klasse           | Wann                                                                                                      | Satz in der Oberfläche                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `cliMissing`     | Pfad fehlt, ist nicht ausführbar, heißt anders oder liefert keine passende Version, Start schlägt fehl    | „Das Programm fehlt oder ist nicht die erwartete CLI.“ |
| `cliOutdated`    | Keine Ergebniszeile, stderr meldet „unknown option“ (ältere CLI ohne `--safe-mode`)                       | „Die CLI ist zu alt. Bitte aktualisieren.“             |
| `cliFailed`      | Andere Fehler ohne erkennbare Ursache                                                                     | „Die CLI hat mit einem Fehler aufgehört.“              |
| `notLoggedIn`    | `api_error_status` 401 oder 403, oder das Ergebnis meldet „Not logged in“, „/login“, ungültigen Schlüssel | „Die CLI ist nicht angemeldet.“                        |
| `quotaExhausted` | Das Ergebnis meldet ein erschöpftes Kontingent („usage limit“, „limit reached“, „hit your limit“ …)       | „Das Kontingent des Abos ist aufgebraucht.“            |

Weiter gelten `rateLimited` (429 ohne Kontingent-Text), `notFound` (404 oder unbekanntes Modell), `tooLarge` (413), `badRequest` (übrige 4xx), `server` (5xx), `timeout` (Zeitlimit) und `invalidResponse` (keine lesbare Ergebniszeile bei Exit-Code 0, zu große Ausgabe). `cliMissing`, `cliOutdated`, `notLoggedIn` und `quotaExhausted` zählen wie `auth` als „nicht verfügbar“, ein Lauf versucht es dann nicht Seite für Seite weiter.

Die Texte der CLI werden nur zum Einordnen gelesen, nie angezeigt und nie protokolliert. Das Protokoll schreibt wie in 0009 eine Zeile `cloud_request` mit Vorlage, Schritt, Dauer, Versuchen, Bytes über stdin und Fehlerklasse, ohne Pfad und ohne Text.

### Adapter-Schnittstelle

```rust
pub trait Adapter: Sync {
    fn binary_names(&self) -> &'static [&'static str];        // erlaubte Dateinamen
    fn search_dirs(&self, home: &Path) -> Vec<PathBuf>;       // eigene Installationsorte
    fn version(&self, stdout: &str) -> Option<String>;        // `--version` prüfen
    fn invocation(&self, prompt: &Prompt) -> Invocation;      // Argumente, stdin, Zusatz-Umgebung
    fn answer(&self, output: &RunOutput) -> Result<Answer, ErrorClass>; // Antwort lesen, Fehler einordnen
}
```

`Prompt` ist anbieterneutral (Modell, Anweisungen, Nachrichten mit Text- und Bildteilen, Schema). Prozessstart, Umgebung, Arbeitsordner, Zeitlimit, Abbruch, Grenzen, Suche und die Sperren liegen außerhalb des Adapters. Für Codex kommen ein Modul `codex.rs`, ein Eintrag in `cli::adapter` und die Modelle in der Vorlage dazu, danach entfällt `hidden`.

## Folgen

- Lehrkräfte mit Claude-Abo können große Modelle ohne API-Schlüssel nutzen. Rotstift sieht weder Schlüssel noch Token, die Anmeldung liegt ganz bei der CLI.
- Privat-Abos haben in der Regel keinen Vertrag zur Auftragsverarbeitung, und das Training hängt an der Kontoeinstellung. Der Schutz bleibt deshalb standardmäßig an, und der Hinweis beim Ausschalten sagt das ausdrücklich.
- Rotstift startet ein fremdes Programm. Die Argumente schalten Werkzeuge, Einstellungen, Hooks, CLAUDE.md, Speicher und MCP ab (Beleg im PR: Gegenprobe ohne Argumente zitiert die eigene CLAUDE.md und löst Projekt-Hooks aus, mit den Argumenten nicht). Verwaltete Einstellungen eines Administrators (`managed-settings`) gelten weiter, das ist gewollt.
- Die CLI öffnet trotz allem eigene Verbindungen zum Anbieter (Anmeldung, Token-Erneuerung) und einen lokalen Socket für Nachrichten zwischen Sitzungen. Rotstift kann das nicht abschalten, mit `--tools ""` und einem Zug kann darüber aber nichts ausgeführt werden.
- Flags und Ausgabeformat gehören Anthropic und können sich ändern. Eine ältere CLI ohne `--safe-mode` meldet `cliOutdated`. Die Fehlertexte für Anmeldung und Kontingent sind nicht dokumentiert und nach Mustern eingeordnet, ein unbekannter Text wird zu `cliFailed`.
- Jeder Aufruf startet die CLI neu (gemessen etwa 1 s Grundlast). Gemessen im Rauchtest auf einem Mac mit Apple Silicon: Textschritt mit `haiku` 1,4–1,6 s, mit `sonnet` 5,8 s; Prüfanfrage mit Schema 1,1–2,8 s; Erkennung einer gedruckten Seite (950 × 180 px) 1,0–1,4 s.
- Das Kontingent des Abos ist begrenzt. Viele Arbeiten mit Inhalt und Form (5–12 Anfragen je Arbeit) können es erschöpfen, dann meldet der Lauf `quotaExhausted`.
- Unter Linux beendet ein Absturz von Rotstift eine laufende CLI nicht, sie endet nach ihrer einen Antwort von selbst.

## Tests

- Rust mit nachgebauten CLIs (Shell-Skripte, zur Testzeit im Temp-Ordner): Argumente exakt, Prompt nur über stdin, Umgebung ohne Schlüssel und ohne äußere Sitzung, frischer Arbeitsordner wird gelöscht, Erfolg, nicht angemeldet, Kontingent, Rate-Limit, unbekanntes Modell, kaputtes JSON, veraltete CLI, Hänger mit Kindprozess (Zeitlimit und Abbruch beenden beide), zu große Ausgabe, eine Anfrage nach der anderen.
- Rust: Ohne Freigabe, nach dem Ausschalten und mit Schutz läuft die CLI nie (Zähler bleibt leer). Nur Aliase aus der Vorlage, kein Schlüssel, nur passende Programme. Die ausgeblendete Codex-Vorlage lässt sich nicht wählen. Die Suche findet `PATH` und `~/.claude/local` und speichert den aufgelösten Ordner.
- Frontend: Kein Schlüsselfeld, gefundenes Programm mit Version, Auswahl der Aliase ohne Vorauswahl, Installationsbefehl und Dateiwahl, Anmeldehinweis bei `notLoggedIn`, Zusatzsatz im Hinweis zum Ausschalten, Codex ausgeblendet, Cloud-Zeichen „über Claude-Abo, pseudonymisiert“.
- E2E mit nachgebildetem Backend: Wahl des Claude-Abos bis zum Cloud-Zeichen, Dateiwahl und Anmeldehinweis.
- Rauchtest gegen die echte CLI nur mit `ROTSTIFT_CLI_SMOKE=1` (`ROTSTIFT_CLI_PATH`, `ROTSTIFT_CLI_MODEL` optional): ein Textschritt mit selbst geschriebenem Text, die Prüfanfrage mit Schema und eine Erkennung mit einer zur Laufzeit gerenderten Druckseite.

## Doku

README: Abschnitt „Abo über Claude Code nutzen“ mit Installations- und Anmeldebefehl. Neuer Prozessstart (CLI und einmal die Login-Shell), kein neuer Netzwerkweg aus Rotstift selbst, die CSP in `tauri.conf.json` bleibt unverändert. Neue Abhängigkeiten: das Tokio-Feature `process` und `libc` jetzt für alle Unix-Systeme (Prozessgruppe).
