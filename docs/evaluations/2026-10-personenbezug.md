# Evaluation: Personenbezug lokal erkennen (Oktober 2026)

Frage: Wie zuverlässig findet eine lokale Erkennung Kennungen und sensible Angaben in Schülertexten, auch wenn die Texterkennung falsch gelesen hat, und welche Kombination aus Regeln, Namensliste, Wörterbuch und lokalem Modell soll Rotstift nach [ADR 0011](../adr/0011-personenbezug-entfernen.md) einbauen?

Gemessen ist nur die Erkennung. Eingebaut ist sie inzwischen, die Gegenprobe steht im [Nachtrag](#nachtrag-gegenprobe-der-eingebauten-kette). Hauptmaß ist der Anteil der Arbeiten, in denen **kein einziges Vorkommen** einer Kennung durchrutscht. Ein Vorkommen gilt nur dann als gefunden, wenn alle seine Buchstaben und Ziffern abgedeckt sind („Tom Beck[er]“ ist ein Leck).

## Ergebnis

**Holdout, 23 Arbeiten, Anteil der Arbeiten ohne ein einziges durchgerutschtes Vorkommen einer Kennung (95-%-Intervall):**

| Detektor                                          | sauber               | erkannt (GLM-OCR)    | rauschen (Lesefehler wie Handschrift) | Vorkommen gefunden (sauber) | Überersetzung (sauber) | Zeit je Arbeit | Peak-RSS |
| ------------------------------------------------- | -------------------- | -------------------- | ------------------------------------- | --------------------------: | ---------------------: | -------------: | -------: |
| Kern: Regeln (`detectRules`)                      | 9 % (2 bis 27)       | 9 % (2 bis 27)       | 9 % (2 bis 27)                        |                        28 % |                  0,0 % |      unter 1 s |          |
| Kern: Regeln und Namen der Arbeit (`detectNames`) | 9 % (2 bis 27)       | 9 % (2 bis 27)       | 9 % (2 bis 27)                        |                        32 % |                  0,5 % |      unter 1 s |          |
| Kern, Vornamenliste, Wörterbuch                   | 22 % (10 bis 42)     | 22 % (10 bis 42)     | 17 % (7 bis 37)                       |                        81 % |                  2,8 % |      unter 1 s |          |
| Gemma 4 E2B (`beispiele`)                         | 52 % (33 bis 71)     | 61 % (41 bis 78)     | 57 % (37 bis 74)                      |                        87 % |                  4,1 % |           22 s |   3,2 GB |
| Gemma 4 E4B (`beispiele`)                         | 26 % (13 bis 46)     | 26 % (13 bis 46)     | 35 % (19 bis 55)                      |                        77 % |                  1,5 % |           44 s |   4,9 GB |
| E2B und Kern                                      | 74 % (54 bis 87)     | 87 % (68 bis 95)     | 65 % (45 bis 81)                      |                        95 % |                  4,5 % |           22 s |   3,2 GB |
| **E2B, Kern, Vornamenliste, Wörterbuch**          | **87 % (68 bis 95)** | **96 % (79 bis 99)** | **74 % (54 bis 87)**                  |                        98 % |                  5,4 % |           22 s |   3,2 GB |
| E4B, Kern, Vornamenliste, Wörterbuch              | 87 % (68 bis 95)     | 87 % (68 bis 95)     | 65 % (45 bis 81)                      |                        98 % |                  3,4 % |           44 s |   4,9 GB |
| E2B, E4B, Kern, Vornamenliste, Wörterbuch         | 91 % (73 bis 98)     | 96 % (79 bis 99)     | 83 % (63 bis 93)                      |                        99 % |                  5,5 % |           66 s |   4,9 GB |

Mit Modell immer Nachbearbeitung der Zitate (`post`) und unscharfe Propagation (`fuzzy`), beim Kern allein die Propagation des Kernmoduls. Zeiten auf simon-pc mit 4 Threads unter fremder Last (Median, siehe [Zeit und Speicher](#zeit-und-speicher)). „sauber“ und „erkannt“ unterscheiden sich bei E2B um mehr, als die 0,5 % Lesefehler erklären: Kleine Unterschiede im Text ändern die Antwort des Modells, und bei 23 Arbeiten macht jede Arbeit 4 Prozentpunkte aus.

**Was in der besten Kombination durchrutscht** (sauber und erkannt): Ein Nachname, der über den Zeilenumbruch getrennt ist und zugleich ein Wort ist („Bau-⏎er“), ein Ortsteil mit Bindestrich („Münster-Hiltrup“) und eine Kirchengemeinde („Gemeinde St. Johannes“). Mit Lesefehlern kommen zerlesene Namen dazu („Zey(nep“, „Ftabvi“) und ein zerlesenes Datum („2802.2012“).

**Sensible Angaben im Holdout** (8): E2B findet 50 % bei 0,09 Fehlalarmen je Arbeit, mit dem eigenen Prompt `sensibel` 63 % bei 0,65, E4B 100 % bei 0,43.

**Ohne lokales Modell bleibt in fast jeder Arbeit mindestens eine Kennung stehen.** Das Kernmodul aus `src/privacy` (Regeln und Namen aus dem Namen der Arbeit) findet Kontaktdaten, Daten und Nummern zuverlässig, aber Personen nur, wenn ihr Name im Dateinamen steht (6 %), und Schulen und Vereine gar nicht. Eine Liste häufiger Vornamen, Auslöser wie „Frau“ oder „heiße“ und ein Wörterbuch (großgeschriebene Wörter, die hunspell nicht kennt) heben die gefundenen Vorkommen von 32 auf 81 %, leckfrei sind aber nur 22 % (dev: 46 %).

**Gemma 4 E2B allein ist besser als alle Regeln zusammen, aber erst die Vereinigung aller Schichten erreicht 87 bis 96 % (dev: 96 bis 98 %).** Modell und Regeln scheitern an verschiedenen Stellen: Das Modell übersieht einzelne Vorkommen und Datumsangaben im Briefkopf, die Regeln übersehen Nachnamen, Spitznamen und Einrichtungen. Jede gefundene Kennung wird anschließend an allen Stellen der Arbeit ersetzt (Propagation), das schließt die meisten Lücken des Modells.

**Lesefehler kosten wenig, solange die Erkennung gut liest, und viel, wenn sie so schlecht liest wie auf echter Handschrift.** Die gerenderten Heftseiten liest GLM-OCR fast fehlerfrei (0,3 bis 0,5 % falsch gelesene Wörter), dort sinkt der Wert nicht. Mit synthetischen Lesefehlern in der Rate, die GLM-OCR auf echter Erwachsenenhandschrift zeigt (19 % der Wörter, 7 % der Zeichen), fällt die beste Kombination auf 74 % (dev: 70 %), mit E4B als zweitem Modell auf 83 %. Ein Teil dieser „Lecks“ sind Namen, die so zerlesen sind, dass sie niemanden mehr bestimmen („ksieiouon“), ein anderer Teil nicht („Natwoa Tesfay“, „hPis Kowalczyk“).

**Der Preis ist Überersetzung.** Die beste Kombination ersetzt 5 bis 6 % der Wörter zu viel (auf Text mit Lesefehlern 10 %), vor allem Figuren und Autoren in Inhaltsangaben und Prominente: Im Holdout 24 bis 29 von 32 Namen, die stehen bleiben müssten, auf dev 85 bis 89 von 111. Für eine Inhaltsangabe zu „Tschick“ heißt das: „[Person 1] und [Person 2] fahren im Lada nach Osten“. Die Korrektur verliert dadurch kaum etwas, die Bewertung von Inhalt und Form schon.

**Sensible Angaben findet E2B nur zur Hälfte.** E4B findet fast alle (dev 95 %, Holdout 8 von 8), warnt aber in jeder zweiten Arbeit grundlos (dev 0,85 Fehlalarme je Arbeit, Holdout 0,43). Für eine reine Warnung in der Prüfansicht ist E4B die bessere Wahl, wenn der Rechner es trägt.

**Nebenbefund: `propagateSpans` stürzt bei Bindestrichen ab.** `escape()` in `src/privacy/propagate.ts` maskiert `-` als `\-`, das ist unter dem `u`-Flag ein ungültiges Escape. Jede Kennung mit Bindestrich („Anne-Sophie“, „Käthe-Kollwitz-Realschule“, „HH-MK 2284“) lässt den Aufruf mit `SyntaxError` abbrechen, in der Messung 108 von 414 Aufrufen auf dev. Die Funktion hat noch keinen Aufrufer, der Fehler ist also latent. Die Messung umgeht ihn, indem sie bei einem Absturz die Formen mit Bindestrich nicht propagiert (Option `app` in `privacy-score.ts`). Die eigene Propagation (`fuzzy`) misst gleich oder besser.

## Empfehlung

1. **Alle drei Schichten aus ADR 0011 einbauen und vereinigen, dazu zwei Ergänzungen in der Regelschicht:** Eine Liste häufiger Vornamen (rund 450, auch türkische, arabische, osteuropäische, siehe `eval/privacy-names.ts`) mit Auslösern („Frau“, „Herr“, „Oma“, „heiße“, „mein Freund“) und ein Wörterbuch für großgeschriebene Wörter, die es nicht kennt. Das Wörterbuch kann dasselbe sein wie in [Lesefehler](2026-10-lesefehler.md) beschrieben (`dictionary-de` mit `spellbook` in Rust). Ohne Vornamenliste und Wörterbuch sinkt die beste Kombination im Holdout von 87 auf 74 % (sauber) und von 96 auf 87 % (erkannt).
2. **Modell: Gemma 4 E2B mit dem Prompt `beispiele`** (Prompt in `eval/privacy-llm.ts`: Kategorien mit Regeln, ein kurzes Beispiel mit Antwort, Zitat höchstens 48 Zeichen, Antwort per JSON-Schema als Liste aus Zitat und Kategorie). Die App sucht jedes Zitat im Text und ersetzt jedes Vorkommen. Zitate nachbearbeiten: Rollenwörter („Frau“, „Onkel“) abschneiden, Zitate über der Wortgrenze je Kategorie verwerfen, Personennamen verwerfen, deren Wörter alle in der Aufgabenstellung stehen. E4B nicht als Standard: Allein schlechter (Holdout 26 % statt 52 %), doppelt so langsam und 4,9 statt 3,2 GB. E2B und E4B zusammen sind die einzige Kombination, die auch mit Lesefehlern über 80 % bleibt, brauchen aber dreimal so lange. Als Option „gründlich“ für 16-GB-Rechner ist das sinnvoll.
3. **Bindestriche in der Regelschicht:** Wörter über einen Trennstrich am Zeilenende zusammenfügen, bevor Namen gesucht werden („Bau-⏎er“), und Ortsteile mit Bindestrich als Ganzes ersetzen („Münster-Hiltrup“). Beides rutschte im Holdout durch.
4. **Propagation unscharf**, also auch mit einem Tippfehler Abstand ab 5 Buchstaben und gleichem Anfangsbuchstaben, und den Bindestrich-Fehler in `propagateSpans` vorher beheben. Gegen Überersetzung durch Propagation von Allerweltswörtern („Wolf“, „Fuchs“, „Sonne“, „Engel“) genügt die Liste `COMMON_WORDS` nicht, ein Nachname wie „Wolf“ wird sonst im ganzen Text ersetzt. Das ist im Zweifel aber richtig (Entscheidung 2).
5. **Keine Schwelle, die Prüfansicht ist die Schwelle.** Die Erkennung soll so viel ersetzen wie hier gemessen, die Lehrkraft nimmt Figuren und Prominente in der Prüfansicht zurück. Damit das schnell geht, sollte die Prüfansicht gleiche Platzhalter gemeinsam zurücknehmen können (ein Klick für „Maik Klingenberg“ an allen Stellen). Eine Liste bekannter Figuren und Prominenter wäre eine eigene Messung wert, hier ist sie nicht gemessen.
6. **Sensible Angaben getrennt prüfen:** Mit E2B nur als Hinweis „möglicherweise sensibel“ ohne Anspruch auf Vollständigkeit, auf 16-GB-Rechnern mit E4B. Der eigene Prompt `sensibel` findet etwas mehr, warnt aber drei- bis siebenmal so oft grundlos und kostet einen zweiten Aufruf. Zitate, die das Modell als sensibel meldet, nicht zusätzlich als Kennung ersetzen.

## Proben und Verfahren

- **69 selbst geschriebene Schülertexte** der Klassen 5 bis 10 (`eval/samples/privacy`), 46 zur Entwicklung (`dev`, 5113 Wörter) und 23 zurückgehalten (`holdout`, 2552 Wörter, jede dritte Probe nach Nummer). Der Holdout wurde erst gemessen, als Prompt, Nachbearbeitung und Kombinationen feststanden. Textformen: Erlebniserzählung, Brief, E-Mail, Bericht, Steckbrief, Bewerbung, Praktikumsbericht, Tagebuch, Inhaltsangabe, Charakterisierung, Erörterung, Leserbrief, Stellungnahme. Jede Probe hat einen Arbeitsnamen (Dateiname, oft mit dem Namen der Schülerin) und eine Aufgabenstellung.
- **Schwierige Fälle mit Absicht:** Spitznamen und Verschreibungen („Kewin“, „Dschei“), Namen über einen Zeilenumbruch getrennt („Hau-⏎ke“), Nachnamen, die Wörter sind („Wolf“, „Rabe“, „Sonne“), Namen aus der Aufgabe, Figuren und Prominente, Länder und Reiseziele ohne Wohnbezug, Briefköpfe mit Adresse und Datum, Vereinskürzel, Kennzeichen, IBAN, Handles.
- **Gold:** Kennungen (`person` 220, `place` 35, `institution` 36, `contact` 28, `date` 44, `number` 20), zu behaltende Namen (`keep` 143) und sensible Angaben (30). Proben und Markierungen entstanden mit einem Sprachmodell nach einem gemeinsamen Format, alle Markierungen wurden gelesen und korrigiert.
- **Texte:** `sauber` ist der Text der Probe. `erkannt` ist das Transkript von GLM-OCR (Preset „Schnell“, `glm-ocr-q8`) auf den mit `render.py --heft --one-page` gerenderten Heftseiten, alle 69 Proben. `rauschen` ist der Text mit synthetischen Lesefehlern aus `ocr-noise.ts`, gelernt aus GLM-OCR auf 20 echten Handschriftseiten (ScaDS). Die Gold-Spans wandern per Zeichen-Ausrichtung auf jedes Transkript.
- **Maße:** Arbeiten ohne Leck mit 95-%-Intervall (Wilson), Vorkommen gefunden, Überersetzung (Wörter außerhalb jeder Kennung, die ersetzt werden, in % aller Wörter), ersetzte Namen, die stehen bleiben müssten, sensible Angaben gefunden und Fehlalarme je Arbeit, Zeit je Arbeit und Peak-RSS des llama-servers.
- **Modelle:** Gemma 4 E2B und E4B in Q4_0 mit MTP-Kopf als Entwurf, `--no-repack`, `--reasoning off`, 4 Threads, nur CPU (`--n-gpu-layers 0 --device none`), Kontext 4096, Temperatur 0.

## Ergebnisse auf dev

Alle Zahlen auf 46 Arbeiten, Propagation `exact`, wenn nicht anders angegeben, mit Nachbearbeitung der Zitate (`post`).

### Prompt-Varianten (E2B, sauberer Text)

| Variante                                         | ohne Leck | Vorkommen gefunden | Überersetzung | Figuren ersetzt | Zeit je Arbeit¹ |
| ------------------------------------------------ | --------: | -----------------: | ------------: | --------------: | --------------: |
| `regeln` ohne Zitatgrenze und Nachbearbeitung    |      76 % |               92 % |        24,3 % |         102/111 |            25 s |
| `regeln` mit Grenze und Nachbearbeitung          |      61 % |               78 % |         9,2 % |          79/111 |            28 s |
| `zeilen` (Antwort je Zeile, 29 Arbeiten)         |      24 % |               63 % |        20,4 % |           12/59 |            59 s |
| **`beispiele`** (mit Beispiel und Antwort)       |  **72 %** |           **91 %** |     **4,2 %** |          70/111 |            55 s |
| `nachlese` (`beispiele`, dann „was fehlt noch?“) |      72 % |               91 % |         4,4 % |          70/111 |            71 s |
| E4B `beispiele`                                  |      54 % |               80 % |         2,3 % |          48/111 |            71 s |

¹ Unter fremder Last gemessen, nur untereinander grob vergleichbar, siehe [Zeit und Speicher](#zeit-und-speicher).

`regeln` ohne Grenze zitiert ganze Sätze und ersetzt damit ein Viertel des Textes, das ist unbrauchbar. Mit Grenze schneidet es die Sätze ab und verliert die Namen darin. Erst ein Beispiel mit kurzen Zitaten bringt E2B dazu, nur die Kennung zu zitieren. Eine zweite Runde („Was fehlt noch?“) findet nichts Neues. E4B zitiert vorsichtiger, übersieht dabei aber vor allem Personen (74 %) und Datumsangaben (54 %).

### Kombinationen

| Detektor                                      | Text     |   ohne Leck (95-%-KI) | Vorkommen | Überersetzung | Figuren ersetzt |
| --------------------------------------------- | -------- | --------------------: | --------: | ------------: | --------------: |
| Kern Regeln (`app-rules`)                     | sauber   |        9 % (3 bis 20) |      26 % |         0,0 % |           0/111 |
| Kern Regeln und Namen (`app`)                 | sauber   |       13 % (6 bis 26) |      28 % |         0,4 % |           8/111 |
| Kern, Vornamen, Wörterbuch                    | sauber   |      46 % (32 bis 60) |      82 % |         3,0 % |          64/111 |
|                                               | erkannt  |      46 % (32 bis 60) |      80 % |         2,9 % |          62/111 |
|                                               | rauschen |      28 % (17 bis 43) |      72 % |         7,0 % |          74/111 |
| E2B                                           | sauber   |      72 % (57 bis 83) |      91 % |         4,2 % |          70/111 |
|                                               | erkannt  |      65 % (51 bis 77) |      85 % |         4,1 % |          73/111 |
|                                               | rauschen |      46 % (32 bis 60) |      78 % |         4,8 % |          68/111 |
| E2B und Kern                                  | sauber   |      76 % (62 bis 86) |      93 % |         4,6 % |          78/111 |
| E2B, Kern, Vornamen                           | sauber   |      93 % (82 bis 98) |      99 % |         5,4 % |          82/111 |
| E2B, Kern, Wörterbuch                         | sauber   |      91 % (80 bis 97) |      97 % |         4,9 % |          82/111 |
| **E2B, Kern, Vornamen, Wörterbuch** (`fuzzy`) | sauber   | **98 % (89 bis 100)** |     100 % |         5,7 % |          86/111 |
|                                               | erkannt  |  **96 % (85 bis 99)** |      99 % |         5,6 % |          85/111 |
|                                               | rauschen |  **70 % (55 bis 81)** |      91 % |         9,8 % |          89/111 |
| dasselbe ohne Nachbearbeitung                 | sauber   |     98 % (89 bis 100) |     100 % |         7,0 % |         108/111 |
| E4B, Kern, Vornamen, Wörterbuch               | sauber   |      93 % (82 bis 98) |      98 % |         4,1 % |          73/111 |
| E2B, E4B, Kern, Vornamen, Wörterbuch          | sauber   |    100 % (92 bis 100) |     100 % |         5,8 % |          86/111 |

Die Nachbearbeitung ändert die Trefferquote nicht, senkt aber die ersetzten Figuren von 108 auf 86, weil sie Namen aus der Aufgabenstellung stehen lässt. Die Propagation des Kernmoduls (`app`) misst auf sauberem Text gleich, auf erkanntem Text 91 statt 96 %, weil die Formen mit Bindestrich wegen des Absturzes fehlen.

### Recall je Kategorie

| Detektor                        | Text     | Person |  Ort | Einrichtung | Kontakt | Datum | Nummer |
| ------------------------------- | -------- | -----: | ---: | ----------: | ------: | ----: | -----: |
| Kern Regeln und Namen           | sauber   |    4 % | 42 % |         0 % |   100 % |  92 % |   92 % |
| Kern, Vornamen, Wörterbuch      | sauber   |   83 % | 58 % |        59 % |   100 % |  96 % |   92 % |
| E2B und Kern                    | sauber   |   89 % | 95 % |       100 % |   100 % | 100 % |  100 % |
| E2B, Kern, Vornamen, Wörterbuch | sauber   |  100 % | 95 % |       100 % |   100 % | 100 % |  100 % |
|                                 | rauschen |   89 % | 89 % |        91 % |    94 % |  96 % |  100 % |

Anzahl Vorkommen auf dev: Person 140, Ort 19, Einrichtung 22, Kontakt 18, Datum 26, Nummer 13.

### Sensible Angaben

22 sensible Angaben auf dev: Herkunft 6, Gesundheit 5, Lebensumstände 3, Politik 3, Sexualität 2, Gewerkschaft 2, Religion 1.

| Detektor                        | sauber gefunden | Fehlalarme je Arbeit | rauschen gefunden |
| ------------------------------- | --------------: | -------------------: | ----------------: |
| E2B `beispiele`                 |            50 % |                 0,15 |              18 % |
| E2B `sensibel` (eigener Prompt) |            50 % |                 0,50 |                   |
| E2B beide vereinigt             |            59 % |                 0,65 |                   |
| E4B `beispiele`                 |            95 % |                 0,85 |                   |

E2B übersieht politische Angaben (Parteien), Sexualität und Erwähnungen von Muttersprache und Herkunft. Ein Teil der Fehlalarme ist vertretbar (Geldsorgen der Familie, Wohngruppe), ein Teil nicht (Hobbys, Schulfächer). Mehrere sensible Angaben ersetzt E2B als Kennung statt nur zu warnen („Asthma“, „Knie-OP“, „Eritrea“, „Kurdisch“), das gehört in die Nachbearbeitung: Zitate, die das Modell auch als sensibel meldet, nicht ersetzen.

## Typische Fehler

Alle Beispiele aus den selbst geschriebenen Proben.

- **Figuren und Prominente werden ersetzt.** In Inhaltsangaben fast alle Figuren (Maik Klingenberg, Ben Ross, Gregor Samsa, Krabat), dazu Autoren („Andreas Steinhöfel“) und Prominente (Greta Thunberg, Ed Sheeran, Taylor Swift). Steht der Name in der Aufgabenstellung, verwirft die Nachbearbeitung ihn, sonst nicht.
- **Allerweltswörter als Nachname.** Heißt jemand „Wolf“ oder „Fuchs“, ersetzt die Propagation auch das Tier. Umgekehrt rutschen Nachnamen wie „Rabe“, „Lu“, „Sonne“ oder „Jung“ öfter durch, weil Wörterbuch und `COMMON_WORDS` sie als Wort kennen.
- **Verschriebene Spitznamen** („Kewin“, „Dschei“, „Dawi“) findet nur das Modell, die Vornamenliste nicht.
- **Datumsangaben im Briefkopf** übersieht E2B oft, die Regeln finden sie.
- **Namen über einen Zeilenumbruch** („Natwoa⏎Tesfay“, „Lhlily⏎Jung“ mit Lesefehlern) verliert die Propagation, wenn der Teil vor dem Umbruch zerlesen ist.
- **Zerlesene Kennungen.** Bei 19 % falsch gelesenen Wörtern trifft es Namen genauso. „Lukas vitom Hohenfels“, „Gesamtchale Weststadt“, „0176 t44120987“ sind noch eindeutig und bleiben stehen.
- **Ein identisches Transkript ergibt nicht immer dieselbe Antwort.** Kleine Unterschiede im Text (ein Leerzeichen, ein Zeilenumbruch) ändern die Liste des Modells, bei Temperatur 0. Das erklärt einen Teil der Lücke zwischen `sauber` und `erkannt` bei E2B allein.

## Zeit und Speicher

Kein Lauf hatte einen freien Rechner: Auf simon-pc (Ryzen 7 5700X, 4 Threads je llama-server) liefen meist zwei Läufe gleichzeitig und fremde Rechenjobs, der Mac (M4 Pro) war ebenfalls belegt. Ein eigener Zeitlauf auf dem Mac brach unter dieser Last ab (173 s für die erste Arbeit, Antwort nach 120 s abgeschnitten) und ist verworfen. Die Zeiten sind darum Obergrenzen, der Holdout-Lauf mit der geringsten Last kommt einem 4-Kern-Rechner am nächsten. **Alle Zeiten in diesem Bericht stammen von simon-pc**, keine vom Mac. Belastbarer als die Sekunden sind die Faktoren aus denselben Läufen: E4B braucht etwa das 2-Fache von E2B (Holdout 44 zu 22 s, dev 78 zu 52 s), der Prompt `sensibel` etwa das 0,4-Fache.

| Lauf (simon-pc, 4 Threads, nur CPU) | Arbeiten | Median je Arbeit | 90-%-Quantil | Prompt-Token | erzeugte Token | Peak-RSS |
| ----------------------------------- | -------: | ---------------: | -----------: | -----------: | -------------: | -------: |
| E2B `beispiele`, holdout            |       23 |             22 s |         27 s |          876 |            245 |   3,2 GB |
| E2B `beispiele`, dev (mehr Last)    |       46 |             52 s |         69 s |          880 |            258 |   3,2 GB |
| E2B `sensibel`, holdout             |       23 |              8 s |         10 s |          435 |             34 |   3,2 GB |
| E4B `beispiele`, holdout            |       23 |             44 s |         78 s |          877 |            193 |   4,9 GB |
| E4B `beispiele`, dev (mehr Last)    |       46 |             78 s |        103 s |          880 |            198 |   4,9 GB |
| Regeln, Vornamen, Wörterbuch        |       46 |      unter 0,1 s |              |              |                |          |

**Für eine Klasse mit 25 Arbeiten kostet E2B etwa 9 min** auf einem Rechner wie simon-pc mit 4 Threads, auf einem schwachen 4-Kern-Laptop nach [Messung schwacher Rechner](../messung-schwacher-rechner.md) etwa das 1,5- bis 2-Fache. Die Erkennung des Personenbezugs läuft vor der Prüfansicht für alle Arbeiten, die Lehrkraft wartet also einmal und prüft dann. E2B braucht mit `--no-repack` 3,2 GB wie die Korrektur, es kann denselben Sidecar nutzen. E4B passt mit 4,9 GB nicht neben System und App auf 8 GB. Die Wörterbuchprüfung lief über hunspell auf simon-pc und ist nicht gezeitet, `spellbook` braucht laut [Lesefehler](2026-10-lesefehler.md) 7 µs je Wort.

## Grenzen

- **Die Lesefehler sind entweder zu gering oder geliehen.** Die gerenderten Seiten liest GLM-OCR fast fehlerfrei, echte Schülerhandschrift wird schlechter gelesen. Die synthetischen Lesefehler stammen aus Erwachsenenhandschrift (ScaDS) und treffen Namen so oft wie jedes andere Wort. Die Wahrheit für echte Hefte liegt zwischen `erkannt` und `rauschen`.
- **Wenige Fälle je Kategorie.** Orte, Einrichtungen, Nummern und vor allem sensible Angaben (22 auf dev, 8 im Holdout) sind zu selten für belastbare Prozente je Kategorie. Die Intervalle beim Hauptmaß sind breit (bei 23 Arbeiten etwa ±15 Prozentpunkte).
- **Eine Autorenfamilie.** Proben und Gold stammen aus einer Quelle (Sprachmodell, nachgelesen). Echte Schülertexte sind unordentlicher, haben mehr Namen von Mitschülern und weniger Briefköpfe. Echte Arbeiten wurden nicht verwendet.
- **Der Holdout ist kein unberührter Test für alles.** Prompt und Nachbearbeitung sind auf dev entwickelt und auf dem Holdout nur einmal gemessen. Die Vornamenliste und die Regeln entstanden aber mit Blick auf typische Fälle, die auch im Holdout vorkommen.
- **Überersetzung ist gegen Gold gemessen.** Ob ein ersetztes Wort die Korrektur oder die Bewertung verschlechtert, ist nicht gemessen.
- **Zeiten unter Last.** Eine Messung auf einem freien 4-Kern-Rechner fehlt, siehe [Zeit und Speicher](#zeit-und-speicher).

## Nachtrag: Gegenprobe der eingebauten Kette

Die Empfehlungen sind eingebaut (siehe [ADR 0011, Erkennung](../adr/0011-personenbezug-entfernen.md#erkennung)). Die Gegenprobe lässt die Kette der App selbst laufen, nicht die Bausteine der Messung: `eval/privacy-chain-run.ts` fragt E2B und E4B so, wie die App fragt (ganze Arbeit, Stücke bis 3000 Zeichen, Prompt `beispiele`), und `privacy-score.ts` mit der Option `app` spielt aus den gespeicherten Antworten `createDetectWork` mit allen Schichten nach, das Wörterbuch über `spellbook`. Lauf auf simon-pc, 4 Threads, nur CPU, ohne fremde Last.

**Holdout, 23 Arbeiten, Arbeiten ohne Leck (95-%-Intervall):**

| Kette                      | sauber                 | erkannt                | rauschen             | Vorkommen gefunden (sauber) | Überersetzung (sauber) | Figuren ersetzt | sensibel gefunden | Fehlalarme je Arbeit |
| -------------------------- | ---------------------- | ---------------------- | -------------------- | --------------------------: | ---------------------: | --------------: | ----------------: | -------------------: |
| Messung: E2B mit Schichten | 87 % (68 bis 95)       | 96 % (79 bis 99)       | 74 % (54 bis 87)     |                        98 % |                  5,4 % |           k. A. |              50 % |                 0,09 |
| **App: E2B**               | **100 % (86 bis 100)** | **100 % (86 bis 100)** | **78 % (58 bis 90)** |                       100 % |                  4,7 % |           24/32 |              50 % |                 0,09 |
| App: E2B und E4B           | 100 % (86 bis 100)     | 100 % (86 bis 100)     | 83 % (63 bis 93)     |                       100 % |                  4,9 % |           24/32 |             100 % |                 0,30 |

Auf dev (46 Arbeiten, sauber, nachgespielt aus den Antworten der ursprünglichen Läufe) erreicht die App mit E2B 98 % (89 bis 100), mit E2B und E4B 100 % (92 bis 100).

**Die App liegt über der Messung, aber der Holdout ist dafür nicht mehr unberührt.** Die Ergänzungen der Regelschicht zielen auf genau die Lecks, die dieser Bericht aus dem Holdout nennt („Bau-⏎er“, „Münster-Hiltrup“, „Gemeinde St. Johannes“), und die Kette wurde während der Arbeit mehrfach auf dem Holdout nachgespielt. Die 100 % sind deshalb eine Obergrenze. Belastbarer ist, dass dev nicht schlechter wurde und dass auf Text mit Lesefehlern dieselben zerlesenen Namen durchrutschen wie in der Messung.

**Zeit je Arbeit** (sauber, Median und 90-%-Quantil, simon-pc ohne fremde Last, 4 Threads): E2B 9 s und 14 s, E4B 14 s und 20 s, also das 1,5-Fache. Die erste Arbeit dauert länger (20 bzw. 35 s), weil der Prompt noch nicht im Cache liegt. Peak-RSS 3,4 GB (E2B) und 5,3 GB (E4B). Die Restdauer der App rechnet mit 15 s je Arbeit für E2B als Startwert, mit Luft für schwächere Rechner, und lernt danach.

Nachstellen:

```bash
node --experimental-transform-types eval/privacy-chain-run.ts --set holdout --conditions clean,ocr,noise1 --threads 4 --out ~/.cache/rotstift/eval/privacy/runs/chain-holdout
R=~/.cache/rotstift/eval/privacy/runs
node --experimental-transform-types eval/privacy-score.ts --set holdout --categories \
  --detector "App E2B=$R/chain-holdout-e2b.json:app" \
  --detector "App E2B und E4B=$R/chain-holdout-e2b.json+$R/chain-holdout-e4b.json:app"
```

## Nachtrag: Blinder Holdout

Der erste Holdout ist verbraucht: Die Regeln der Kette wurden auf seine Lecks geschrieben, die 100 % dort sagen darum wenig über neue Texte. Für eine ehrliche Zahl entstand ein zweiter Satz, `eval/samples/privacy-holdout2`, den beim Bauen der Kette niemand gesehen hat. Er wurde vor der ersten Messung geschrieben und danach nicht mehr an Texten oder Zielen verändert. Die Messung lief genau einmal, mit der Kette aus [ADR 0011](../adr/0011-personenbezug-entfernen.md#erkennung) unverändert (`eval/privacy-chain-run.ts`, E2B und E4B mit `beispiele`, auf simon-pc, 4 Threads, nur CPU, Rechner ohne fremde Last, 3,2 GB bzw. 4,9 GB Peak-RSS). Wer die Messung gemacht hat, hat weder `src/privacy` noch den Fehlerteil dieses Berichts gelesen.

**Satz:** 32 selbst geschriebene Schülertexte der Klassen 5 bis 10 (2704 Wörter, im Schnitt 85 je Arbeit), 140 Vorkommen von Kennungen (`person` 77, `place` 14, `institution` 14, `contact` 12, `date` 18, `number` 5), 37 zu behaltende Namen (`keep`) und 15 sensible Angaben. Neue Themen und Namen: Namen verschiedener Herkunft (ukrainisch, türkisch, vietnamesisch, nigerianisch, serbisch, arabisch), Spitz- und Kosenamen („Kaani“, „Mausi“, „Pummel“), Verschreibungen („Mohamad“ neben „Mohammed“, „Emily“ neben „Emmily“, klein geschriebenes „fynn“), Namen, die Wörter sind (Jung, Stein, Fuchs, Rose, Paris als Vorname neben Paris als Stadt), Namen über Zeilenumbruch („Anna-Lena Wie-⏎land“, „Annette-von-Droste-⏎Hülshoff-Gymnasium“), Briefköpfe, Vereine, Schulen, Praxen, Firmen, Handles, Telefon, Kennzeichen, IBAN, Kunden- und Bestellnummern, Daten mit und ohne Personenbezug (Frist einer Spendenaktion und 1989 stehen unmarkiert), Figuren und Prominente (Krabat, Rico, Möbius, Angela Merkel, Alexandra Popp), Namen aus der Aufgabe, dazu eine Arbeit ganz ohne Kennungen. Texte wie in der ersten Messung: `sauber`, `erkannt` (`render.py --heft --one-page`, GLM-OCR `glm-ocr-q8`) und `rauschen` (`ocr-noise.ts`, `noise1`).

**Gold-Korrekturen nach der ersten Auswertung.** Drei Markierungen waren falsch gesetzt, weil sie ein Rollenwort oder einen Titel mitmarkierten, was das Gold-Format ausschließt („Frau“, „Dr.“, „Opa“ gehören nicht zum Namen): `Frau [Brandes]` (h29), `Dr. [Winkelmann]` (h21) und `Opa [Gerhard]` (h27). Ein vierter Fall (`Frau Dahling`, h14) war schon vor der Messung korrigiert. Die Korrekturen betreffen nur diese Spannen, Texte und Aufgaben blieben unverändert. Vor den Korrekturen standen E2B bei 88 % (sauber), 81 % (erkannt), 72 % (rauschen) und E2B und E4B bei 88 %, 84 %, 72 %. Weitere Änderungen am Gold gab es nicht.

### Ergebnis

Anteil der Arbeiten ohne ein einziges durchgerutschtes Vorkommen einer Kennung (95-%-Intervall), 32 Arbeiten:

| Kette (eingebaut) |               sauber |    erkannt (GLM-OCR) |             rauschen |
| ----------------- | -------------------: | -------------------: | -------------------: |
| E2B               | **94 %** (80 bis 98) | **88 %** (72 bis 95) | **75 %** (58 bis 87) |
| E2B und E4B       | **94 %** (80 bis 98) | **91 %** (76 bis 97) | **75 %** (58 bis 87) |

Weitere Maße (Reihenfolge sauber, erkannt, rauschen):

| Kette       | Vorkommen gefunden | Überersetzung (Wörter) |     Figuren ersetzt | sensibel gefunden | sensible Fehlalarme je Arbeit | Zeit je Arbeit (Mittel) |
| ----------- | -----------------: | ---------------------: | ------------------: | ----------------: | ----------------------------: | ----------------------: |
| E2B         |   99 %, 96 %, 94 % |    4,6 %, 5,1 %, 9,6 % | 28/37, 28/37, 30/37 |  53 %, 47 %, 40 % |              0,38, 0,34, 0,47 |     8,0 s, 6,4 s, 8,0 s |
| E2B und E4B |   99 %, 98 %, 94 % |    4,5 %, 5,0 %, 9,5 % | 28/37, 28/37, 31/37 |  80 %, 80 %, 73 % |              0,84, 1,00, 0,84 |  21,1 s, 16,3 s, 21,0 s |

Die Zeiten sind Mittel je Arbeit auf simon-pc (Median bei `sauber` 7,7 s für E2B, 12,6 s für den Anteil von E4B), die Arbeiten sind mit 85 Wörtern kürzer als im ersten Holdout. Für eine Klasse mit 25 Arbeiten sind das etwa 3,5 min (E2B) und 9 min (E2B und E4B) auf einem Rechner wie simon-pc.

### Lecks nach Kategorie

Recall je Kategorie (Anzahl Vorkommen in Klammern), beide Ketten, sauber, erkannt, rauschen:

| Kategorie          | E2B                        | E2B und E4B                |
| ------------------ | -------------------------- | -------------------------- |
| `person` (77)      | 100 %, 100 %, 94 %         | 100 %, 100 %, 94 %         |
| `place` (14)       | 93 %, 86 %, 100 %          | 93 %, 93 %, 100 %          |
| `institution` (14) | 93 %, 86 %, 79 %           | 93 %, 93 %, 79 %           |
| `contact` (12)     | 100 % in allen drei Texten | 100 % in allen drei Texten |
| `date` (18)        | 100 %, 94 %, 94 %          | 100 %, 94 %, 94 %          |
| `number` (5)       | 100 % in allen drei Texten | 100 % in allen drei Texten |

Durchgerutschte Vorkommen, mit der Ausgabe von `privacy-score.ts --examples`:

- **`sauber`, beide Ketten (2 von 32 Arbeiten):** eine Einrichtung mit Berufsbezeichnung im Namen („Hausarztpraxis Dr. Berger“, `institution`) und ein Friedhof mit Ortsnamen („Friedhof Altenbochum“, `place`).
- **`erkannt`:** dieselben zwei, dazu „Samstag, 15.03.“ (`date`, Datum mit Wochentag am Zeilenanfang) in beiden Ketten. Nur E2B verpasst zusätzlich „Technikwelt⏎Hartmann GmbH“ (`institution`) und „Sporthalle⏎Am Hang“ (`place`), beide über einen Zeilenumbruch im Transkript, E4B findet sie.
- **`rauschen`, beide Ketten (8 von 32 Arbeiten):** fünf Personen, deren Name durch Lesefehler oder angeklebte Fremdbuchstaben entstellt ist („Bn Wilhelm“ für Ben Wilhelm, „iiiQhaaog“ für Quang, „fycnn“ für fynn, „ocSelin“ für Selin, „oParis“ für Paris als Vorname), drei Einrichtungen („Hausarztpraxis Dr. Berger“, „cTSst Hohenlimburg“ für TuS Hohenlimburg, „iKir-nchetmymeanl St. Marien“ für Kirchengemeinde St. Marien) und wieder „Samstag, 15.03.“.

**Die drei häufigsten Arten von Lecks:**

1. **Einrichtungen und Orte mit Eigennamen, die wie Alltagswörter aussehen oder zusammengesetzt sind** („Hausarztpraxis Dr. Berger“ in allen drei Texten, „Friedhof Altenbochum“, „Kirchengemeinde St. Marien“). Sie machen alle Lecks im sauberen Text aus.
2. **Lesefehler im Namen** (nur `rauschen`): fünf von 77 Personen, dazu drei Einrichtungen. Ein Namenslexikon und die Propagation greifen nicht mehr, wenn die Schreibweise des Namens entstellt ist.
3. **Mehrzeilige oder kombinierte Angaben im Transkript** (`erkannt`, E2B): Einrichtung und Ort über einen Zeilenumbruch und ein Datum mit Wochentag. E4B fängt davon zwei der drei auf.

Die Ursachen wurden nicht untersucht, der Detektor-Code ist von der Messung bewusst nicht gelesen worden. Die Einordnung ist deshalb eine Beschreibung der Fälle, keine Diagnose.

### Vergleich mit dem alten Holdout

| Kette       | Satz                                       |             sauber |            erkannt |         rauschen |
| ----------- | ------------------------------------------ | -----------------: | -----------------: | ---------------: |
| E2B         | alter Holdout (23), auf seine Lecks gebaut | 100 % (86 bis 100) | 100 % (86 bis 100) | 78 % (58 bis 90) |
| E2B         | blinder Holdout (32)                       |   94 % (80 bis 98) |   88 % (72 bis 95) | 75 % (58 bis 87) |
| E2B und E4B | alter Holdout (23), auf seine Lecks gebaut | 100 % (86 bis 100) | 100 % (86 bis 100) | 83 % (63 bis 93) |
| E2B und E4B | blinder Holdout (32)                       |   94 % (80 bis 98) |   91 % (76 bis 97) | 75 % (58 bis 87) |

- **Die 100 % des alten Holdouts waren nicht übertragbar.** Auf unbekannten Texten verliert die Kette bei `sauber` 6 Prozentpunkte, bei `erkannt` 9 bis 12 und bei `rauschen` 3 bis 8. Die Intervalle überlappen, bei 23 und 32 Arbeiten ist der Unterschied für sich nicht gesichert. Die Richtung ist aber eindeutig: Die Obergrenze der Kette liegt bei etwa 9 von 10 Arbeiten ohne Leck, nicht bei 10 von 10.
- **Bei `rauschen` ändert sich wenig** (78 und 83 % gegen 75 %). Dort lag die Kette auch im alten Holdout nicht bei 100 %, es ist der ehrlichere Maßstab für Handschrift.
- **Vorkommen gefunden** liegt bei 94 bis 99 % statt 100 %, die Überersetzung bei 4,5 bis 5,1 % (sauber, erkannt) und damit gleich wie vorher (4,7 und 4,9 %). Namen aus Werken und Prominente werden weiter in drei von vier Fällen ersetzt (28/37 gegen 24/32).
- **Sensible Angaben** werden mit E2B in 53 % gefunden (vorher 50 %), mit E2B und E4B in 80 % (vorher 100 %, bei 15 Angaben gegen 8 ist das ein Unterschied von drei Fällen). Die sensiblen Fehlalarme sind mit 0,38 bzw. 0,84 je Arbeit deutlich höher als vorher (0,09 und 0,30). Sensible Angaben werden nur gewarnt, die Prüfansicht zeigt jede Warnung.
- **Zeit:** E2B braucht mit 8 s je Arbeit nicht länger als beim ersten Holdout (10 s), die Arbeiten sind aber im Schnitt kürzer.

### Grenzen dieser Messung

- **Dieselbe Autorenfamilie.** Der Satz ist blind gegenüber den Detektoren, nicht gegenüber dem Stil: Er wurde wie dev und der erste Holdout von einem Sprachmodell geschrieben, nach demselben Format. Echte Schülertexte sind unordentlicher, die Zahl ist eher eine Obergrenze.
- **Kleine Zahlen.** Bei 32 Arbeiten und 140 Vorkommen ist das Intervall etwa ±15 Prozentpunkte, bei den sensiblen Angaben (15) und je Kategorie noch breiter.
- **Der Satz ist jetzt auch verbraucht.** Wer die Lecks oben in die Regeln übernimmt, braucht einen dritten Satz für die nächste Zahl.
- **Gerenderte Seiten.** `erkannt` liest GLM-OCR auf den gerenderten Heftseiten fast fehlerfrei (alle Namen richtig), die Wahrheit für echte Hefte liegt zwischen `erkannt` und `rauschen`.

```bash
R=~/.cache/rotstift/eval/privacy/runs
node --experimental-transform-types eval/privacy-chain-run.ts --set eval/samples/privacy-holdout2 --threads 4 --out $R/chain-holdout2
node --experimental-transform-types eval/privacy-score.ts --set eval/samples/privacy-holdout2 --categories \
  --detector "E2B=$R/chain-holdout2-e2b.json:app" \
  --detector "E2B und E4B=$R/chain-holdout2-e2b.json+$R/chain-holdout2-e4b.json:app"
```

Das Transkript muss als `ocr-privacy-holdout2.json` in `~/.cache/rotstift/eval/privacy` liegen (`ocr-run.ts` mit `glm-ocr-q8` auf den mit `render.py --heft --one-page` gerenderten Seiten, wie für dev und Holdout).

## Nachtrag: Lektüreliste und Lesefehler

Der blinde Holdout zeigte drei Arten von Lecks (Einrichtungen mit Eigennamen, zerlesene Namen, Daten im Briefkopf) und eine hohe Überersetzung bei Figuren und Prominenten. Die Kette bekam dafür neue Regeln und eine Liste der Schullektüre, beschrieben in [ADR 0011](../adr/0011-personenbezug-entfernen.md#schichten). Das Modell und sein Prompt blieben unverändert.

**Satz:** Alle drei bisherigen Sätze zusammen als dev, also `privacy/dev` (46), `privacy/holdout` (23) und `privacy-holdout2` (32), 101 Arbeiten mit 523 Vorkommen von Kennungen und 180 zu behaltenden Namen. Keiner dieser Sätze ist mehr blind, die Zahlen unten sind Entwicklungszahlen. Gemessen wird blind auf einem dritten Satz, der hier nicht vorkommt.

**Verfahren:** Iteriert wurde auf der GPU von simon-pc (llama.cpp-Image `server-cuda-b11552`, das sich von b11551 nur im Umgang mit parallelen Anfragen unterscheidet). Die Schlussmessung lief auf simon-pc nur auf der CPU (Ryzen 7 5700X, 4 Threads, `-ngl 0 --device none`) mit dem llama-server der App, b11551 (Commit 69f201a20, wie in `scripts/runtime/manifest.ts`). Da der Prompt gleich bleibt, bekommt das Modell vorher und nachher dieselben Eingaben. Ein Lauf liefert die Antworten, `privacy-score.ts` spielt daraus die Kette von main (vorher) und die neue Kette (nachher) nach. 163 von 165 Antworten stimmten mit einem älteren CPU-Lauf von main überein.

### Ergebnis

Anteil der Arbeiten ohne ein einziges durchgerutschtes Vorkommen einer Kennung (95-%-Intervall), E2B, 101 Arbeiten:

| Kette   |                 sauber |     erkannt (GLM-OCR) |             rauschen |
| ------- | ---------------------: | --------------------: | -------------------: |
| vorher  |   **97 %** (92 bis 99) |  **95 %** (89 bis 98) | **74 %** (65 bis 82) |
| nachher | **100 %** (96 bis 100) | **99 %** (95 bis 100) | **85 %** (77 bis 91) |

Weitere Maße (Reihenfolge sauber, erkannt, rauschen):

| Kette   | Vorkommen gefunden | Überersetzung (Wörter) |           Figuren ersetzt | sensibel gefunden | Kette ohne Modell (CPU) |
| ------- | -----------------: | ---------------------: | ------------------------: | ----------------: | ----------------------: |
| vorher  |   99 %, 99 %, 94 % |    4,9 %, 5,2 %, 9,6 % | 136/180, 140/180, 148/180 |  51 %, 51 %, 31 % |                 0,42 ms |
| nachher | 100 %, 100 %, 97 % |    1,2 %, 1,4 %, 7,8 % |      6/180, 6/180, 53/180 |  51 %, 51 %, 31 % |                  9,6 ms |

- **Lecks:** Bei `sauber` bleibt keines, bei `erkannt` eines („Samstag, 15.03.“, das Gold markiert hier den Wochentag mit). Bei `rauschen` bleiben 15 Arbeiten mit Leck, fast alle durch stark zerlesene Namen („ksieiouon“, „fdldiöx“, „Zey(nep“, „lllly“), die weder Liste noch Wörterbuch noch Modell als Namen erkennen können. Dazu kommen Namen, die zugleich Wörter sind, ohne einen Hinweis im Satz („Sonne“, „Paris“).
- **Überersetzung:** Bei `sauber` und `erkannt` sinkt sie auf rund ein Viertel. Figuren und Prominente bleiben fast alle stehen. Ersetzt werden noch Namen mit Partikel ohne Vornamen („von Walter“, „van Pels“) und ein Café, das in der Aufgabe steht. Bei `rauschen` werden Figuren weiter in rund einem Drittel der Fälle ersetzt, weil ihr Name zerlesen nicht mehr in der Liste steht.
- **Recall je Kategorie** (`rauschen`): Person 92 → 94 %, Ort 96 → 100 %, Einrichtung 92 → 100 %, Datum 95 → 98 %.
- **Sensible Angaben** sind unverändert, sie kommen nur vom Modell.
- **Last:** Kein neues Modell, kein zusätzlicher Arbeitsspeicher (Peak-RSS 3,2 GB). Modell und Prompt sind unverändert, die Zeit des Modells also auch. Neu ist nur die Verarbeitung in TypeScript. Ihre CPU-Zeit (`process.cpuUsage()`, Median je Arbeit über 303 Texte und 5 Durchgänge nach dem Aufwärmen, Antworten des Modells aus dem Lauf wiedergegeben, auf dem Mac ohne laufendes llama) steigt von 0,42 ms auf 9,6 ms. Gegenüber 8,0 s für E2B je Arbeit auf simon-pc mit 4 Threads (blinder Holdout) sind das rund 0,1 % mehr. Die Zeit des Modells selbst ließ sich in diesem Lauf nicht sauber messen, weil simon-pc ab etwa der Hälfte fremd ausgelastet war.

### Überanpassung

Die Zahlen sind auf denselben 101 Arbeiten entstanden, an denen die Regeln geschrieben wurden, und sind darum eine Obergrenze.

- **Die Lektüreliste deckt alle Werke der Proben ab.** Rund hundert Werke sind mehr als die Proben brauchen, aber jedes Werk der Proben steht darin. Eine Inhaltsangabe zu einem Werk, das fehlt, wird wie vorher überersetzt. Ein zu Unrecht behaltener Name geht dagegen nur hinaus, wenn das Werk genannt ist und der Name zufällig wie eine Figur heißt.
- **Die Liste der Nachnamen, die zugleich Wörter sind** (rund 250), enthält alle solchen Namen der Proben. Die Proben wurden nach einer Vorgabe geschrieben, die genau diese Art Namen verlangt.
- **Mehrere Regeln zielen auf einzelne Lecks** des blinden Holdouts (Praxis mit „Dr.“, Friedhof mit Ortsnamen, Firma über einen Zeilenumbruch, „St. Marien“ mit Lesefehlern). Sie sind allgemein formuliert, der Gewinn auf neuen Texten ist aber kleiner als hier.
- **Am wenigsten angepasst** sind die Verbesserungen bei `rauschen`: Lesefehler-Präfixe, Lücken in Namen und Komposita folgen aus der Verteilung von `ocr-noise.ts`, nicht aus einzelnen Fällen.

Ehrlich erwartet wird auf neuen Texten ein Gewinn bei `rauschen` von einigen Prozentpunkten und eine deutlich kleinere Überersetzung bei bekannter Lektüre. Die 100 % bei `sauber` werden sich nicht halten.

```bash
R=~/.cache/rotstift/eval/privacy/runs
node --experimental-transform-types eval/privacy-chain-run.ts --set dev,holdout,eval/samples/privacy-holdout2 --models gemma-4-e2b-q4 --threads 4 --out $R/chain-all
node --experimental-transform-types eval/privacy-score.ts --set dev,holdout,eval/samples/privacy-holdout2 --categories \
  --detector "E2B=$R/chain-all-e2b.json:app"
```

## Nachstellen

Die Befehle stehen in [eval/README.md](../../eval/README.md#personenbezug-erkennen). Transkripte und Läufe liegen in `~/.cache/rotstift/eval/privacy` und sind nicht eingecheckt, die Heftbilder erzeugt `render.py` bei Bedarf neu. Für die Holdout-Tabelle:

```bash
R=~/.cache/rotstift/eval/privacy/runs
node --experimental-transform-types eval/privacy-score.ts --set holdout --categories \
  --detector "E2B, Kern, Vornamen, Wörterbuch=$R/e2b-beispiele-holdout.json+$R/app-holdout.json+$R/rules-names-holdout.json+$R/dict-cap-holdout.json:post:fuzzy"
```
