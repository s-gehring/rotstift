import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LlmError,
  ModelDirectory,
  RuntimeStatus,
  StartOptions,
} from './types.ts';

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export class LlmCallError extends Error {
  readonly error: LlmError;

  constructor(error: LlmError) {
    super(`LLM runtime error: ${error.kind}`);
    this.name = 'LlmCallError';
    this.error = error;
  }
}

function isLlmError(value: unknown): value is LlmError {
  return typeof value === 'object' && value !== null && 'kind' in value;
}

export function createLlmClient(invoke: Invoke = tauriInvoke) {
  async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      throw isLlmError(error) ? new LlmCallError(error) : error;
    }
  }

  async function chat(request: ChatRequest): Promise<ChatResponse> {
    return call<ChatResponse>('llm_chat', { request });
  }

  return {
    start: (options: StartOptions) => call<RuntimeStatus>('llm_start', { options }),
    stop: () => call<RuntimeStatus>('llm_stop'),
    status: () => call<RuntimeStatus>('llm_status'),
    models: () => call<ModelDirectory>('llm_models'),
    chat,
    async complete(request: ChatRequest): Promise<string> {
      const response = await chat(request);
      const content = response.choices[0]?.message.content;
      if (typeof content !== 'string') {
        throw new LlmCallError({ kind: 'request', detail: 'response contains no message' });
      }
      return content;
    },
  };
}

export type LlmClient = ReturnType<typeof createLlmClient>;

const BASE64_CHUNK = 0x8000;

export function imageDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function visionMessage(prompt: string, imageUrls: readonly string[]): ChatMessage {
  return {
    role: 'user',
    content: [
      ...imageUrls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
      { type: 'text' as const, text: prompt },
    ],
  };
}
