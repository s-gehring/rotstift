import { DEUTSCH } from '../src/annotations/profile.ts';
import {
  contentQuestions,
  questionRequest,
  type ContentInput,
  type ContentQuestion,
} from '../src/content-form/review.ts';
import { DEFAULT_SCOPE } from '../src/correction/scope.ts';
import type { ReviewSample } from './content-form-sample.ts';

export function sampleInput(sample: ReviewSample): ContentInput {
  return {
    lines: sample.lines.map((text, index) => ({ pageId: sample.id, line: index + 1, text })),
    profile: { ...DEUTSCH, subject: sample.subject },
    scope: {
      ...DEFAULT_SCOPE,
      spelling: false,
      grammar: false,
      content: sample.assignment.trim() !== '',
      form: sample.form.trim() !== '',
      formName: sample.form,
      assignment: sample.assignment,
    },
  };
}

export function featuresFor(sample: ReviewSample): ContentQuestion[] {
  return contentQuestions(sampleInput(sample).scope);
}

export function buildFeatureRequest(sample: ReviewSample, question: ContentQuestion) {
  return questionRequest(sampleInput(sample), question);
}
