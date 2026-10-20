# Evaluation: Fehlalarme durch Lesefehler der Texterkennung (Oktober 2026)

Frage: Wie viele Markierungen setzt „Berichtigen“ auf fehlerfreier Handschrift, weil GLM-OCR falsch liest und Gemma 4 E2B den Lesefehler korrigiert, und welche Gegenmittel senken das auf höchstens 1 Fehlalarm je 100 Wörter, ohne echte Schülerfehler deutlich öfter zu übersehen?

## Ergebnis

ERGEBNIS

## Empfehlung

EMPFEHLUNG

## Messergebnisse

MESSERGEBNISSE

## Methode

- **Fehlalarme:** 20 Seiten (000 bis 019) aus dem [ScaDS.AI German Handwriting Full-Page Dataset](https://doi.org/10.5281/zenodo.18283705) (Thomas Burghardt, Till Nestler, CC BY 4.0), Erwachsenenhandschrift mit Wikipedia-Auszügen, 1981 Wörter laut Ground Truth. Die Seiten werden wie in der App verkleinert (`eval/resize-pages.py`, längste Kante `imageMaxEdge`, JPEG-Qualität 90), mit GLM-OCR (Q8_0) und dem Registry-Prompt erkannt, mit `splitTranscript` in Zeilen zerlegt und mit `correctPage` und `createLlmCorrector` aus `src/correction` (System-Prompt aus `src-tauri/models.json`, Reparaturrunde wie in der App) korrigiert. Jede Markierung zählt als Fehlalarm, denn die Vorlage enthält keine Fehler, außer wo die Ground Truth selbst falsch ist (siehe unten).
- **Ursache je Fehlalarm:** `eval/ocr-attribution.ts` richtet die Tokens von Erkennung und Ground Truth per Wort-Levenshtein aus (Tokenisierung aus `src/correction/tokens.ts`). Sind alle Wörter unter einer Markierung exakt richtig gelesen, ist es ein **Korrektor-Fehlalarm**, sonst ein **Lesefolgefehler**. Bei Auslassungen entscheiden die beiden Nachbarwörter.
- **Ground Truth geprüft:** hunspell (de_DE) über alle 20 Seiten, danach von Hand. Sieben Wörter auf vier Seiten sind Abschreibfehler der Vorlage („Weltrangl“, „lönig(in)“, „tirbt“, „rsprungsversionen“, „asmsp“, „Selbstbewussth“, „Demographei“). Markierungen, die eines davon berühren, zählen nicht als Fehlalarm, sondern als „Vorlage fehlerhaft“ (`eval/ocr-truth-slips.ts`). Die Zeichenfehlerrate enthält sie noch, das macht weniger als 0,5 Prozentpunkte aus.
- **Recall:** (a) Die vier selbst geschriebenen Schülertexte (511 Wörter, 43 Fehler) getippt und dieselben Texte korrigiert als fehlerfreier Vergleich. (b) Dieselben Texte mit simuliertem Leserauschen (`eval/ocr-noise.ts`): Anteil falsch gelesener Wörter und die Zeichenänderungen werden aus den 20 GLM-OCR-Seiten gelernt und mit drei Seeds auf die Texte angewandt. Eine verrauschte Fehlerstelle zählt nicht mehr als erreichbar. (c) Die 16 gerenderten Seiten derselben Texte in vier Handschrift-Fonts, echt mit GLM-OCR erkannt, also mit echter Lesesicherheit. Die Soll-Marken werden mit `remapGold` auf das Transkript übertragen.
- **Lesesicherheit:** `ocr-run.ts` fordert zusätzlich `logprobs: true` an. llama-server liefert je erzeugtem Token Bytes und Log-Wahrscheinlichkeit. `src/correction/reading-confidence.ts` ordnet daraus jedem Zeichen der Zeilen die Wahrscheinlichkeit seines Tokens zu (UTF-8-genau) und nimmt je Wort das Minimum. Eine Markierung, deren berührte Wörter (bei Auslassungen die Nachbarwörter) unter der Schwelle liegen, wird zum Hinweis „unsicher gelesen“ statt zur Fehlermarke. Hinweise zählen nicht als Fehlalarm, werden aber getrennt ausgewiesen.
- **Wörterbuch:** hunspell mit `dictionary-de` 3.0.0 (igerman98 von Björn Jacke, GPL-2.0 OR GPL-3.0, `index.dic` 1,1 MB, `index.aff` 19 KB). Eine Markierung wird verworfen, wenn ihre Korrektur ein Wort enthält, das das Wörterbuch nicht kennt (bei Bindestrichwörtern genügt es, wenn alle Teile bekannt sind).
- **Prompt-Varianten (`eval/ocr-prompts.ts`):** `app` ist der System-Prompt aus der Registry. `ocr` ergänzt: Der Text stammt aus einer automatischen Handschrifterkennung, kein Wort durch ein Nicht-Wort ersetzen, unbekannte Namen, Fach- und Fremdwörter unverändert lassen. `strict` ergänzt zusätzlich: nur eindeutige Fehler korrigieren, im Zweifel unverändert.
- **Denken:** Die App schickt Gemma keinen Schalter für das Denken. Alle Varianten laufen deshalb mit `chat_template_kwargs: {enable_thinking: false}`; der App-Request (mit Denken) läuft einmal zum Vergleich.
- **Qwen3-VL 4B:** dieselben 20 Seiten mit dem Registry-Eintrag `qwen3-vl-4b-q4` (Bildkante 1536, `--image-max-tokens 1024`), danach Gemma mit allen drei Prompts.
- **Intervalle:** Wilson, 95 %. Bei Fehlalarmen je 100 Wörter ist die Grundgesamtheit die Wortzahl der Ground Truth (nur gültige Seiten), Markierungen werden wie unabhängige Ereignisse behandelt. Die Intervalle sind daher eher zu eng.
- **Rechner:** simon-pc (AMD Ryzen 7 5700X, 8 Threads, nur CPU: `--n-gpu-layers 0 --device none`, llama.cpp `b11537` wie im App-Bundle, Fedora 44). Der Rechner wird nebenher genutzt (Load Average 1 bis 9), die Sekunden sind daher Obergrenzen. Kontrolllauf auf dem Mac (Apple M4 Pro) nur für Zeiten.

Reproduzieren: siehe [eval/README.md](../../eval/README.md#lesefehler-der-texterkennung). Datensatzbilder, Transkripte und Modellausgaben bleiben außerhalb des Repos.

## Grenzen

GRENZEN
