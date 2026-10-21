# 0002: Korrekturschema

- Status: Angenommen
- Datum: 2026-10-19

## Kontext

Die Pipeline (siehe [0001](0001-tech-stack.md)) lässt ein Vision-Modell die Handschrift als HTML transkribieren und ein Text-Modell darin Fehler markieren. Beide Modelle sind klein und liefern gelegentlich kaputte Ausgaben. Das Format muss daher für ein kleines Modell leicht zu schreiben sein, eindeutig geparst werden und bei Abweichungen verständliche Meldungen liefern, mit denen die Anfrage wiederholt werden kann.

Außerhalb des Umfangs: Die Schwere eines Fehlers wird bewusst nicht standardisiert. Es gibt kein Feld dafür.

## Entscheidung

### Fehlerarten

Eine Fehlerart hat ein Kürzel, einen deutschen Namen, eine Kurzbeschreibung und ein Beispiel. Die Kataloge liegen je Sprache in `src/annotations/languages/`. Es gibt keinen bundesweit verbindlichen Satz an Korrekturzeichen. Der Katalog nutzt die verbreitetsten Zeichen.

| Sprache     | Kürzel                                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deutsch     | R, Z, G, A, Sb, T, Bz, W (Rechtschreibung, Zeichensetzung, Grammatik, Ausdruck, Satzbau, Tempus, Bezug, Wiederholung)                               |
| Englisch    | sp, gr, t, wo, p, voc, ww, art                                                                                                                      |
| Französisch | R, Z, G, W, Sb, T, M, Präp (Rechtschreibung, Zeichensetzung, Grammatik, Wortschatz, Satzbau, Tempus, Modus, Präposition), Beispiele auf Französisch |
| Spanisch    | R, Z, G, W, Sb, T, M, Präp (wie Französisch), Beispiele auf Spanisch                                                                                |

Kürzel sind je Sprache eindeutig, auch ohne Beachtung der Groß- und Kleinschreibung. Beim Parsen wird die Schreibweise des Modells auf das Kürzel des Katalogs normalisiert (`sb` wird zu `Sb`).

Eine Sprache ergänzen: Datei `languages/<code>.ts` anlegen, in `catalog.ts` in `LANGUAGE_CODES` und `CATALOG` eintragen, in `src/correction/kinds.ts` die Kürzel für Rechtschreibung, Zeichensetzung, Grammatik, Wortschatz und Satzbau festlegen und in `src/correction/classify.ts` die Wortbildung der Sprache (Endungen, Formenreihen wie Artikel, Pronomen, Hilfsverben) beschreiben. Dann das Profil in `profile.ts` in `BUILT_IN_PROFILES` aufnehmen; die Auswahl in der Oberfläche liest nur diese Liste. Die Tests prüfen Eindeutigkeit und Beispiele automatisch.

#### Französisch und Spanisch

Auch für Fremdsprachen gibt es keinen bundesweit verbindlichen Satz. Grundlage sind die Korrekturzeichen, die Länder für Abiturklausuren festlegen: Nordrhein-Westfalen für [Französisch](https://www.standardsicherung.schulministerium.nrw.de/system/files/media/document/file/korrekturzeichen_franzoesisch.pdf) und [Spanisch](https://www.standardsicherung.schulministerium.nrw.de/system/files/media/document/file/korrekturzeichen_spanisch.pdf) (W, G, R, Z, ausdifferenziert in unter anderem Präp, Mod bzw. M, T, Sb, A), Brandenburg für [Französisch](https://bravors.brandenburg.de/sixcms/media.php/66/Anlage%205%20Franz%C3%B6sisch%20Abitur%202021_08102020.pdf) (G, V, WW, M, T, S, R, Z, A) und Berlin-Brandenburg für [Spanisch](https://bildungsserver.berlin-brandenburg.de/fileadmin/bbb/unterricht/faecher/sprachen/spanisch/pdf/Korrekturzeichen.pdf) (dieselbe Tabelle). Beide Sprachen teilen sich einen Katalog aus dem gemeinsamen Kern dieser Vorgaben, mit sprachspezifischen Beispielen und Beschreibungen:

- **R, Z, G, W:** Die Hauptzeichen aller drei Quellen. In R fallen Akzente, Cédille und Tilde: Ein fehlender oder falscher Akzent ist ein Rechtschreibfehler (NRW, Brandenburg), außer er ändert die Bedeutung. Z umfasst im Spanischen fehlendes `¿` und `¡`.
- **Sb, T, M, Präp:** Die häufigsten Unterzeichen (Satzbau, Tempus, Modus, Präposition). Modus (subjonctif, subjuntivo) steht in beiden Ländervorgaben, bei Anfängern ein verbreiteter Fehler.
- **Nicht aufgenommen:** Die feinste Stufe der NRW-Tabelle (Genus, Akkord, Determinant, Pronomen, Konjunktion), der Auslassungsfehler V und die Zeichen für Inhalt und Stil. Das Verfahren (Abschnitt „Datenmodell“ und [Evaluation](../evaluations/2026-10-profile.md)) kann Wort- und Ausdrucksfehler (W und A) nicht trennen, deshalb gibt es nur W und kein A. Auslassungen sind bereits eine eigene Art von Markierung (`rs-missing`).
- **Was automatisch gesetzt wird:** `deriveMarks` kennt aus dem Wortvergleich R, Z, G, W und Sb. T, M und Präp sind im Katalog, werden aber nicht abgeleitet (wie T, Bz und W im Deutschen). Ein falsches Tempus oder ein falscher Modus kommt als G oder R an, eine falsche Präposition als G.

#### Sachfach

Das Profil „Sachfach“ (`sachfach`) ist Deutsch mit nur R, Z und G, für Fächer, in denen nur die sprachliche Richtigkeit korrigiert wird (Geschichte, Biologie, Erdkunde und andere). Es hat keinen eigenen Katalog und keine eigene Sprache, es nimmt die deutschen Zeichen und lässt A, Sb, T, Bz und W weg. Der Name ist kurz und eindeutig und passt zu jedem Fach, in dem Deutsch nur die Unterrichtssprache ist. Marken anderer Arten gibt es dort nicht: `deriveMarks` verwirft sie, weil das Profil sie nicht erlaubt.

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
- `<rs-struck>Text</rs-struck>`: Durchgestrichener Text der Zeile, ohne Attribute und ohne verschachtelte Elemente. Er bleibt im Transkript, wird aber nicht gezählt und nicht korrigiert. Markierungen dürfen nicht in gestrichenem Text liegen, eine Auslassung darf an seinem Rand stehen.
- Die Zeilen stehen auf oberster Ebene. Text außerhalb von Zeilen, andere Elemente und verschachtelte oder überlappende Markierungen sind ungültig. Whitespace wird zu einem Leerzeichen zusammengezogen, ein umgebendes Markdown-Codeblock-Fence wird toleriert. Unbekannte Attribute (z. B. `correction` statt `fix`) werden gemeldet.

### Datenmodell und Prüfung

`src/annotations/transcript.ts` definiert das Modell mit Zod: `Transcript` besteht aus `lines`, jede Zeile hat `number`, `bbox?`, `text` (Originaltext ohne Markup), `marks` und `struck?`. `struck` listet gestrichene Stellen als `offset` und `text` in `text`, sortiert und ohne Überlappung. Eine `Mark` hat `kind` (`error` oder `omission`), `type`, `original`, `correction` und `offset` (Zeichenposition in `text`). `listErrors` liefert alle Markierungen mit Zeilennummer. Das Schema prüft zusätzlich, dass Markierungen zum Text passen, sortiert sind, sich nicht überlappen und dass Korrektur und Original sich unterscheiden.

`parseTranscript(html, { profile, source? })` prüft zuerst die rohen Tags auf Balance, weil der HTML-Parser nicht geschlossene oder zeilenübergreifende Markierungen still repariert. Jedes `<rs-error>` muss in derselben `<rs-line>` schließen. Danach liest der `DOMParser` der WebView das HTML, Zod prüft die Attribute, und alle Probleme landen in einem Durchgang als `ParseIssue` (deutsche Meldung, Zeilennummer). Modelltext in Meldungen wird auf 60 Zeichen gekürzt, die Liste nach 20 Einträgen mit „… und N weitere Meldungen“ abgeschlossen, damit die Wiederholungsanfrage klein bleibt. Mit `source` (der Transkription) wird zusätzlich geprüft, dass das Text-Modell den Text je Zeile nicht verändert hat und keine Zeile fehlt oder hinzukommt; `bbox` wird dann aus der Quelle übernommen. `applySource` übernimmt auch `struck` aus der Quelle. `formatIssues` formatiert sie für die erneute Anfrage. `serializeTranscript` schreibt das Modell zurück nach HTML; Parser und Serializer sind zueinander invers.

### Durchgestrichenes

Im gespeicherten Erkennungstext (`PageEntry.text`, eine Zeile je Zeile) steht gestrichener Text als `~~Wort~~`. So überlebt die Information das Speichern und Bearbeiten ohne neues Feld, und die Lehrkraft kann im Texteditor selbst Wörter als gestrichen markieren oder die Markierung entfernen. `readStruck` (`src/annotations/struck.ts`) macht daraus `text` und `struck`, `markStruck` setzt die Markierung für erkannte Wörter. Das Korrekturmodell bekommt nur den sichtbaren Text (`visibleLine`), seine Markierungen werden auf den vollen Text zurückgerechnet. Erkannt wird Durchgestrichenes nicht vom Erkennungsmodell, sondern aus der Tinte (`src/layout/strike.ts`, [Evaluation](../evaluations/2026-10-durchgestrichen.md)).

### Profile

Ein `CorrectionProfile` hat `id`, `name`, `subject`, `language` und `allowedTypes`. Fach und Sprache bestimmen die erlaubten Fehlerarten. Das Profil ist beim Parsen Pflicht. Der Parser lehnt unbekannte Typen und im Profil nicht erlaubte Typen ab und nennt die erlaubten; Kürzel werden ohne Beachtung der Groß- und Kleinschreibung normalisiert. `buildSpecification(profile)` erzeugt den Spezifikationstext für den Modell-Prompt aus Profil und Katalog, mit Formatregeln und je erlaubter Fehlerart einem Beispiel, das aus dem Datenmodell gerendert wird.

### Statistik

`computeStatistics` (`src/stats/`) liefert Wörter (`countWords` über den Originaltext ohne gestrichenen Text), Fehler gesamt, Fehler je Art und Fehler pro 100 Wörter. Auslassungen zählen als Fehler, nicht als Wörter. Am Zeilenende getrennte Wörter („Rut-“ / „sche“) zählen einfach; ein Bindestrich nach einem Buchstaben mit Kleinbuchstabe am Anfang der nächsten Zeile gilt als Silbentrennung.

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
