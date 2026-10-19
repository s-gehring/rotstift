import { z } from 'zod';

export const bboxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive('Die Breite der Bounding Box muss größer als 0 sein.'),
  height: z.number().positive('Die Höhe der Bounding Box muss größer als 0 sein.'),
});

export const markSchema = z
  .object({
    kind: z.enum(['error', 'omission']),
    type: z.string().min(1, 'Der Fehlertyp darf nicht leer sein.'),
    original: z.string(),
    correction: z.string(),
    offset: z.int().min(0),
  })
  .superRefine((mark, ctx) => {
    if (mark.kind === 'error') {
      if (mark.original === '') {
        ctx.addIssue({ code: 'custom', message: 'Ein Fehler braucht einen Originaltext.' });
      } else if (mark.correction === mark.original) {
        ctx.addIssue({
          code: 'custom',
          message: 'Die Korrektur ist identisch mit dem Originaltext.',
        });
      }
    } else {
      if (mark.original !== '') {
        ctx.addIssue({ code: 'custom', message: 'Eine Auslassung hat keinen Originaltext.' });
      }
      if (mark.correction === '') {
        ctx.addIssue({ code: 'custom', message: 'Eine Auslassung braucht den fehlenden Text.' });
      }
    }
  });

export const lineSchema = z
  .object({
    number: z.int().min(1),
    bbox: bboxSchema.optional(),
    text: z.string(),
    marks: z.array(markSchema),
  })
  .superRefine((line, ctx) => {
    let previousEnd = 0;
    line.marks.forEach((mark, index) => {
      const end = mark.offset + mark.original.length;
      if (end > line.text.length || line.text.slice(mark.offset, end) !== mark.original) {
        ctx.addIssue({
          code: 'custom',
          path: ['marks', index],
          message: `Die Markierung „${mark.original}“ liegt nicht an Position ${mark.offset} der Zeile.`,
        });
      } else if (mark.offset < previousEnd) {
        ctx.addIssue({
          code: 'custom',
          path: ['marks', index],
          message: `Die Markierung bei Position ${mark.offset} überlappt die vorherige.`,
        });
      }
      previousEnd = Math.max(previousEnd, end);
    });
  });

export const transcriptSchema = z
  .object({ lines: z.array(lineSchema) })
  .superRefine((transcript, ctx) => {
    transcript.lines.forEach((line, index) => {
      const previous = transcript.lines[index - 1];
      if (previous && line.number <= previous.number) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'number'],
          message: `Die Zeilennummer ${line.number} folgt auf ${previous.number}; die Nummern müssen aufsteigen.`,
        });
      }
    });
  });

export type Bbox = z.infer<typeof bboxSchema>;
export type Mark = z.infer<typeof markSchema>;
export type TranscriptLine = z.infer<typeof lineSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;

export interface AnnotatedError extends Mark {
  line: number;
}

export function listErrors(transcript: Transcript): AnnotatedError[] {
  return transcript.lines.flatMap((line) =>
    line.marks.map((mark) => ({ ...mark, line: line.number })),
  );
}
