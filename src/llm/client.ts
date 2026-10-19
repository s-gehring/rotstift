import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { ChatMessage, ChatRequest, ChatResponse, LlmError, RuntimeStatus } from './types.ts';

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface ChatOptions {
  signal?: AbortSignal;
}

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

  async function chat(request: ChatRequest, options: ChatOptions = {}): Promise<ChatResponse> {
    const { signal } = options;
    if (!signal) return call<ChatResponse>('llm_chat', { request });
    signal.throwIfAborted();
    const requestId = crypto.randomUUID();
    const cancel = () => {
      invoke('llm_cancel', { requestId }).catch(() => undefined);
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      return await call<ChatResponse>('llm_chat', { requestId, request });
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  return {
    startModel: (modelId: string) => call<RuntimeStatus>('llm_start_model', { modelId }),
    stop: () => call<RuntimeStatus>('llm_stop'),
    status: () => call<RuntimeStatus>('llm_status'),
    chat,
    async complete(request: ChatRequest, options: ChatOptions = {}): Promise<string> {
      const response = await chat(request, options);
      const content = response.choices[0]?.message.content;
      if (typeof content !== 'string') {
        throw new LlmCallError({ kind: 'request', detail: 'response contains no message' });
      }
      return content;
    },
  };
}

export type LlmClient = ReturnType<typeof createLlmClient>;

export function visionMessage(prompt: string, imageUrls: readonly string[]): ChatMessage {
  return {
    role: 'user',
    content: [
      ...imageUrls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
      { type: 'text' as const, text: prompt },
    ],
  };
}
