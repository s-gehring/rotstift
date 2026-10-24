# 0011: Personenbezug vor dem Senden entfernen

- Status: Angenommen
- Datum: 2026-10-23

## Kontext

[0009](0009-cloud-modelle.md) lässt jeden Schritt wahlweise ein entferntes Modell nutzen: Erkennung (`transcriber`), Rechtschreibung und Grammatik (`corrector`) sowie Inhalt und Form (`reviewer`). Was dann den Rechner verlässt, sind Seitenbilder und Texte aus Schülerarbeiten, also Handschrift, Namen, Adressen und Schulen, und zwar unverändert. Der Hinweis aus 0009 benennt das nur allgemein, und die Lehrkraft muss ihm vertrauen.

Das reicht nicht. Nach EuGH C-434/16 (Nowak) sind schon die Antworten einer Prüfung personenbezogene Daten, auch ohne Namen. Wer Arbeiten an einen Anbieter schickt, überträgt personenbezogene Daten. Rotstift kann das nicht verhindern, aber es kann die Menge verkleinern: Kennungen, die eine Person erst bestimmbar machen, ersetzt die App lokal durch Platzhalter, bevor Text an einen Cloud-Anbieter geht, und setzt die Originale nach der Antwort wieder ein.

Dieses ADR legt fest, was ersetzt wird, wann der Schutz gilt, wie er sich abschalten lässt und was Rust unabhängig von der Oberfläche durchsetzt. Für Abos über eine CLI gilt es unverändert, der Hinweis zum Ausschalten bekommt dort einen Satz zu Auftragsverarbeitung und Training ([0012](0012-cli-abos.md)). Das Kernmodul (`src/privacy/`), die Messung der Erkennung (`eval/`) sowie die Verdrahtung im Ablauf mit der Prüfansicht (`src/review/review-flow.ts`, `src/privacy-review/`) entstehen getrennt.

## Entscheidung

### Begriffe

- **Schutz**: Die Einstellung „Personenbezug vor dem Senden entfernen“. Sie gehört zur Wahl eines Schritts (also zu Anbieter und Schritt), nicht zur App.
- **Schwärzen**: Kennungen durch Platzhalter wie „[Person 1]“ ersetzen, konsistent innerhalb einer Arbeit. Dieselbe Person bekommt immer denselben Platzhalter.
- **Zurücksetzen**: Nach der Antwort setzt die App die Originale lokal wieder an die Platzhalter.
- **pseudonymisiert**: Der Zustand des Textes nach dem Schwärzen. Das Wort „anonym“ und die Formulierung „DSGVO-konform“ kommen in der Oberfläche, in Hinweisen und in der Doku nicht vor (Entscheidung 6).

### Entscheidungen

1. **Handschrift ist personenbezogen.** Mit Schutz läuft die Erkennung zwingend lokal, es gehen keine Bilder an die Cloud. Nur der lokal erkannte Text verlässt den Rechner, und das nur pseudonymisiert.
2. **Ersetzt werden Kennungen** durch Platzhalter, konsistent innerhalb einer Arbeit: Namen von Privatpersonen, Adressen und Wohnorte, Schulen, Vereine und Einrichtungen, Kontaktdaten, Datumsangaben mit Personenbezug, Nummern und Konten. Nach der Antwort setzt die App die Originale lokal wieder ein.
   - Es bleiben stehen: Namen aus der Aufgabenstellung, Prominente, Figuren aus Werken sowie Länder und Reiseziele ohne Wohnbezug.
   - Im Zweifel wird ersetzt.
3. **Sensible Angaben** (Gesundheit, Herkunft, Religion, politische Meinung, Sexualleben, Gewerkschaft, private Lebensumstände) werden erkannt und als Warnung gezeigt, aber **nicht** ersetzt. Ein Platzhalter änderte den Inhalt der Antwort, und die Korrektur soll den Text so sehen, wie er geschrieben ist. Die Lehrkraft entscheidet in der Prüfansicht, ob sie die Stelle schwärzt.
4. **Prüfansicht vor dem Senden.** Erkennung und Schwärzen laufen lokal für alle Arbeiten. Danach bestätigt die Lehrkraft je Arbeit den geschwärzten Text und kann Stellen ergänzen oder entfernen. Erst dann wird gesendet.
5. **Der Schutz ist standardmäßig an und je Anbieter abschaltbar**, nach einem eigenen Hinweis. Für „Eigener Server“ und Loopback ist er standardmäßig aus. Ist er aus, geht auch die Cloud-Erkennung wieder, wie nach 0009 (für Schulen mit Vertrag zur Auftragsverarbeitung).
6. **Wortwahl.** Der Text ist nach dem Schwärzen pseudonymisiert, nicht anonym: Nach C-434/16 sind schon die Prüfungsantworten personenbezogen, und die Detektoren sind nicht vollständig. Die Verantwortung bleibt bei der Lehrkraft.
7. **Die Erkennung läuft in drei Schichten:** Regeln, Namenslisten mit Wörterbuch und ein lokales Modell (siehe „Erkennung“).

### Ablauf

Mit Schutz gilt für einen Lauf, in dem mindestens ein Textschritt in der Cloud mit Schutz läuft (`useCloud().protects(role)`):

1. **Lokal erkennen.** Alle Arbeiten werden mit dem lokalen Erkennungsmodell gelesen, samt zweiter Lesung. Danach sucht die App die Zeilen auf den Seiten, ebenfalls lokal. Läuft die Korrektur lokal, korrigiert sie hier schon alle Seiten wie bisher.
2. **Personenbezug erkennen.** Je Arbeit laufen die Detektoren einmal über die sichtbaren Zeilen aller Seiten hintereinander, danach gibt `propagateSpans` jede gefundene Kennung an alle Vorkommen der Arbeit weiter. Kontext sind der Name der Arbeit, Fach, Sprache und, wenn Inhalt und Form geprüft werden, die Aufgabenstellung. Schlägt die Erkennung einer Arbeit fehl, sendet sie nichts, und ihre Seiten zeigen den Fehler.
3. **Prüfansicht.** Sie öffnet sich, sobald die Erkennung beginnt, und zeigt die Arbeiten, sobald sie erkannt sind. Die Lehrkraft prüft je Arbeit, ergänzt oder entfernt Stellen und gibt frei. Es gibt keine Sammelfreigabe, die eine ungesehene Arbeit freigäbe.
4. **Textschritte entfernt.** Jede freigegebene Arbeit geht sofort hinaus, während die Lehrkraft die übrigen prüft. Umhüllt wird nur der Cloud-Schritt mit Schutz: `withPseudonymization(corrector, bestätigte Stellen)` über einem Client mit `pseudonymized: true`. Die Hülle bekommt genau die sichtbaren Zeilen, die auch `correctPage` und `workLines` benutzen, und lehnt andere Zeilen ab, ohne zu senden. Ein lokaler Schritt läuft unverändert.
5. **Zurücksetzen und Zeichnen.** Die Hülle setzt die Originale in die Antwort ein, die App ordnet die Anmerkungen dem Originaltext zu und zeichnet sie wie bisher.

Läuft kein Textschritt mit Schutz in der Cloud, läuft der Lauf wie vor diesem ADR: Ohne Cloud-Textschritt gibt es nichts zu schwärzen, ohne Schutz gehen die Texte nach 0009 ungeschwärzt hinaus.

**Abbrechen** beendet die Erkennung und das Warten auf die Lehrkraft. Danach sendet keine Arbeit mehr etwas, auch keine, die gerade freigegeben wird. **Schutz ausschalten** während eines Laufs ändert diesen Lauf nicht: Die App merkt sich beim Start, welche Schritte geschützt sind, und eine noch nicht freigegebene Arbeit wartet weiter auf ihre Freigabe und geht danach pseudonymisiert hinaus. Wer den Schutz während eines ungeschützten Laufs einschaltet, bekommt für die restlichen Seiten den Fehler `notPseudonymized`, es geht nichts ungeschwärzt hinaus.

**Fortschritt und Restdauer.** Während der Erkennung steht „Personenbezug wird erkannt …“, die Restdauer rechnet dafür einen eigenen Schritt je Arbeit (siehe „Erkennung“), während des Wartens „Wartet auf Freigabe (2 Arbeiten)“, mit der Rechenzeit danach, falls sie über einer Minute liegt. Die Wartezeit zählt nicht als Rechenzeit: Die Restdauer lernt in dieser Zeit nichts, und der Balken steht still.

**Zustand.** Erkannte, ergänzte und entfernte Stellen gelten nur für einen Lauf und liegen im Arbeitsspeicher. Am Ende des Laufs, nach Abbrechen und nach einem Neustart der App sind sie weg. Ein erneuter Lauf derselben Arbeit erkennt neu, und die Lehrkraft gibt wieder frei. Seiten oder Arbeiten, die während der Prüfung wegfallen, verlieren ihre Stellen. Begründung: Die Ergebnisse speichert die App bisher nicht über einen Neustart hinaus, und die Antworten tragen nach dem Zurücksetzen die Originale. Gespeicherte Stellen wären eine Liste der Namen und Kennungen je Arbeit auf der Platte, ohne dass ein späterer Lauf sie bräuchte.

**Schichten.** Die Detektoren ohne Modell stehen als Liste in `src/privacy-review/detect.ts` (`DETECTORS`), Wörterbuch und Modell kommen in der App über `src/privacy-review/local-detectors.ts` dazu. Jeder ist ein `Detector`, ihre Stellen laufen gemeinsam durch `propagateSpans`.

### Was gesendet wird und was nicht

| Schritt                       | Mit Schutz                                                                         | Ohne Schutz                               |
| ----------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| Erkennung                     | Nichts. Die Erkennung läuft lokal.                                                 | Seitenbilder mit Handschrift, wie in 0009 |
| Rechtschreibung und Grammatik | Bestätigter, geschwärzter Text mit Zeilennummern, Fach, Sprache, Aufgabenstellung  | Erkannter Text unverändert, wie in 0009   |
| Inhalt und Form               | Bestätigter, geschwärzter Text mit Zeilennummern, Fach, Textform, Aufgabenstellung | Erkannter Text unverändert, wie in 0009   |

Die Aufgabenstellung geht unverändert mit, weil Namen daraus stehen bleiben (Entscheidung 2). Nie gesendet werden die Zuordnung von Platzhalter zu Original, Dateinamen, Klassen- oder Schülerlisten, die Namensliste aus dem Namen der Arbeit, Statistiken, Gewichtungen, Exporte und Bilder bei den Textschritten. Die Zuordnung bleibt im Arbeitsspeicher der App und wird nicht gespeichert.

### Schalter und Speicherung

Der Schalter liegt je Wahl in `cloud.json`, neben der Freigabe aus 0009:

```json
{
  "template": "mistral",
  "baseUrl": "https://api.mistral.ai/v1",
  "model": "mistral-small-latest",
  "consent": { "host": "api.mistral.ai", "version": 1, "atMs": 0 },
  "protection": false,
  "protectionConsent": { "host": "api.mistral.ai", "version": 1, "atMs": 0 }
}
```

Er gilt je Anbieter und Schritt, wie die Freigabe. Das passt zur Wahl: Ein Schritt kann über Mistral laufen und geschützt sein, ein anderer über den Server der Schule und ungeschützt. Die Oberfläche legt für einen Anbieter nichts Gemeinsames an, jede Wahl trägt ihren Wert.

Der wirksame Wert (`protected`) ergibt sich in Rust so:

| `protection` | Wirkt als                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| fehlt        | Standard: an, außer bei „Eigener Server“ und Loopback                                                                |
| `true`       | an                                                                                                                   |
| `false`      | aus, wenn der Standard aus ist, sonst nur mit gültiger `protectionConsent` (Host und Version passen), andernfalls an |

„Eigener Server“ ist die Vorlage `server`. Loopback sind `localhost`, 127.0.0.0/8 und `::1`, auch bei der Vorlage „Anderer Anbieter“. Eine beschädigte, veraltete oder auf einen anderen Host lautende Freigabe führt also immer zu „an“, nie zu „aus“.

### Sperren in Rust

Rust prüft in `cloud_chat` nach Wahl und Freigabe, vor jedem Netzwerkzugriff, unabhängig von der Oberfläche:

1. **Erkennung bei Schutz an:** `protectionActive`. Egal, was die Anfrage enthält.
2. **Textschritt bei Schutz an ohne Flag:** `notPseudonymized`. Die Anfrage trägt `pseudonymized: true`, nur wenn die Hülle um den Corrector sie gebaut hat. Das ist eine Sicherung gegen Codepfade, die das Schwärzen vergessen: Sie fallen auf, statt ungeschwärzt zu senden. Das Flag belegt nicht, dass geschwärzt wurde, es belegt nur, dass der Aufrufer den Schutz kennt. Ein Detektor, der Kennungen übersieht, wird dadurch nicht besser (siehe „Folgen und Grenzen“).
3. **Wahl anlegen** (`cloud_use`): Eine Erkennung mit Schutz an wird abgewiesen (`protectionActive`). Wer den Schutz ausschaltet, braucht die eigene Freigabe, sonst `protectionConsentMissing`.
4. **Schalter ändern** (`cloud_set_protection`): Ausschalten braucht die Freigabe (`protectionConsentMissing`), Einschalten nie. Das Einschalten löscht die Freigabe, ein erneutes Ausschalten fragt wieder.
5. **Prüfanfrage** (`cloud_check`): Sie enthält keine Schülerdaten und läuft wie ein Textschritt mit `pseudonymized: true`. Bei einer Erkennung mit Schutz an scheitert sie mit `protectionActive`.

Neue Fehlerklassen: `protectionActive`, `notPseudonymized`, `protectionConsentMissing`. Die Sätze dazu stehen in `src/cloud/errors.ts`. Das Protokoll bekommt eine Zeile `cloud_protection` mit Vorlage, Schritt und neuem Wert (`on`), ohne Hosts und ohne Texte. `cloud_request` bleibt unverändert.

Ein Schritt, der ohne Schutz in der Cloud läuft, kann den Schutz später wieder einschalten, auch eine Erkennung. Sie ist dann gesperrt, bis der Schutz ausgeschaltet oder die Cloud-Erkennung beendet wird. Diesen Zustand erzeugt auch die Migration.

### Freigabe zum Ausschalten

Das Ausschalten hat eine eigene, versionierte Freigabe (`PROTECTION_CONSENT_VERSION = 1`), gebunden an den Host der Basis-URL wie die aus 0009. Sie steht in `protectionConsent` und gilt für genau diese Wahl. Ändert sich der Host oder wird der Hinweis inhaltlich geändert, gilt der Schutz wieder als an. Bei „Eigener Server“ und Loopback ist er standardmäßig aus, dort braucht das Ausschalten keine Freigabe.

Der Hinweis erscheint im Moment des Ausschaltens, nicht erst beim Speichern. Bis „Verwenden“ ist nichts gespeichert, wie in 0009.

### Hinweise

Beide Hinweise haben kein Häkchen, und „Abbrechen“ ist vorausgewählt.

**Hinweis zum Ausschalten** (Version 1). Der Absatz zur Erkennung erscheint nur, wenn der Schritt die Erkennung ist:

> **Personenbezug nicht entfernen?**
>
> Ohne Schutz sendet Rotstift Namen und andere persönliche Angaben aus den Schülerarbeiten unverändert an den Anbieter. Bei der Erkennung gehen außerdem die Seiten als Bilder mit der Handschrift der Schülerinnen und Schüler an den Anbieter. Auch Handschrift ist personenbezogen. Schalten Sie den Schutz nur aus, wenn für diesen Anbieter ein Vertrag zur Auftragsverarbeitung besteht. Für die Einhaltung der DSGVO und aller anderen Gesetze sind Sie selbst verantwortlich.
>
> [Abbrechen] [Schutz ausschalten]

**Erklärung bei der Erkennung** (kein Hinweis, ein Satz am Schalter): „Bei eingeschaltetem Schutz läuft die Erkennung lokal.“ Solange der Schutz an ist, lässt sich ein Cloud-Modell für die Erkennung nicht verwenden.

**Erklärung bei Schutz an** für die Textschritte: „Rotstift ersetzt Namen und andere Kennungen durch Platzhalter, bevor Text an den Anbieter geht. Der Text ist danach pseudonymisiert.“

**Hinweis aus 0009** („Cloud-Modell verwenden?“) bleibt unverändert. `CONSENT_VERSION` bleibt 1. Begründung: Der Satz „Rotstift sendet dafür Daten aus den Schülerarbeiten an den verbundenen Drittanbieter“ bleibt richtig, auch wenn mit Schutz weniger gesendet wird. Eine neue Version zwänge alle zu einer erneuten Bestätigung eines Textes, der sich inhaltlich nicht geändert hat, und der neue Standard „Schutz an“ verlangt ohnehin keine Zustimmung, sondern engt ein. Die weitergehende Aussage, dass Namen und Handschrift hinausgehen, steht im neuen Hinweis mit eigener Version.

### Cloud-Zeichen

Tooltip und `aria-label` nennen den Schutz je Schritt, etwa „Texterkennung lokal, Korrektur über Mistral AI, pseudonymisiert, Inhalt und Form lokal“. Ein Schritt ohne Schutz trägt keinen Zusatz. Eine durch den Schutz gesperrte Cloud-Erkennung steht als „Texterkennung über Mistral AI, gesperrt durch den Schutz“.

### Oberfläche

- Bei der Cloud-Wahl steht der Schalter „Personenbezug vor dem Senden entfernen“, vorbelegt nach Anbieter und Adresse (an, bei „Eigener Server“ und Loopback aus). Ein Wechsel von Anbieter oder Adresse setzt ihn auf den Standard zurück, damit eine Bestätigung nie für einen anderen Host gilt.
- Dieselbe Zeile steht bei einer bestehenden Wahl in den Einstellungen und ruft `cloud_set_protection` auf.
- Eine Cloud-Erkennung, die der Schutz sperrt (durch die Migration oder durch spätes Einschalten), meldet das in den Einstellungen („Bei eingeschaltetem Schutz läuft die Erkennung lokal. Diese Cloud-Erkennung ist gesperrt …“) und an der Hauptaktion, statt still lokal zu rechnen.
- Schnittstelle für die Verdrahtung: `useCloud().protects(role)` sagt je Schritt, ob der Schutz gilt (Cloud-Schritt mit Schutz an). `cloudLlmClient(step, invoke, { pseudonymized: true })` setzt das Flag, Standard ist `false`. Den Client mit Flag baut nur `src/app/use-shields.ts`, und zwar immer innerhalb der Hülle.

**Prüfansicht** („Vor dem Senden prüfen“, ein Dialog nach [0005](0005-bedienkonzept.md)):

- Links die Arbeiten des Laufs mit Zustand: „wird erkannt“, „zu prüfen“, „freigegeben“ oder „nicht erkannt“.
- Rechts der erkannte Text aller Seiten der gewählten Arbeit. Kennungen sind hinterlegt und zeigen ihren Platzhalter, etwa „Lena [Person 1]“. Sensible Angaben sind gepunktet unterstrichen und tragen „Warnung: Gesundheit“, sie werden nicht ersetzt.
- „Stelle“ und „Art“ ergänzen eine Kennung. Eine Markierung im Text füllt „Stelle“ vor, Tippen geht auch. Danach läuft `propagateSpans` erneut, die Stelle wird also überall in der Arbeit ersetzt. Ergänzen deckt auch eine sensible Angabe ab, die die Lehrkraft schwärzen will.
- Das ✕ an einer Kennung („„Lena“ nicht ersetzen“) entfernt sie an allen Stellen der Arbeit, und sie bleibt auch nach einer späteren Ergänzung entfernt. Bei einem ganzen Namen nimmt es seine Teile und ihre Schreibvarianten mit: Ein Klick auf „Maik Klingenberg“ lässt auch „Maik“ und „Klingenbergs“ stehen. Ein Klick auf „Maik“ allein lässt den ganzen Namen ersetzt. Ergänzen holt die ganze Gruppe zurück.
- Ein Satz sagt, was gesendet wird: „Gesendet wird nur der Text mit Platzhaltern, also pseudonymisiert, und erst nach der Freigabe.“
- „Freigeben“ ist die Hauptaktion des Dialogs und springt zur nächsten offenen Arbeit. Ist keine mehr offen, schließt sich der Dialog. Er lässt sich jederzeit schließen, in der Kopfzeile steht dann „Vor dem Senden prüfen (2)“ neben „Abbrechen“.
- In `pnpm dev:web` zeigt `?schutz` an der Adresse die Prüfansicht mit der Vorschau-Korrektur, ganz ohne Netzwerk.

### Migration

Eine bestehende `cloud.json` hat das Feld nicht. Beim Lesen gilt der Standard: an für alle Cloud-Vorlagen und „Anderer Anbieter“, aus für „Eigener Server“ und Loopback. Rust schreibt die Datei dafür nicht um, der Wert entsteht erst, wenn die Lehrkraft den Schalter ändert oder die Wahl neu anlegt.

Folgen für bestehende Wahlen:

- Eine Cloud-Erkennung bei einem Cloud-Anbieter ist nach dem Update gesperrt (`protectionActive`). Die Einstellungen und die Hauptaktion melden das. Die Lehrkraft schaltet den Schutz bewusst aus (mit Hinweis) oder wählt lokal.
- Ein Cloud-Textschritt braucht ab jetzt das Flag `pseudonymized: true`. Es kommt nur aus der Hülle im Ablauf (siehe „Ablauf“), jeder andere Codepfad scheitert in Rust mit `notPseudonymized`.
- „Eigener Server“ und Loopback laufen unverändert.

## Erkennung

Grundlage ist die Messung [Personenbezug lokal erkennen](../evaluations/2026-10-personenbezug.md) mit 69 selbst geschriebenen Schülertexten. Alle Schichten laufen lokal, auch wenn die Korrektur in der Cloud läuft. Ihre Stellen werden vereinigt: Was eine Schicht findet, wird ersetzt.

### Schichten

1. **Regeln** (`src/privacy/rules.ts`, `src/privacy/patterns.ts`): Kontaktdaten, Konten, Kennzeichen und Ziffernfolgen, Datumsangaben („12.03.2012“, „12. Mai“), Straßen mit Hausnummer, Schulen, Vereine und Kirchengemeinden nach ihrer Form („Käthe-Kollwitz-Realschule“, „TSV Eintracht“, „Gemeinde St. Johannes“). Dazu Praxen und Kanzleien mit Namen („Hausarztpraxis Dr. Berger“), Firmen mit Rechtsform („Technikwelt Hartmann GmbH“), Orte nach einem Ortswort wie Friedhof, Freibad oder Bäckerei („Friedhof Altenbochum“), Namen nach „St.“ oder „Sankt“, Schulwörter auch mit Lesefehlern („Gesamtchale Weststadt“), Orte nach „Am“ oder „An der“ („Sporthalle Am Hang“) und der Ort im Briefkopf vor dem Datum („Bad Homburg, 03.05.2025“).
2. **Namen der Arbeit** (`src/privacy/names.ts`): Die Wörter aus dem Namen der Arbeit werden im Text gesucht. Kennt das Wörterbuch ein Wort, gilt es als Thema der Arbeit und wird übergangen („Erlebnis Opa“), außer es ist ein Vorname oder ein Nachname, der zugleich ein Wort ist.
3. **Vornamen** (`src/privacy/first-names.ts`): Eine Liste häufiger Vornamen, auch älterer Generationen (Rüdiger, Gisela, Hannelore) sowie türkischer, arabischer und osteuropäischer, dazu Auslöser wie „Frau“, „Onkel“, „mein Freund“, „Liebe“ oder „Grüße“ vor einem großgeschriebenen Wort. Nach „heiße“ und „Name ist“ zählt auch ein kleingeschriebenes Wort. Kurze Namen unter vier Buchstaben zählen nur großgeschrieben, Wörter der Aufgabenstellung nie. Monatsnamen wie Juli oder August zählen nicht, wenn sie als Monat stehen („im Juli“, „3. Mai“, „August 2025“).
4. **Wörterbuch** (`src/privacy/dictionary.ts`, `src-tauri/src/spelling.rs`): Großgeschriebene Wörter ab drei Buchstaben, die das deutsche Wörterbuch in keiner Form kennt (auch kleingeschrieben und ohne Genitiv-s), gelten als Name. Das Wörterbuch ist `dictionary-de` (igerman98, GPL-2.0 oder GPL-3.0, 1,1 MB) und wird mit `spellbook` (MPL-2.0, reines Rust) in die App eingebaut. Es braucht kein Netz.
   - Steht davor ein Einrichtungswort (Autohaus, Praxis), wird es eine Einrichtung, steht danach eine Hausnummer, ein Ort.
   - Bis zu drei Kleinbuchstaben vor einem Großbuchstaben gelten als Lesefehler („ocSelin“), geprüft wird der Rest.
   - Lange Wörter, die sich in zwei bekannte Teile zerlegen lassen, gelten als Komposita, nicht als Name, außer sie enden auf eine Namensendung wie -mann, -berg oder -hausen.
   - Eine kleine Liste bekannter Fremdwörter (Instagram, Ramadan) zählt nie.
5. **Lokales Modell** (`src/privacy/model-detector.ts`): Gemma 4 E2B mit dem Prompt `beispiele` aus der Messung, Temperatur 0, Antwort per JSON-Schema als Listen aus Zitat (höchstens 48 Zeichen) und Kategorie, getrennt nach Kennungen und sensiblen Angaben. Längere Arbeiten gehen in Stücken von höchstens 3000 Zeichen an das Modell.

Vor der Suche fügen alle Schichten Wörter zusammen, die am Zeilenende getrennt sind und klein weitergehen („Bau-⏎er“).

Nach den Schichten, vor und nach der Weitergabe:

- **Zusammenführen** (`src/privacy/join-names.ts`): Ein Nachname, der zugleich ein Wort ist (`src/privacy/word-surnames.ts`, „Lilly Jung“), wird nach einem Personennamen mit ersetzt. Ebenso eine kurze kleingeschriebene Lücke zwischen zwei Namensteilen („Max vot Wettstein“) und ein kurzes Großwort direkt davor („Bn Wilhelm“). Ein Name, der zugleich ein Wort ist, bleibt stehen, wenn ein Artikel davorsteht („der Wolf“, „ein schlauer Fuchs“).
- **Behalten** (`src/privacy/known-names.ts`, `src/privacy/known-works.ts`): Eine kuratierte Liste mit rund hundert Werken der Schullektüre samt Autoren und Figuren. Ein Werk gilt, wenn sein Titel in der Aufgabe, im Namen der Arbeit oder im Text steht. Titel, die auch Alltagswörter sind („Die Welle“, „Faust“, „Momo“), zählen im Text nur in Anführungszeichen. Dann bleiben seine Figuren und Autoren stehen, nicht aber ein Name direkt nach „meine Schwester“ oder „mein Banknachbar“ und nicht in Zusammensetzungen wie „Goethe-Gymnasium“. Dazu rund 300 Prominente mit vollem Namen (danach auch der Nachname allein) und Einzelnamen wie Goethe oder Merkel. Ohne genanntes Werk bleibt ein Freund namens Maik eine Kennung.

### Modellwahl

- Standard ist **Gemma 4 E2B**. Es läuft über dieselbe Engine und Modellverwaltung wie die Korrektur. Ist ein anderes lokales Modell geladen, fragt die App zuerst dieses, um einen Wechsel zu sparen.
- **E2B und E4B zusammen**, wenn die lokale Gründlichkeit „Gründlich“ oder „Sehr gründlich“ ist, der Rechner mindestens 16 GB Arbeitsspeicher hat (gemessen ab 15 GiB) und E4B eingerichtet ist. Die Kennungen beider Modelle werden vereinigt, die sensiblen Angaben kommen dann nur von E4B. Fehlt E4B, läuft E2B allein.
- **Fehlt E2B**, schwärzt die App nicht ohne Modell, sondern meldet an der Arbeit: „Zum Entfernen des Personenbezugs braucht Rotstift das lokale Modell Gemma 4 E2B, auch wenn die Korrektur in der Cloud läuft. …“ Von der Arbeit geht nichts hinaus. Begründung: Ohne Modell bleibt laut Messung in rund drei von vier Arbeiten mindestens eine Kennung stehen.

### Nachbearbeitung der Zitate

- Rollenwörter am Anfang („Frau“, „Onkel“, „mein Freund“) werden abgeschnitten.
- Zitate über der Wortgrenze je Kategorie werden verworfen (Person 4 Wörter, Ort und Einrichtung 8, sonst 12). Längere Zitate sind meist ganze Sätze.
- Personennamen, deren Wörter alle in der Aufgabenstellung stehen, werden verworfen (Entscheidung 2).
- Zitate, die keine Kennung sein können, werden verworfen: Verwandtschaftswörter, Wochentage, Monate, Länder, Parteien und Gewerkschaften, Klassen wie „7b“, Uhrzeiten, Jahreszahlen ohne Tag und Monat, Beträge und kurze Zahlen.
- Einzelne großgeschriebene Wörter ab sieben Buchstaben als Person oder Einrichtung, die das Wörterbuch kennt und die kein Vorname sind, werden verworfen („Hausaufgaben“). Das gilt nicht, wenn das Wort im Text nach einer Anrede, einem Familienwort, einem Verwandtschafts- oder Beziehungswort oder einem Vornamen steht („Frau Schneider“, „bei Neumanns“, „mein Vater Rüdiger“, „Tim Richter“), und nicht für Vornamen und Nachnamen der Listen, auch mit End-s.
- Jedes Zitat wird im Text gesucht, erst genau, dann mit kleinen Abweichungen, auch über Zeilenumbrüche. Jedes Vorkommen wird ersetzt. Ein Zitat, das nicht im Text steht, fällt weg.
- Sensible Angaben werden nicht zusätzlich als Kennung ersetzt (Entscheidung 3): Liegt eine Kennung in einem sensiblen Zitat, fällt sie weg, wenn die Kennung Kontaktdaten sind, ein Ort bei Herkunft oder eine Einrichtung bei Gewerkschaft oder politischer Meinung. Personen, Daten und Nummern bleiben immer ersetzt.

### Weitergabe

`propagateSpans` gibt jede Kennung an alle Vorkommen der Arbeit weiter:

- **Ganze Wörter mit Bindestrich:** Eine Person, ein Ort oder eine Einrichtung wird über den Bindestrich hinaus erweitert („Münster-Hiltrup“, „Anne-Sophie“), nicht aber über einen Trennstrich am Zeilenende.
- **Teile:** Die Teile eines Personennamens ab zwei Buchstaben, bei Orten und Einrichtungen ab vier Buchstaben und nur aus Kennungen mit mindestens zwei Teilen („34127 Kassel“ gibt „Kassel“ weiter). Allerweltswörter (`COMMON_WORDS`) und allgemeine Wörter wie „Schule“ oder „Straße“ werden bei Orten und Einrichtungen nicht weitergegeben, bei Personen nur an großgeschriebene Vorkommen („Klein“, nicht „klein“).
- **Unscharf:** Teile ab fünf Buchstaben, die keine Allerweltswörter sind, finden auch Wörter mit gleichem Anfangsbuchstaben und einem Tippfehler Abstand, mit Genitiv-s („Johanna“ findet „Johana“ und „Johannas“).

### Restdauer

Die Erkennung ist ein eigener Schritt der Restdauer, einmal je Arbeit. Der Startwert ist 15 s je Arbeit für E2B (gemessen 9 s auf einem Ryzen 7 5700X mit 4 Threads, dazu Luft für schwächere Rechner). E4B zählt das 1,5-Fache, beide zusammen das 2,5-Fache. Danach lernt die Restdauer den Wert je Modellkombination wie bei den übrigen Schritten.

### Güte

Gegenprobe der eingebauten Kette auf den 23 zurückgehaltenen Arbeiten der Messung (Anteil der Arbeiten ohne ein einziges durchgerutschtes Vorkommen einer Kennung, siehe [Nachtrag](../evaluations/2026-10-personenbezug.md#nachtrag-gegenprobe-der-eingebauten-kette)):

| Kette           | sauberer Text | von GLM-OCR erkannt | mit Lesefehlern wie Handschrift | sensible Angaben gefunden |
| --------------- | ------------: | ------------------: | ------------------------------: | ------------------------: |
| E2B             |         100 % |               100 % |                            78 % |                      50 % |
| E2B und E4B     |         100 % |               100 % |                            83 % |                     100 % |
| Messung mit E2B |          87 % |                96 % |                            74 % |                      50 % |

Die Regelschicht wurde an den Lecks des Holdouts nachgeschärft, die 100 % sind deshalb eine Obergrenze. Auf den Entwicklungsdaten (46 Arbeiten) erreicht E2B 98 %. Die Kette ersetzt rund 5 % der Wörter zu viel, auf Text mit Lesefehlern rund 10 %. Zeit je Arbeit auf einem Ryzen 7 5700X mit 4 Threads: E2B 9 s, E4B 14 s (Median).

## Folgen und Grenzen

- Kein Detektor ist vollständig. Eine übersehene Kennung geht hinaus. Am häufigsten sind das zerlesene Namen auf schlecht gelesener Handschrift und einzelne Vorkommen in langen Arbeiten.
- Die Erkennung ersetzt zu viel, vor allem auf Text mit Lesefehlern. Figuren, Autoren und Prominente behält sie nur, wenn sie in der Liste stehen, sonst nimmt die Lehrkraft sie in der Prüfansicht mit einem Klick je Name zurück. Die Liste ist an den Proben der Messung entstanden und deckt nicht jede Lektüre ab.
- Sensible Angaben sind ein Hinweis „möglicherweise sensibel“ ohne Anspruch auf Vollständigkeit. Mit E2B allein findet die Erkennung laut Messung etwa die Hälfte.
- Die Erkennung braucht E2B auch dann, wenn alle Textschritte in der Cloud laufen, also rund 3 GB Platte und Arbeitsspeicher und 10 bis 20 s je Arbeit auf einem Rechner ohne GPU. Deshalb bestätigt die Lehrkraft in der Prüfansicht je Arbeit den geschwärzten Text, und die Hinweise sprechen von „pseudonymisiert“, nicht von „anonym“. Die Verantwortung bleibt bei der Lehrkraft.
- Auch der geschwärzte Text ist personenbezogen (C-434/16): Der Inhalt der Antworten, der Schreibstil und seltene Umstände können eine Person bestimmbar machen. Das Schwärzen verkleinert das Risiko, es beseitigt es nicht.
- Mit Schutz läuft die Erkennung lokal. Wer wegen eines schwachen Rechners eine Cloud-Erkennung wollte, braucht dafür ein Schulmodell mit Vertrag (Schutz aus) oder einen eigenen Server.
- Das Flag `pseudonymized` ist eine Sicherung gegen vergessene Codepfade, kein Beweis. Rust prüft nicht, ob der Text geschwärzt ist.
- Das Zurücksetzen hängt davon ab, dass der Anbieter die Platzhalter unverändert zurückgibt. Wie das Kernmodul mit geänderten oder fehlenden Platzhaltern umgeht, legt es selbst fest und gehört nicht in dieses ADR.
- Die Migration sperrt bestehende Cloud-Erkennungen, bis die Lehrkraft den Schutz ausschaltet. Cloud-Textschritte laufen mit Prüfansicht und Schwärzen.
- Mit Schutz wartet ein Lauf auf die Lehrkraft. Die lokalen Schritte sind dann schon fertig, die Cloud-Schritte laufen Arbeit für Arbeit nach der Freigabe.
- Platzhalter verändern, was das Modell sieht. Die Korrekturqualität mit geschwärztem Text ist nicht gemessen und gehört in die Messung.

## Tests

- Rust: Mit Schutz an lehnt `cloud_chat` die Erkennung ab (`protectionActive`) und einen Textschritt ohne Flag (`notPseudonymized`), ohne Netzwerkzugriff (Zähler bleibt 0). Mit Flag geht der Textschritt hinaus.
- Rust: Eine Erkennung mit Schutz an lässt sich nicht anlegen. Ausschalten braucht die Freigabe, Einschalten löscht sie, ein erneutes Ausschalten fragt wieder.
- Rust: Eine Freigabe mit anderer Version oder anderem Host zählt als „an“. „Eigener Server“ und Loopback sind standardmäßig aus und senden ohne Flag.
- Rust: Eine `cloud.json` ohne das Feld wird als „an“ gelesen, außer bei „Eigener Server“ und Loopback.
- Frontend: Der Schalter ist je Anbieter vorbelegt. „Abbrechen“ im Hinweis lässt ihn an und hat den Fokus. Die Erkennung ist bei Schutz an nicht verwendbar. Der Hinweis nennt bei der Erkennung die Handschrift.
- Frontend: Client, Hook (`protects`, `setProtection`) und Cloud-Zeichen nennen den Schutz. Eine gesperrte Cloud-Erkennung meldet das in den Einstellungen.
- E2E: Den Schalter ausschalten, den Hinweis abbrechen: Er bleibt an. Wieder ausschalten und bestätigen: Die Cloud-Erkennung ist wählbar.
- Ablauf: Phasen in dieser Reihenfolge, vor der Freigabe kein Aufruf des Cloud-Schritts, eine nicht freigegebene Arbeit wird nie gesendet, auch nicht nach Abbrechen oder Ausschalten des Schutzes. Ohne Schutz läuft alles wie bisher.
- Prüfansicht: Ergänzen mit Weitergabe, Entfernen auf Dauer, ein ganzer Name samt Teilen mit einem Klick, Freigeben.
- Erkennung: Jede Schicht für sich mit eigenen Beispielen, Nachbearbeitung und Suche der Zitate, Modellwahl, Weitergabe mit Bindestrich, Teilen und Tippfehlern. `eval/privacy-score.ts` misst mit der Option `app` die eingebaute Kette gegen die Gold-Markierungen.
- E2E: Ein fehlendes E2B meldet sich an der Arbeit, und es geht nichts hinaus.
- E2E: Ein Lauf mit Cloud-Korrektur und Schutz zeigt die Prüfansicht, die Lehrkraft ergänzt eine Stelle und gibt frei. Das nachgebildete `cloud_chat` prüft, dass jede Anfrage `pseudonymized: true` trägt und keinen Originalnamen enthält, und die Marken erscheinen auf dem Original.

## Doku

README und CLAUDE.md sagen künftig: Cloud-Schritte senden nach dem Schwärzen pseudonymisierten Text, die Erkennung bleibt dabei lokal, und der Schutz lässt sich nach einem Hinweis je Anbieter ausschalten. Es kommt kein neuer Netzwerkzugriff hinzu, die CSP in `tauri.conf.json` bleibt unverändert.
