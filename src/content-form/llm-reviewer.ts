import { describeLlmError } from '../correction/llm-corrector.ts';
import { LlmCallError, type LlmClient } from '../llm/client.ts';
import { reviewContent, type ContentInput, type ContentResult } from './review.ts';

export interface LlmReviewerDeps {
  readonly client: Pick<LlmClient, 'complete'>;
  readonly prepare?: (signal: AbortSignal) => Promise<void>;
}

const ANSWER_TOKENS = 96;

export function createLlmReviewer(deps: LlmReviewerDeps) {
  const { client, prepare } = deps;
  return {
    async review(input: ContentInput, signal: AbortSignal): Promise<ContentResult> {
      try {
        signal.throwIfAborted();
        await prepare?.(signal);
        return await reviewContent(
          input,
          async (request, askSignal) => {
            const answer = await client.complete(
              {
                messages: [...request.messages],
                temperature: 0,
                max_tokens: ANSWER_TOKENS,
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: 'antwort', schema: request.schema },
                },
              },
              { signal: askSignal },
            );
            return answer.finishReason === 'length' ? '' : answer.text;
          },
          signal,
        );
      } catch (error) {
        if (signal.aborted) return { ok: false, error: { kind: 'cancelled' } };
        if (error instanceof LlmCallError)
          return { ok: false, error: describeLlmError(error.error) };
        return {
          ok: false,
          error: {
            kind: 'failed',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };
}
