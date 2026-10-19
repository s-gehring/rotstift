export interface StartOptions {
  model: string;
  mmproj?: string;
  contextSize?: number;
  threads?: number;
  gpuLayers?: number;
}

export type LlmError =
  | {
      kind:
        | 'invalidModelName'
        | 'modelNotFound'
        | 'sidecarMissing'
        | 'environment'
        | 'spawnFailed'
        | 'exitedDuringStartup'
        | 'exitedUnexpectedly'
        | 'request';
      detail: string;
    }
  | { kind: 'startupTimeout' | 'notReady' }
  | { kind: 'server'; detail: { status: number; body: string } };

export type RuntimeStatus =
  | { state: 'stopped' }
  | { state: 'starting'; model: string }
  | { state: 'ready'; model: string; port: number }
  | { state: 'failed'; error: LlmError };

export interface ModelDirectory {
  path: string;
  files: { name: string; bytes: number }[];
}

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
  max_tokens?: number;
  seed?: number;
  stop?: string[];
}

export interface ChatResponse {
  choices: {
    index: number;
    finish_reason: string | null;
    message: { role: string; content: string | null };
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
