import { taskWords } from './first-names.ts';
import { buildSearchText, toSpans } from './search-text.ts';
import type { Detector, IdentifierSpan } from './types.ts';

export type UnknownWords = (
  words: readonly string[],
  signal: AbortSignal,
) => Promise<ReadonlySet<string>>;

const WORD = /(?<![\p{L}\p{N}])(?:\p{Ll}{1,3}(?=\p{Lu}))?\p{Lu}[\p{L}'’]*/gu;

const FACILITY = new RegExp(
  String.raw`(?<![\p{L}])\p{L}*(?:praxis|kanzlei|apotheke|klinik|klinikum|krankenhaus|friedhof|autohaus|bäckerei|metzgerei|gärtnerei|werkstatt|café|cafe|restaurant|hotel|pension|reiterhof|kino|studio|salon|laden|markt|zentrum|halle|bad|stadion|gemeinde|kirche|firma)\s+$`,
  'iu',
);
const HOUSE_NUMBER = /^\s?\d{1,4}\s?[a-z]?(?![\p{L}\p{N}])/u;

export function wordForms(word: string): string[] {
  const bare = word.replace(/['’]s?$/u, '');
  const lower = bare.toLocaleLowerCase('de');
  const forms = [bare, lower, bare.charAt(0) + lower.slice(1)];
  if (bare.endsWith('s')) forms.push(bare.slice(0, -1));
  return [...new Set(forms)];
}

const NOT_NAMES: ReadonlySet<string> = new Set(
  `instagram insta tiktok snapchat whatsapp youtube youtuber netflix spotify twitch discord fortnite minecraft
  roblox playstation xbox nintendo iphone ipad smartphone google amazon facebook ramadan iftar bayram zuckerfest
  opferfest chanukka diwali tigrinya medikinet ritalin follower azubi azubine mechatroniker mechatronikerin
  marshmallows nutella lego playmobil emoji emojis selfie selfies vlog podcast influencer gamer`
    .split(/\s+/u)
    .filter(Boolean),
);

const NAME_ENDINGS =
  /(?:mann|berg|feld|dorf|burg|bach|stein|hausen|heim|ingen|rode|horst|brück|kamp|kirchen|kirch|hof|tal|thal|wald|hagen|brunn|haus|stadt|see|born|beck|au|ow|itz)$/u;

const LINKS = ['', 's', 'n', 'en', 'es', 'e', 'er'];

function splits(word: string): { head: string[]; tail: string }[] {
  const lower = word.toLocaleLowerCase('de');
  if (lower.length < 9 || NAME_ENDINGS.test(lower)) return [];
  const result: { head: string[]; tail: string }[] = [];
  for (let at = 4; at <= lower.length - 4; at += 1) {
    const tail = lower.slice(at);
    const capitalTail = tail.charAt(0).toLocaleUpperCase('de') + tail.slice(1);
    const joined = lower.slice(0, at);
    const heads = LINKS.filter((link) => joined.endsWith(link) && joined.length - link.length >= 3)
      .map((link) => joined.slice(0, joined.length - link.length))
      .flatMap((head) => [head, head.charAt(0).toLocaleUpperCase('de') + head.slice(1)]);
    result.push({ head: heads, tail: capitalTail });
  }
  return result;
}

export function compoundForms(word: string): string[] {
  return splits(word.replace(/['’]s?$/u, '')).flatMap(({ head, tail }) => [...head, tail]);
}

interface Candidate {
  readonly start: number;
  readonly end: number;
  readonly word: string;
}

function candidates(text: string, task: string | undefined): Candidate[] {
  const fromTask = taskWords(task);
  const plainTask = new Set(
    (task ?? '').split(/[^\p{L}]+/u).map((word) => word.toLocaleLowerCase('de')),
  );
  return [...text.matchAll(WORD)].flatMap((match) => {
    const word = match[0].replace(/^\p{Ll}+/u, '');
    const plain = word.replace(/['’]s?$/u, '').toLocaleLowerCase('de');
    if (word.length < 3 || fromTask.has(plain) || plainTask.has(plain) || NOT_NAMES.has(plain)) {
      return [];
    }
    return [{ start: match.index, end: match.index + match[0].length, word }];
  });
}

export async function findUnknownWordSpans(
  lines: readonly string[],
  task: string | undefined,
  unknownWords: UnknownWords,
  signal: AbortSignal,
): Promise<IdentifierSpan[]> {
  const search = buildSearchText(lines);
  const found = candidates(search.text, task);
  if (found.length === 0) return [];
  const forms = [...new Set(found.flatMap(({ word }) => wordForms(word)))];
  const unknown = await unknownWords(forms, signal);
  const flagged = found.filter(({ word }) => wordForms(word).every((form) => unknown.has(form)));
  const parts = [...new Set(flagged.flatMap(({ word }) => compoundForms(word)))];
  const unknownParts = parts.length === 0 ? new Set<string>() : await unknownWords(parts, signal);
  const known = (form: string) => !unknownParts.has(form);
  return flagged
    .filter(
      ({ word }) =>
        !splits(word.replace(/['’]s?$/u, '')).some(
          ({ head, tail }) => known(tail) && head.some(known),
        ),
    )
    .flatMap(({ start, end }) => {
      const before = FACILITY.exec(search.text.slice(Math.max(0, start - 40), start));
      const after = HOUSE_NUMBER.exec(search.text.slice(end));
      const from = before === null ? start : start - before[0].length;
      const to = after === null ? end : end + after[0].length;
      const category = after !== null ? 'place' : before !== null ? 'institution' : 'person';
      return toSpans(search, { start: from, end: to, category }, 'rule');
    });
}

export function createDictionaryDetector(unknownWords: UnknownWords): Detector {
  return async (lines, context, signal) => {
    signal.throwIfAborted();
    return findUnknownWordSpans(lines, context.task, unknownWords, signal);
  };
}
