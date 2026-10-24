import { isFirstName } from './first-names.ts';
import { MONONYMS, PUBLIC_FIGURES, WORKS } from './known-works.ts';
import { buildSearchText, toSpans, type Range, type SearchText } from './search-text.ts';
import type { DetectorContext, IdentifierCategory, PrivacySpan } from './types.ts';

interface Title {
  readonly words: readonly string[];
  readonly strict: boolean;
}

interface Work {
  readonly titles: readonly Title[];
  readonly authors: readonly (readonly string[])[];
  readonly tokens: readonly string[];
}

const PARTICLES: ReadonlySet<string> = new Set(
  'von van vom der de den des zu zum mit la le al el di da du ter und'.split(' '),
);

function lower(text: string): string {
  return text.toLocaleLowerCase('de');
}

function wordsOf(text: string): string[] {
  return lower(text)
    .split(/[^\p{L}\p{N}'’]+/u)
    .map((word) => word.replaceAll(/['’]/gu, ''))
    .filter(Boolean);
}

function tokensOf(name: string): string[] {
  return wordsOf(name).filter((word) => word.length >= 3 && !PARTICLES.has(word));
}

function list(field: string | undefined): string[] {
  return (field ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const PARSED_WORKS: readonly Work[] = WORKS.split('\n')
  .filter((line) => line.includes('|'))
  .map((line) => {
    const [titles, authors, figures] = line.split('|');
    const authorNames = list(authors);
    return {
      titles: list(titles).map((title) => ({
        words: wordsOf(title.replace(/^\*/u, '')),
        strict: title.startsWith('*'),
      })),
      authors: authorNames.map(wordsOf),
      tokens: [...new Set([...list(figures), ...authorNames].flatMap(tokensOf))],
    };
  });

const SINGLE_AUTHORS: ReadonlySet<string> = (() => {
  const counts = new Map<string, number>();
  for (const work of PARSED_WORKS) {
    for (const author of work.authors) {
      const key = author.join(' ');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, count]) => count === 1).map(([key]) => key));
})();

const FIGURES: readonly (readonly string[])[] = PUBLIC_FIGURES.split(/[;\n]/u)
  .map((name) => wordsOf(name))
  .filter((words) => words.length >= 2);

const SINGLE_NAMES: ReadonlySet<string> = new Set(wordsOf(MONONYMS));

function contains(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return false;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((word, index) => haystack[start + index] === word)) return true;
  }
  return false;
}

function metaWords(context: DetectorContext): string[] {
  const file = (context.workName.split(/[/\\]/u).at(-1) ?? '')
    .replace(/\.[\p{L}\p{N}]{1,5}$/u, '')
    .replaceAll(/(\p{Ll})(\p{Lu})/gu, '$1 $2');
  return [...wordsOf(context.task ?? ''), '|', ...wordsOf(file)];
}

function quoted(search: SearchText, title: readonly string[]): boolean {
  const body = title
    .map((word) => word.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join(String.raw`[^\p{L}\p{N}]+`);
  return new RegExp(String.raw`[„"“”»«‚‘’']\s*${body}(?![\p{L}\p{N}])`, 'iu').test(search.text);
}

function activeWorks(search: SearchText, context: DetectorContext): Work[] {
  const meta = metaWords(context);
  const text = wordsOf(search.text);
  const words = new Set([...meta, ...text]);
  return PARSED_WORKS.filter(
    (work) =>
      work.titles.some(
        (title) =>
          contains(meta, title.words) ||
          (contains(text, title.words) && (!title.strict || quoted(search, title.words))),
      ) ||
      work.authors.some(
        (author) =>
          SINGLE_AUTHORS.has(author.join(' ')) &&
          (contains(meta, author) ||
            contains(text, author) ||
            (SINGLE_NAMES.has(author.at(-1) ?? '') && words.has(author.at(-1) ?? ''))),
      ),
  );
}

function escape(word: string): string {
  return word.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function occurrences(search: SearchText, words: readonly string[]): Range[] {
  if (words.length === 0) return [];
  const body = words.map(escape).join(String.raw`[\s-]+`);
  const pattern = new RegExp(
    String.raw`(?<![\p{L}\p{N}]-?)${body}(?:['’]?s|['’])?(?![\p{L}\p{N}]|-\p{L})`,
    'giu',
  );
  return [...search.text.matchAll(pattern)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function keptTokens(search: SearchText, works: readonly Work[]): Set<string> {
  const tokens = new Set<string>(SINGLE_NAMES);
  for (const work of works) {
    for (const token of work.tokens) tokens.add(token);
  }
  for (const figure of FIGURES) {
    if (occurrences(search, figure).length === 0) continue;
    const surname = figure.at(-1);
    if (surname !== undefined && surname.length >= 3 && !isFirstName(surname)) tokens.add(surname);
  }
  return tokens;
}

function joinRanges(search: SearchText, ranges: Range[]): Range[] {
  const sorted = ranges.toSorted((a, b) => a.start - b.start);
  const joined: Range[] = [];
  for (const range of sorted) {
    const last = joined.at(-1);
    const gap = last === undefined ? '' : search.text.slice(last.end, range.start);
    if (
      last !== undefined &&
      (range.start <= last.end ||
        gap.split(/[\s-]+/u).every((word) => word === '' || PARTICLES.has(lower(word))))
    ) {
      joined[joined.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
    } else {
      joined.push(range);
    }
  }
  return joined.map((range) => {
    const initials = /(?:\p{Lu}\.\s?){1,3}$/u.exec(search.text.slice(0, range.start));
    return initials === null ? range : { ...range, start: initials.index };
  });
}

const PRIVATE_RELATION = new RegExp(
  String.raw`(?<![\p{L}])(?:mein|meine|meinem|meinen|meiner|unser|unsere|unserem|unseren|unserer)\s+(?:\p{Ll}+\s+)?(?:bruder|schwester|freund|freundin|kumpel|banknachbar|banknachbarin|nachbar|nachbarin|cousin|cousine|mitschüler|mitschülerin|klassenkamerad|klassenkameradin|onkel|tante|oma|opa|neffe|nichte|sohn|tochter|lehrer|lehrerin|trainer|trainerin)\s+$`,
  'iu',
);

export function findKeptNames(lines: readonly string[], context: DetectorContext): PrivacySpan[] {
  const search = buildSearchText(lines);
  const works = activeWorks(search, context);
  const ranges = [...keptTokens(search, works)].flatMap((token) => occurrences(search, [token]));
  for (const work of works) {
    for (const title of work.titles) ranges.push(...occurrences(search, title.words));
  }
  for (const figure of FIGURES) ranges.push(...occurrences(search, figure));
  return joinRanges(search, ranges)
    .filter(
      (range) =>
        !PRIVATE_RELATION.test(search.text.slice(Math.max(0, range.start - 60), range.start)),
    )
    .flatMap((range) => toSpans(search, { ...range, category: 'person' }, 'rule'));
}

const KEEPABLE: ReadonlySet<IdentifierCategory> = new Set(['person', 'place', 'institution']);

export function withoutKept(
  spans: readonly PrivacySpan[],
  kept: readonly PrivacySpan[],
  lines: readonly string[],
): PrivacySpan[] {
  if (kept.length === 0) return [...spans];
  const masks = new Map<number, boolean[]>();
  for (const span of kept) {
    const mask = masks.get(span.line) ?? [];
    for (let at = span.offset; at < span.offset + span.length; at += 1) mask[at] = true;
    masks.set(span.line, mask);
  }
  return spans.flatMap((span): PrivacySpan[] => {
    const mask = masks.get(span.line);
    if (span.kind !== 'identifier' || !KEEPABLE.has(span.category) || mask === undefined) {
      return [span];
    }
    const text = lines[span.line - 1] ?? '';
    const pieces: PrivacySpan[] = [];
    let start = -1;
    for (let at = span.offset; at <= span.offset + span.length; at += 1) {
      const free = at < span.offset + span.length && mask[at] !== true;
      if (free && start < 0) start = at;
      if (!free && start >= 0) {
        if (/[\p{L}\p{N}]/u.test(text.slice(start, at))) {
          pieces.push({ ...span, offset: start, length: at - start });
        }
        start = -1;
      }
    }
    return pieces;
  });
}
