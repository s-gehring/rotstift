export interface ExitReport {
  code: number | null;
  log: string;
}

import type { CloudError } from '../cloud/errors.ts';

export type LlmError =
  | {
      kind:
        | 'invalidModelName'
        | 'modelNotFound'
        | 'sidecarMissing'
        | 'environment'
        | 'spawnFailed'
        | 'invalidRequest'
        | 'request';
      detail: string;
    }
  | { kind: 'exitedDuringStartup' | 'exitedUnexpectedly'; detail: ExitReport }
  | { kind: 'startupTimeout' | 'notReady' | 'cancelled' | 'timeout' }
  | { kind: 'server'; detail: { status: number; body: string } }
  | CloudError;

export type RuntimeStatus =
  | { state: 'stopped' }
  | { state: 'starting'; model: string }
  | { state: 'ready'; model: string; port: number }
  | { state: 'failed'; error: LlmError };

export type ContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  repeat_penalty?: number;
  max_tokens?: number;
  seed?: number;
  stop?: string[];
  logprobs?: boolean;
  response_format?: ResponseFormat;
}

export interface ResponseFormat {
  type: 'json_schema';
  json_schema: { name: string; schema: Readonly<Record<string, unknown>> };
}

export interface TokenLogprob {
  token?: string;
  bytes: number[];
  logprob: number;
}

export interface ChatResponse {
  choices: {
    index: number;
    finish_reason: string | null;
    message: { role: string; content: string | null };
    logprobs?: { content: TokenLogprob[] | null } | null;
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
