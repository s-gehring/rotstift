import { buildSearchText, toSpans, type CategorizedRange } from './search-text.ts';
import type { Detector, IdentifierSpan } from './types.ts';

const FIRST_NAMES: ReadonlySet<string> = new Set(
  `
Aaron Abdul Abdullah Adam Adrian Ahmad Ahmed Aleksandra Alex Alexander Alexandra Ali Alicia Alina
Aliyah Amelie Amina Amir Ana Andrea Andreas Andrej Angelina Anja Anna Anne Annika Anton Antonia Arda
Arthur Artur Aylin Ayse Ayşe Baran Bastian Ben Benedikt Benjamin Bernd Berat Birgit Bjarne Björn
Bruno Can Carina Carl Carla Carlotta Carolin Caroline Celina Charlotte Chiara Chris Christian
Christina Christoph Clara Claudia Constantin Cem Damian Daniel Daniela Dario David Dawit Denis
Dennis Deniz Dominik Dörte Ecrin Efe Elena Elias Elif Elija Elisa Elisabeth Ella Emil Emilia Emilie
Emily Emir Emma Emre Enes Eric Erik Esra Eva Ewa Fabian Fabienne Fabio Fatima Felix Ferdinand Finn
Finja Florian Frank Franziska Frederik Frida Frieda Friedrich Gabriel Georg Gerda Gregor Greta
Gustav Hamza Hanna Hannah Hannes Hans Hasan Heike Helen Helena Henri Henrik Henry Hüseyin Ibrahim
Ida Ilias Ilyas Ina Ines Irina Isabel Isabell Isabella Ismail Jakob Jan Jana Janina Janne Jannik
Jannis Jasmin Jason Jens Jessica Joel Johann Johanna Johannes Jonah Jonas Jonathan Jonte Josef
Joshua Josefine Juli Julia Julian Juliane Julius Justus Kai Kaan Karim Karl Karla Karolina Katharina
Katja Kerem Kevin Khaled Kim Klara Konstantin Kristina Lara Lars Laura Lea Leah Lena Lennard Lennart
Lenny Leo Leon Leonard Leonie Leopold Levi Levin Lia Liam Lian Lilly Lina Linus Lisa Lotta Lotte
Louis Louisa Luca Lucas Lucia Luis Luisa Lukas Luke Luna Magdalena Maik Maja Malak Malte Mara Marc
Marcel Marek Maria Marie Marina Mario Marius Mark Marko Markus Marlene Martha Martin Mats Mattis Max
Maxim Maximilian Maya Mehmet Melanie Melina Melissa Merve Mia Michael Michelle Mika Mila Milan
Milena Mira Mirco Mohamed Mohammad Mohammed Moritz Muhammed Murat Nadine Nathalie Nele Nick Nico
Niklas Nils Nina Noah Noel Nora Ole Olga Oliver Olivia Omar Oskar Oleksandr Oleg Patrick Paul Paula
Pauline Peter Philipp Pia Rafael Ralf Rebecca Robert Robin Romy Ronja Rosa Rose Sabine Sami Samira
Samuel Sandra Sara Sarah Sascha Sebastian Selin Serkan Simon Sofia Sophia Sophie Stefan Stella
Stephan Svenja Svetlana Tamara Tarik Thea Theo Theresa Thomas Tim Timo Tobias Tom Tomasz Torben
Ulrike Uwe Valentin Valentina Vanessa Victoria Viktor Vincent Wiktoria Wilhelm Yannick Yara Yasemin
Yasin Yusuf Zeynep Zoe Zofia
`
    .split(/\s+/u)
    .filter(Boolean)
    .map((name) => name.toLocaleLowerCase('de')),
);

const TRIGGER = String.raw`(?<![\p{L}\p{N}])(?<trigger>Frau|Herr|Herrn|Fr\.|Hr\.|heiße|heisse|heißt|heist|Name ist|nennen mich|genannt|Oma|Opa|Onkel|Tante|Cousin|Cousine|Bruder|Schwester|Freund|Freundin|Kumpel|Nachbar|Nachbarin|Mitschüler|Mitschülerin|Banknachbar|Banknachbarin|Liebe|Lieber|Hallo|Hi|Hey|Servus|Moin|Deine|Dein|Euer|Eure|Grüße|Gruß)\s+(?<name>\p{L}[\p{L}-]*)`;

const NAMING = /^(?:heiße|heisse|heißt|heist|Name ist)$/u;

const NOT_NAMES: ReadonlySet<string> = new Set(
  `oma opa mama papa mutter vater eltern familie frau herr leute klasse grüße gruß tagebuch freund freundin
  schule lehrer lehrerin mitschüler mitschülerin bruder schwester tante onkel ist war hat und aber der die das
  dem den ein eine einer mal mir mich dich dir euch uns ganz sehr so auch noch nicht doch nur schon immer`
    .split(/\s+/u)
    .filter(Boolean),
);

function plain(word: string): string {
  return word
    .toLocaleLowerCase('de')
    .replace(/['’`´]s?$/u, '')
    .replaceAll(/[^\p{L}]/gu, '');
}

export function taskWords(task: string | undefined): ReadonlySet<string> {
  return new Set(
    (task ?? '')
      .split(/[^\p{L}]+/u)
      .filter((word) => /^\p{Lu}/u.test(word))
      .map(plain),
  );
}

function listedLength(word: string): number {
  const name = plain(word);
  if (FIRST_NAMES.has(name)) return word.replace(/['’`´]s?$/u, '').length;
  if (name.endsWith('s') && FIRST_NAMES.has(name.slice(0, -1))) {
    return word.replace(/['’`´]$/u, '').length - 1;
  }
  return 0;
}

export function findFirstNameSpans(lines: readonly string[], task?: string): IdentifierSpan[] {
  const search = buildSearchText(lines);
  const fromTask = taskWords(task);
  const ranges: CategorizedRange[] = [];
  for (const match of search.text.matchAll(new RegExp(TRIGGER, 'gu'))) {
    const trigger = match.groups?.['trigger'] ?? '';
    const name = (match.groups?.['name'] ?? '').replace(/-$/u, '');
    if (name === '' || NOT_NAMES.has(name.toLocaleLowerCase('de')) || fromTask.has(plain(name))) {
      continue;
    }
    if (!/^\p{Lu}/u.test(name) && !NAMING.test(trigger)) continue;
    const start = match.index + match[0].length - (match.groups?.['name'] ?? '').length;
    ranges.push({ start, end: start + name.length, category: 'person' });
  }
  const spans = ranges.flatMap((range) => toSpans(search, range, 'rule'));
  for (const match of search.text.matchAll(/(?<![\p{L}\p{N}])\p{L}[\p{L}'’-]*/gu)) {
    const word = match[0].replace(/-$/u, '');
    if (word.includes('-') || fromTask.has(plain(word))) continue;
    const length = listedLength(word);
    if (length === 0) continue;
    if (plain(word).length < 4 && !/^\p{Lu}/u.test(word)) continue;
    spans.push(
      ...toSpans(
        search,
        { start: match.index, end: match.index + length, category: 'person' },
        'name-list',
      ),
    );
  }
  return spans;
}

export const detectFirstNames: Detector = async (lines, context, signal) => {
  signal.throwIfAborted();
  return findFirstNameSpans(lines, context.task);
};
