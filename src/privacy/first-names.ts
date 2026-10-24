import { buildSearchText, toSpans, type CategorizedRange } from './search-text.ts';
import type { Detector, IdentifierSpan } from './types.ts';

const FIRST_NAMES: ReadonlySet<string> = new Set(
  `
Aaron Abdul Abdullah Abel Adaeze Adam Adrian Agnieszka Ahmad Ahmed Ahmet Aleksandar Aleksandra
Alessia Alex Alexander Alexandra Aleyna Ali Alicia Alina Aliyah Amanuel Amara Amelia Amelie Amina
Amir Amira Ana Anastasia Andrea Andreas Andrej Andrii Angelina Anh Anisa Anja Anna Anne Annika Anton
Antonia Arda Ariana Arne Aron Artem Arthur Artur Asya Aya Ayla Aylin Ayse Ayşe Azra Baran Bastian
Bela Ben Benedikt Benjamin Benno Berat Berfin Berivan Bernd Bilal Biniam Birgit Bjarne Björn Bogdan
Bohdan Brian Bruno Burak Büşra Can Carina Carl Carla Carlos Carlotta Carolin Caroline Cedric Celina
Cem Charlie Charlotte Chayenne Chiamaka Chiara Chinedu Chris Christian Christina Christoph Clara
Claudia Colin Constantin Cora Damian Damla Dana Daniel Daniela Danylo Dario David Davide Dawit Defne
Delal Denis Deniz Dennis Dilan Dilara Dmytro Dominic Dominik Dorian Dörte Dragan Duc Dustin Ecem
Ecrin Edda Edin Efe Ela Elena Elian Elias Elif Elija Elin Elina Elisa Elisabeth Eliska Ella Elyas
Emanuel Emeka Emely Emil Emilia Emilian Emilie Emily Emine Emir Emma Emre Enes Enno Eren Eric Erik
Esma Esra Esther Eva Ewa Eymen Ezra Fabi Fabian Fabienne Fabio Fatima Fatma Felicitas Felix Femke
Ferdinand Fiete Filip Fine Finja Finn Finnja Flora Florian Frank Franz Franziska Frederik Frederike
Frida Frieda Friedrich Fritz Furkan Fynn Gabriel Georg Gerda Gina Gizem Goran Gregor Greta Gustav
Habtom Hailey Hakan Halil Hamid Hamza Hanna Hannah Hannes Hanno Hans Hasan Hassan Hatice Heike Helen
Helena Helin Hendrik Henning Henri Henrik Henry Hira Hugo Hung Huong Hüseyin Hussein Ian Ibrahim Ida
Ilayda Ilias Ilse Ilyas Ina Ines Inga Irina Iris Iryna Isa Isabel Isabell Isabella Isabelle Ismail
Ivan Ivana Jacob Jaden Jakob Jakub Jamal Jamie Jan Jana Janek Janina Janne Jannes Jannik Jannis
Janosch Jara Jaron Jasmin Jason Jasper Jens Jeremy Jessica Jiyan Joana Joel Johann Johanna Johannes
Joleen Jolina Jonah Jonas Jonathan Jonna Jonte Jordan Joris Josef Josefine Josephine Joshua Josie
Jovana Jule Juli Julia Julian Juliane Julien Julius Juna Juno Justin Justus Kaan Kacper Kai Kalle
Karim Karin Karl Karla Karolina Kasia Katarzyna Kateryna Katharina Katja Kaya Keno Kerem Kevin
Khaled Khalid Kian Kilian Kim Kira Klara Klaus Kofi Konrad Konstantin Kristian Kristina Krzysztof
Kübra Kuno Kwame Laila Lan Lana Lara Lars Laura Laurin Layla Lea Leah Lean Leandro Lena Leni Lenja
Lennard Lennart Lennox Lenny Leo Leon Leona Leonard Leonie Leonora Leopold Levi Levin Lewin Lia Liam
Lian Liana Lilli Lilly Lily Lina Linh Lino Linus Lisa Liv Livia Lorena Lorenz Lotta Lotte Louis
Louisa Luana Luca Lucas Lucia Lucy Ludwig Luis Luisa Luka Lukas Luke Lumi Luna Lya Madita Magdalena
Magnus Mahmoud Maik Maila Maja Maksym Malak Malgorzata Malia Malik Malte Mara Marc Marcel Marek
Maria Mariam Marie Mariella Marija Marina Mario Marius Mark Marko Markus Marlene Marlon Marta Martha
Martin Marvin Mateo Mathilda Matilda Mats Matteo Mattheo Mattis Max Maxi Maxim Maximilian Maya
Medina Mehmet Melanie Melek Melina Melissa Merle Mert Merve Meryem Mia Michael Michel Michelle Mika
Mila Milan Milena Milica Milo Mina Minh Mira Mirac Mirco Miriam Mirko Miro Mohamed Mohammad Mohammed
Moritz Muhammad Muhammed Murat Mustafa Mykola Nadia Nadine Nadja Nael Nala Naomi Nastia Natalia
Nathalie Nathan Natnael Nele Nelly Nemanja Neo Ngozi Nguyen Nick Niclas Nico Nicolas Nicole Nika
Niklas Niko Nikola Nils Nina Nisa Noah Noel Noemi Nora Nour Obinna Oksana Ole Oleg Oleksandr Olena
Olga Oliver Olivia Omar Ömer Onur Oscar Oskar Osman Pablo Patrick Paul Paula Paulina Pauline Pawel
Pepe Peter Phil Philipp Philippa Pia Piet Piotr Pius Quang Quentin Quinn Rafael Rafaela Rahel Ralf
Rami Rana Rania Raphael Rayan Rebecca Rebekka Recep Rico Rieke Robert Robin Rojda Rojin Romy Ronja
Rosa Rosalie Rose Ruben Ruby Rufus Ruth Ryan Sabine Sabrina Salma Sam Sami Samir Samira Samu Samuel
Sandra Sanja Santiago Sara Sarah Sascha Sebastian Selam Selim Selin Selma Semih Sena Senait Senta
Serafina Serkan Sevda Sienna Sila Silas Simon Sinan Sinja Smilla Sofia Sofie Sofiia Sophia Sophie
Sören Stefan Stella Stephan Sude Svea Sven Svenja Svetlana Szymon Tabea Taha Talia Tamara Tamino
Tara Taras Tarik Tayfun Taylan Taylor Tesfay Thao Thea Theo Theodor Theresa Thilo Thomas Thore Tilda
Till Tim Timo Timon Tino Tjark Tobi Tobias Tom Tomas Tomasz Toni Torben Trang Tristan Tuan Tuana
Tuncay Tunde Tyler Ulrike Umut Uwe Valentin Valentina Valentino Valerie Vanessa Vanja Veit Victor
Victoria Viktor Vincent Viola Vitus Vivien Vlad Vladislav Volkan Vuk Wiebke Wiktor Wiktoria Wilhelm
Wilma Wojciech Xenia Yannick Yannis Yara Yaren Yasemin Yasin Yasmin Yigit Yonas Youssef Yulia Yunus
Yusuf Zain Zara Zehra Zeynep Zilan Zoe Zoey Zofia Zuzanna
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
  dem den ein eine einer mal mir mich dich dir euch uns ganz sehr so auch noch nicht doch nur schon immer
  nichte neffe cousin cousine verein sie er es wir ihr dr`
    .split(/\s+/u)
    .filter(Boolean),
);

function plain(word: string): string {
  return word
    .toLocaleLowerCase('de')
    .replace(/['’`´]s?$/u, '')
    .replaceAll(/[^\p{L}]/gu, '');
}

const MONTHS: ReadonlySet<string> = new Set(['april', 'mai', 'juni', 'juli', 'august']);

function monthUse(text: string, start: number, end: number): boolean {
  return (
    /(?:^|[^\p{L}])(?:im|Im|Anfang|Ende|Mitte|seit|Seit|bis|vom|Vom|zum|\d{1,2}\.)\s+$/u.test(
      text.slice(Math.max(0, start - 12), start),
    ) || /^\s+\d{4}/u.test(text.slice(end))
  );
}

export function isFirstName(word: string): boolean {
  return FIRST_NAMES.has(word.toLocaleLowerCase('de'));
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
    if (MONTHS.has(plain(word)) && monthUse(search.text, match.index, match.index + length)) {
      continue;
    }
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
