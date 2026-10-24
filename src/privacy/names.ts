import { editDistance } from '../correction/edit-distance.ts';
import { COMMON_WORDS } from './common-words.ts';
import type { UnknownWords } from './dictionary.ts';
import { isFirstName } from './first-names.ts';
import { buildSearchText, toSpans, type CategorizedRange } from './search-text.ts';
import type { Detector, IdentifierSpan } from './types.ts';
import { WORD_SURNAMES } from './word-surnames.ts';

const NOT_NAMES: ReadonlySet<string> = new Set(
  `
aufsatz aufsätze klassenarbeit klassenarbeiten klausur klausuren arbeit arbeiten test tests hausaufgabe hausaufgaben
ha ka sa ex lzk kt lk gk ag ef lernzielkontrolle lernkontrolle kurzkontrolle leistungskontrolle stegreifaufgabe
schulaufgabe diktat nachschrift nachschreiber übung uebung aufgabe aufgaben lösung loesung blatt arbeitsblatt seite
seiten page pages teil kopie copy scan scans img image bild foto photo dsc pxl dokument document datei file entwurf
final neu new version korrektur korrigiert berichtigung verbesserung abgabe deutsch englisch mathe mathematik bio
biologie geschichte erdkunde geo geographie physik chemie kunst musik religion reli ethik politik sowi sozialkunde
latein französisch franzoesisch spanisch informatik sport wirtschaft gesellschaftslehre gl nawi naturwissenschaften
klasse kl jahrgang jg stufe kurs gruppe erörterung eroerterung inhaltsangabe bericht brief email mail protokoll
referat essay analyse interpretation zusammenfassung beschreibung bildbeschreibung vorgangsbeschreibung
personenbeschreibung charakterisierung erzählung erzaehlung erlebniserzählung erlebniserzaehlung märchen maerchen
fabel gedicht gedichtanalyse sachtext stellungnahme kommentar rezension tagebuch tagebucheintrag steckbrief
vorstellung leserbrief bewerbung lebenslauf praktikumsbericht unfallbericht argumentation fantasiegeschichte
reizwortgeschichte bildergeschichte nacherzählung nacherzaehlung text texte und von der die das den dem des mit für
fuer zu zum zur am im an in auf aus bei nach vor ohne plus vom name vorname nachname schüler schülerin schueler
schuelerin student studentin lehrer lehrerin frau herr januar februar märz maerz april mai juni juli august september
oktober november dezember montag dienstag mittwoch donnerstag freitag samstag sonntag heft schulheft ordner
`
    .split(/\s+/u)
    .filter(Boolean),
);

const EXTENSION = /\.[\p{L}\p{N}]{1,5}$/u;
const NAME_PART = /^\p{L}+$/u;

export function namesFromWorkName(workName: string): string[] {
  let base = workName.split(/[/\\]/u).at(-1) ?? '';
  while (EXTENSION.test(base)) base = base.replace(EXTENSION, '');
  const parts = base
    .replaceAll(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => NAME_PART.test(part) && part.length >= 2)
    .filter((part) => !NOT_NAMES.has(part.toLocaleLowerCase('de')));
  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = part.toLocaleLowerCase('de');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fold(text: string): string {
  return text
    .toLocaleLowerCase('de')
    .replaceAll('ß', 'ss')
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '');
}

function allowedDistance(name: string): number {
  if (name.length >= 7) return 2;
  if (name.length >= 4) return 1;
  return 0;
}

function isFuzzyMatch(word: string, name: string): boolean {
  const allowed = allowedDistance(name);
  if (allowed === 0) return false;
  if (!/^\p{Lu}/u.test(word)) return false;
  const folded = fold(word);
  if (folded.charAt(0) !== name.charAt(0)) return false;
  if (COMMON_WORDS.has(word.toLocaleLowerCase('de'))) return false;
  if (Math.abs(folded.length - name.length) > allowed) return false;
  return editDistance(folded, name) <= allowed;
}

function matchLength(word: string, names: readonly string[]): number {
  const folded = fold(word);
  const stem = word.length > 2 && word.endsWith('s') ? word.slice(0, -1) : null;
  if (names.includes(folded)) return word.length;
  if (stem !== null && names.includes(fold(stem))) return stem.length;
  if (names.some((name) => isFuzzyMatch(word, name))) return word.length;
  if (stem !== null && names.some((name) => isFuzzyMatch(stem, name))) return stem.length;
  return 0;
}

export function findNameSpans(
  lines: readonly string[],
  names: readonly string[],
): IdentifierSpan[] {
  const folded = [...new Set(names.map(fold).filter((name) => name.length >= 2))];
  if (folded.length === 0) return [];
  const search = buildSearchText(lines);
  const ranges: CategorizedRange[] = [];
  for (const match of search.text.matchAll(/\p{L}+/gu)) {
    const length = matchLength(match[0], folded);
    if (length === 0) continue;
    const start = match.index;
    const last = ranges.at(-1);
    if (last !== undefined && /^[ \t\n-]+$/u.test(search.text.slice(last.end, start))) {
      ranges[ranges.length - 1] = { ...last, end: start + length };
    } else {
      ranges.push({ start, end: start + length, category: 'person' });
    }
  }
  return ranges.flatMap((range) => toSpans(search, range, 'name-list'));
}

export const detectNames: Detector = async (lines, context, signal) => {
  signal.throwIfAborted();
  return findNameSpans(lines, namesFromWorkName(context.workName));
};

function spellings(part: string): string[] {
  const umlauts = part.replaceAll('ae', 'ä').replaceAll('oe', 'ö').replaceAll('ue', 'ü');
  return [
    ...new Set(
      [part, umlauts].flatMap((word) => {
        const lower = word.toLocaleLowerCase('de');
        return [word, lower, lower.charAt(0).toLocaleUpperCase('de') + lower.slice(1)];
      }),
    ),
  ];
}

export async function topicWords(
  parts: readonly string[],
  unknownWords: UnknownWords,
  signal: AbortSignal,
): Promise<Set<string>> {
  const candidates = parts.filter(
    (part) =>
      part.length >= 3 && !isFirstName(part) && !WORD_SURNAMES.has(part.toLocaleLowerCase('de')),
  );
  if (candidates.length === 0) return new Set();
  const unknown = await unknownWords([...new Set(candidates.flatMap(spellings))], signal);
  return new Set(candidates.filter((part) => spellings(part).some((form) => !unknown.has(form))));
}

export function createNamesDetector(unknownWords: UnknownWords): Detector {
  return async (lines, context, signal) => {
    signal.throwIfAborted();
    const names = namesFromWorkName(context.workName);
    const topics = await topicWords(names, unknownWords, signal);
    return findNameSpans(
      lines,
      names.filter((name) => !topics.has(name)),
    );
  };
}
