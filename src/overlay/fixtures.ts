import { DEUTSCH } from '../annotations/profile.ts';
import { parseTranscript } from '../annotations/parse.ts';
import type { Transcript } from '../annotations/transcript.ts';
import type { PageSize } from './model.ts';

export const FIXTURE_PAGE: PageSize = { width: 1240, height: 1754 };

interface Geometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pitch: number;
}

const ESSAY_LINES = [
  'Am Wochenende <rs-error type="Sb" fix="war ich">ich war</rs-error> mit meiner Familie im <rs-error type="R" fix="Schwimmbad">Schwimbad</rs-error>.',
  'Wir sind früh losgefahren<rs-missing type="Z" fix=","></rs-missing> weil mein Bruder die neue Rutsche ausprobieren wollte.',
  'Dort trafen wir mit <rs-error type="G" fix="meinem">meinen</rs-error> Onkel Peter zusammen.',
  'Danach <rs-error type="T" fix="aßen">essen</rs-error> wir Pommes und <rs-error type="W" fix="anschließend">danach</rs-error> gingen wir heim.',
  'Es war ein <rs-error type="A" fix="">richtig richtig</rs-error> schöner Tag und wir wollen <rs-missing type="W" fix="bald"></rs-missing> wieder hin.',
  'Meine Mutter sagte <rs-error type="Z" fix=",">dass</rs-error> wir <rs-error type="R" fix="nächstes">naechstes</rs-error> Mal <rs-error type="R" fix="Sonnencreme">Sonencreme</rs-error> mitnehmen <rs-error type="G" fix="müssen">müsste</rs-error>.',
  'Am <rs-error type="R" fix="Abend">abend</rs-error> war ich <rs-error type="R" fix="müde">mide</rs-error> und <rs-error type="R" fix="schlief">schlif</rs-error> sofort ein.',
];

function build(html: string[], geometry: Geometry): Transcript {
  const markup = html
    .map((content, index) => {
      const y = geometry.y + index * geometry.pitch;
      return `<rs-line n="${index + 1}" bbox="${geometry.x},${y},${geometry.width},${geometry.height}">${content}</rs-line>`;
    })
    .join('\n');
  const result = parseTranscript(markup, { profile: DEUTSCH });
  if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join('\n'));
  return result.transcript;
}

export const roomyPage = (): Transcript =>
  build(ESSAY_LINES, { x: 150, y: 260, width: 860, height: 60, pitch: 110 });

export const tightPage = (): Transcript =>
  build(ESSAY_LINES, { x: 150, y: 120, width: 860, height: 46, pitch: 56 });

export const wideNoMarginPage = (): Transcript =>
  build(ESSAY_LINES, { x: 40, y: 260, width: 1160, height: 60, pitch: 110 });
