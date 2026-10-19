import { z } from 'zod';
import { CATALOG, LANGUAGE_CODES } from './catalog.ts';

export const profileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    subject: z.string().min(1),
    language: z.enum(LANGUAGE_CODES),
    allowedTypes: z.array(z.string()).min(1, 'Ein Profil braucht mindestens eine Fehlerart.'),
  })
  .superRefine((profile, ctx) => {
    const known = new Set(CATALOG[profile.language].kinds.map((kind) => kind.code));
    const seen = new Set<string>();
    profile.allowedTypes.forEach((code, index) => {
      if (!known.has(code)) {
        ctx.addIssue({
          code: 'custom',
          path: ['allowedTypes', index],
          message: `Die Fehlerart „${code}“ gibt es im Katalog für ${CATALOG[profile.language].name} nicht.`,
        });
      } else if (seen.has(code)) {
        ctx.addIssue({
          code: 'custom',
          path: ['allowedTypes', index],
          message: `Die Fehlerart „${code}“ steht mehrfach im Profil.`,
        });
      }
      seen.add(code);
    });
  });

export type CorrectionProfile = z.infer<typeof profileSchema>;

function allKinds(language: CorrectionProfile['language']): string[] {
  return CATALOG[language].kinds.map((kind) => kind.code);
}

export const DEUTSCH: CorrectionProfile = {
  id: 'deutsch',
  name: 'Deutsch',
  subject: 'Deutsch',
  language: 'de',
  allowedTypes: allKinds('de'),
};

export const ENGLISCH: CorrectionProfile = {
  id: 'englisch',
  name: 'Englisch',
  subject: 'Englisch',
  language: 'en',
  allowedTypes: allKinds('en'),
};

export const BUILT_IN_PROFILES: readonly CorrectionProfile[] = [DEUTSCH, ENGLISCH];

export function getBuiltInProfile(id: string): CorrectionProfile | undefined {
  return BUILT_IN_PROFILES.find((profile) => profile.id === id);
}
