# 0002: Korrekturschema

- Status: Angenommen
- Datum: 2026-10-19

## Kontext

Die Pipeline (siehe [0001](0001-tech-stack.md)) lässt ein Vision-Modell die Handschrift als HTML transkribieren und ein Text-Modell darin Fehler markieren. Beide Modelle sind klein und liefern gelegentlich kaputte Ausgaben. Das Format muss daher für ein kleines Modell leicht zu schreiben sein, eindeutig geparst werden und bei Abweichungen verständliche Meldungen liefern, mit denen die Anfrage wiederholt werden kann.

Außerhalb des Umfangs: Die Schwere eines Fehlers wird bewusst nicht standardisiert. Es gibt kein Feld dafür.

## Entscheidung

### Fehlerarten

Eine Fehlerart hat ein Kürzel, einen deutschen Namen, eine Kurzbeschreibung und ein Beispiel. Die Kataloge liegen je Sprache in `src/annotations/languages/`. Es gibt keinen bundesweit verbindlichen Satz an Korrekturzeichen. Der Katalog nutzt die verbreitetsten Zeichen.

| Sprache  | Kürzel                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| Deutsch  | R, Z, G, A, Sb, T, Bz, W (Rechtschreibung, Zeichensetzung, Grammatik, Ausdruck, Satzbau, Tempus, Bezug, Wiederholung) |
| Englisch | sp, gr, t, wo, p, voc, ww, art                                                                                        |

Kürzel sind je Sprache eindeutig, auch ohne Beachtung der Groß- und Kleinschreibung. Beim Parsen wird die Schreibweise des Modells auf das Kürzel des Katalogs normalisiert (`sb` wird zu `Sb`).

Eine Sprache ergänzen: Datei `languages/<code>.ts` anlegen, in `catalog.ts` in `LANGUAGE_CODES` und `CATALOG` eintragen. Die Tests prüfen Eindeutigkeit und Beispiele automatisch.

### HTML-Format

Eigene Tags mit Bindestrich, damit sie nie mit echtem HTML kollidieren und der Browser-Parser sie als Inline-Elemente behandelt.

```html
<rs-line n="2" bbox="40,104,720,34"
  >Wir sind früh losgefahren<rs-missing type="Z" fix=","></rs-missing> weil mein Bruder die
  <rs-error type="R" fix="Rutsche">Rutche</rs-error> ausprobieren wollte.</rs-line
>
```

- `<rs-line n="…" bbox="x,y,breite,höhe">`: Eine Zeile des Originals. `n` (Pflicht) ist die Zeilennummer, aufsteigend, Lücken sind erlaubt. `bbox` (optional) ist die Bounding Box in Seitenkoordinaten, also Pixel des gerenderten Seitenbildes mit Ursprung oben links. Breite und Höhe sind positiv, x und y nicht negativ.
- `<rs-error type="…" fix="…">Originaltext</rs-error>`: Fehler im vorhandenen Text. `type` ist das Kürzel, `fix` die Korrektur für genau den markierten Text (Pflicht, darf leer sein, wenn der Text zu streichen ist).
- `<rs-missing type="…" fix="…"></rs-missing>`: Auslassung, z. B. ein fehlendes Komma. Das Element steht an der Stelle, an der etwas fehlt, hat keinen Inhalt, und `fix` ist der fehlende Text (Pflicht, nicht leer). Das schließende Tag ist nötig, da HTML keine selbstschließenden Tags kennt.
- Die Zeilen stehen auf oberster Ebene. Text außerhalb von Zeilen, andere Elemente und verschachtelte oder überlappende Markierungen sind ungültig. Whitespace wird zu einem Leerzeichen zusammengezogen, ein umgebendes Markdown-Codeblock-Fence wird toleriert. Unbekannte Attribute (z. B. `correction` statt `fix`) werden gemeldet.

### Datenmodell und Prüfung

`src/annotations/transcript.ts` definiert das Modell mit Zod: `Transcript` besteht aus `lines`, jede Zeile hat `number`, `bbox?`, `text` (Originaltext ohne Markup) und `marks`. Eine `Mark` hat `kind` (`error` oder `omission`), `type`, `original`, `correction` und `offset` (Zeichenposition in `text`). `listErrors` liefert alle Markierungen mit Zeilennummer. Das Schema prüft zusätzlich, dass Markierungen zum Text passen, sortiert sind, sich nicht überlappen und dass Korrektur und Original sich unterscheiden.

`parseTranscript(html, { profile, source? })` prüft zuerst die rohen Tags auf Balance, weil der HTML-Parser nicht geschlossene oder zeilenübergreifende Markierungen still repariert. Jedes `<rs-error>` muss in derselben `<rs-line>` schließen. Danach liest der `DOMParser` der WebView das HTML, Zod prüft die Attribute, und alle Probleme landen in einem Durchgang als `ParseIssue` (deutsche Meldung, Zeilennummer). Modelltext in Meldungen wird auf 60 Zeichen gekürzt, die Liste nach 20 Einträgen mit „… und N weitere Meldungen“ abgeschlossen, damit die Wiederholungsanfrage klein bleibt. Mit `source` (der Transkription) wird zusätzlich geprüft, dass das Text-Modell den Text je Zeile nicht verändert hat und keine Zeile fehlt oder hinzukommt; `bbox` wird dann aus der Quelle übernommen. `formatIssues` formatiert sie für die erneute Anfrage. `serializeTranscript` schreibt das Modell zurück nach HTML; Parser und Serializer sind zueinander invers.

### Profile

Ein `CorrectionProfile` hat `id`, `name`, `subject`, `language` und `allowedTypes`. Fach und Sprache bestimmen die erlaubten Fehlerarten. Das Profil ist beim Parsen Pflicht. Der Parser lehnt unbekannte Typen und im Profil nicht erlaubte Typen ab und nennt die erlaubten; Kürzel werden ohne Beachtung der Groß- und Kleinschreibung normalisiert. `buildSpecification(profile)` erzeugt den Spezifikationstext für den Modell-Prompt aus Profil und Katalog, mit Formatregeln und je erlaubter Fehlerart einem Beispiel, das aus dem Datenmodell gerendert wird.

### Statistik

`computeStatistics` (`src/stats/`) liefert Wörter (`countWords` über den Originaltext), Fehler gesamt, Fehler je Art und Fehler pro 100 Wörter. Auslassungen zählen als Fehler, nicht als Wörter. Am Zeilenende getrennte Wörter („Rut-“ / „sche“) zählen einfach; ein Bindestrich nach einem Buchstaben mit Kleinbuchstabe am Anfang der nächsten Zeile gilt als Silbentrennung.

## Begründung

- Eigene Tags statt `<span class="…">`: Kürzer für das Modell und beim Parsen eindeutig. Das Originalwort bleibt als Inhalt erhalten.
- Auslassung als leeres Element: Die Position ist exakt, und das Overlay kann ein Einfügezeichen zwischen die Wörter setzen.
- Alle Probleme auf einmal melden: Eine einzige Wiederholungsanfrage kann dem Modell alle Fehler nennen.
- Fehler nur melden statt zu raten (z. B. `<rs-missing/>`, das HTML als offenes Tag liest und den Folgetext verschluckt): Kleine Modelle sollen eine klare Anweisung bekommen, nicht still falsche Daten.
- Zod ist bereits im Tech-Stack vorgesehen und prüft Parser-Ausgabe, Profile und später gespeicherte Daten mit demselben Schema.

## Folgen

- Für das Parsen braucht der Code eine DOM-Umgebung (WebView, in Tests `happy-dom`).
- Die Pipeline muss `n` und `bbox` aus der Transkription an das Text-Modell durchreichen. Fehlt `bbox` in dessen Ausgabe, kann sie über `n` aus der Transkription ergänzt werden.
- Die Schwere von Fehlern kann später als zusätzliches Attribut ergänzt werden, ohne das Format zu brechen.
