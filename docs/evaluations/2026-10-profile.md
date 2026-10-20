# Evaluation: Korrekturprofile Französisch, Spanisch und Sachfach (Oktober 2026)

Frage: Markiert Gemma 4 E2B (Q4_0) in Französisch, Spanisch und in deutschen Sachfachtexten ähnlich gut wie in Deutsch und Englisch? Gemessen wird die App-Kette ab dem Text: Prompt aus `src-tauri/models.json`, `createLlmCorrector`, `correctPage` und `deriveMarks`, mit den neuen Profilen aus `src/annotations/profile.ts`. Die Texterkennung ist nicht Teil der Messung, der Eingabetext ist der geschriebene Text.

## Ergebnis

**Spanisch liegt auf dem Niveau von Deutsch und Englisch, Sachfach etwas darunter bei sehr wenigen Fehlern, Französisch klar darunter.** Die Zahlen stammen von je vier selbst geschriebenen Schülertexten mit eingebauten Fehlern (je ein Lauf, Temperatur 0).

| Profil      | Soll-Fehler | Recall (Stelle)            | Recall (Art und Stelle) | Precision (Stelle) | Fehlalarme je 100 Wörter | Seiten ohne Ergebnis |
| ----------- | ----------: | -------------------------- | ----------------------: | -----------------: | -----------------------: | -------------------: |
| Deutsch     |          43 | 88,4 % (75,5 bis 94,9)     |                  86,0 % |            100,0 % |                      0,0 |                  0/8 |
| Englisch    |          37 | 94,6 % (82,3 bis 98,5)     |                  75,7 % |             87,5 % |                      0,6 |                  0/8 |
| Spanisch    |          43 | 88,4 % (75,5 bis 94,9)     |                  83,7 % |             95,0 % |                      0,0 |                  0/8 |
| Französisch |          41 | **63,4 %** (48,1 bis 76,4) |                  51,2 % |             96,3 % |                      0,9 |              **1/8** |
| Sachfach    |          16 | **68,8 %** (44,4 bis 85,8) |                  62,5 % |            100,0 % |                      0,0 |                  0/4 |

- **Recall (Stelle):** Anteil der eingebauten Fehler, auf die eine Marke trifft (Textstelle überschneidet sich, Art egal). **Art und Stelle** verlangt zusätzlich dieselbe Art, **Precision (Stelle)** ist der Anteil der Marken, die auf einem eingebauten Fehler liegen. Die Fehlalarme zählen Marken auf den korrigierten Fassungen derselben Texte. Intervalle: Wilson, 95 %.
- Deutsch ist dieselbe Messung wie in [2026-10-fehlermarkierung.md](2026-10-fehlermarkierung.md) (86,0 % bei Art und Stelle, 97,4 % Precision), sie reproduziert den dortigen Wert und prüft damit den Aufbau.
- Die Texte unterscheiden sich je Sprache (mehr Grammatikfehler in Französisch und Spanisch als im deutschen Satz, der fast nur Rechtschreibung enthält). Die Werte sind darum nur grob vergleichbar. Die Intervalle von Spanisch und Deutsch decken sich fast vollständig, das von Französisch liegt am oberen Rand unter dem Deutschen.
- Wegen 16 Fehlern ist Sachfach kaum aussagekräftig, das Intervall reicht von 44 bis 86 %.

**Art der Marke:** Der Abstand zwischen „Stelle“ und „Art und Stelle“ liegt fast nur an der Einordnung. Das Modell korrigiert den Text, die Art leitet `classifyWordChange` aus dem Wortvergleich ab. Selbst bei einer perfekten Korrektur erreichen Französisch 35 von 41, Spanisch 42 von 43 und Sachfach 14 von 16 Marken die vorgesehene Art (Test `eval/profiles.test.ts`). Typische Verwechslungen: Ein fehlendes End-e oder -s („histoir“, „Beaucoups“) ist G statt R, ein Hilfsverbwechsel („est“ statt „a“) und unregelmäßige Verbformen werden zu W. Die Korrektur selbst ist in jedem Fall richtig, in dem Art und Stelle stimmen.

### Nach Art des Fehlers

Gefunden von Soll (in Klammern: davon in der richtigen Art). Wo nichts in Klammern steht, stimmt die Art in allen gefundenen Fällen.

| Art                     | Deutsch    | Englisch  | Französisch | Spanisch   | Sachfach |
| ----------------------- | ---------- | --------- | ----------- | ---------- | -------- |
| Rechtschreibung (R, sp) | 28/28 (27) | 10/10     | 8/10 (4)    | 17/17 (16) | 7/9 (6)  |
| Zeichensetzung (Z, p)   | 8/9        | 10/10     | 6/9         | 10/11      | 2/4      |
| Grammatik (G, gr)       | 2/6        | 13/13 (6) | 11/18       | 10/11 (9)  | 2/3      |
| Wortwahl (W, voc)       | -          | 2/4       | 1/4 (0)     | 1/4        | -        |

Wortwahl ist die Schwäche: Das Modell lässt Wörter wie „gymnase“ statt „collège“ oder „mirar“ statt „buscar“ stehen, weil sie in sich stimmig sind. T, M und Präp (Zeitform, Modus, Präposition) fehlen in der Tabelle, weil der Wortvergleich sie nicht von G trennt: Sie kommen als G oder R an.

### Französisch

**Eine von vier Seiten bekommt kein Ergebnis.** Beim Text „vacances“ fasst das Modell zwei Zeilen zusammen, verschiebt damit alle folgenden Nummern, und die Reparaturrunde liefert dieselbe Antwort (Temperatur 0). Die App zeigt „Die Antwort des Modells enthält nicht alle Zeilen“. Auf den übrigen drei Seiten treffen 26 von 30 Fehlern (86,7 %), das entspricht Deutsch. Mit vier Seiten ist unklar, wie häufig das passiert. In Deutsch, Englisch und Spanisch trat es bei 24 Seiten nicht auf. Eine robustere Behandlung zusammengezogener Zeilen wäre ein eigenes Thema und steht nicht in diesem PR.

Die Fehlalarme (3 Marken auf 334 Wörtern) sind eine großgeschriebene „Tour Eiffel“, ein ergänzter Punkt am Zeilenende (das Modell liest den Umbruch als Satzende) und ein gestrichenes Komma.

## Aufbau

- **Texte:** `eval/samples/profiles/<fr|es|en|sachfach>/*.txt`, selbst geschrieben, je vier (Sachfach zwei: Geschichte, Biologie) mit eingebauten Fehlern im Format `{geschrieben|richtig|Art}`. Art ist R, Z, G oder W (englisch sp, p, gr, voc). Keine Arbeiten von Schülerinnen und Schülern. Deutsch sind die vorhandenen Texte unter `eval/samples/texts`.
- **Lauf:** `node --experimental-transform-types eval/profiles.ts --set fr --out <Datei>` (`--set` fr, es, en, de, sachfach; `--variant plain` lässt den Spracheintrag im Prompt weg). Der Server startet wie in der App (4 Threads, nur CPU, `--no-repack`, `--reasoning off`, Kontext 4096), Mac mit M4 Pro. Peak-RAM 3,3 bis 3,4 GB, 4 bis 8 s je Seite (der Rechner war durch andere Aufgaben ausgelastet).
- **Bewertung:** `scorePage` aus `eval/mark-metrics.ts`, wie in der Fehlermarkierung.
- **Obergrenze der Einordnung:** `eval/profiles.test.ts` wendet eine perfekte Korrektur an und prüft, dass jede Marke an der richtigen Stelle landet.

## Änderungen durch die Messung

1. **Der Prompt nennt die Sprache.** Die Registry (`src-tauri/models.json`) sagt jetzt „Der Text ist auf {language} geschrieben“ und „Beachte die Regeln der Sprache des Textes, auch Akzente und Satzzeichen. Fachwörter, Namen und Zitate bleiben unverändert.“ Ohne diese Sätze (`--variant plain`) lag Spanisch bei 86,0 % statt 88,4 %, Sachfach bei 62,5 % statt 68,8 % (Recall, Stelle), Deutsch, Englisch und Französisch änderten sich nicht (Englisch hat dafür zwei Fehlalarme, 0,6 je 100 Wörter). Alle Unterschiede liegen innerhalb der Intervalle, der Satz kostet nichts.
2. **`¿` und `¡` stehen vor dem nächsten Wort.** `deriveMarks` hängte fehlende Satzzeichen an das vorige Wort. Das passt zu Komma und Punkt, aber nicht zu öffnenden Zeichen: Das fehlende `¿` einer Frage am Zeilenanfang landete am Ende der Vorzeile. Öffnende Zeichen (`¿ ¡ « „ ( [`) gehören jetzt vor das folgende Wort, auch über Zeilengrenzen.
3. **Wortformen für Französisch und Spanisch.** `classifyWordChange` kennt Endungen, Artikel, Pronomen, Hilfsverben und Präpositionen beider Sprachen. Fehlende oder falsche Akzente sind R (`gateau` zu `gâteau`), Formen mit demselben Stamm sind G.

## Empfehlung

- **Spanisch:** anbieten, wie Deutsch und Englisch.
- **Sachfach:** anbieten. Es markiert nur R, Z und G und hat bei 16 Fehlern und 207 fehlerfreien Wörtern keinen Fehlalarm gesetzt. Vor allem Rechtschreibung von Fachwörtern und Namen wird gefunden (6 von 9), Grammatik und Zeichensetzung seltener. Die Stichprobe ist zu klein für mehr als „funktioniert plausibel“.
- **Französisch:** mit Einschränkung anbieten, etwa als „Vorschau“. Die Marken stimmen (Precision 96 %), es werden aber nur gut zwei Drittel der Fehler gefunden, Wortwahl praktisch nie, und eine Seite von vier bekam kein Ergebnis. Die Lehrkraft sieht also eher zu wenig als falsche Marken. Wer das nicht will, lässt Französisch weg, bis eine größere Messung mit echten Seiten besser ausfällt (dann auch das Zeilenproblem klären).
- **Weitere Messung:** Mehr und längere Texte je Sprache, vor allem Französisch und Sachfach, und Texte, die die Texterkennung wirklich liefert (Akzente und `¿` sind für die Erkennung eine eigene Fehlerquelle, hier nicht gemessen).
