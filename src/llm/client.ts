import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LlmError,
  RuntimeStatus,
  TokenLogprob,
} from './types.ts';

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface ChatOptions {
  signal?: AbortSignal;
}

export interface Completion {
  text: string;
  finishReason: string | null;
  logprobs?: readonly TokenLogprob[];
}

export class LlmCallError extends Error {
  readonly error: LlmError;

  constructor(error: LlmError) {
    super(`LLM runtime error: ${error.kind}`);
    this.name = 'LlmCallError';
    this.error = error;
  }
}

export function isLlmError(value: unknown): value is LlmError {
  return typeof value === 'object' && value !== null && 'kind' in value;
}

export interface ChatRoute {
  readonly chat: string;
  readonly cancel: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

const SIDECAR_ROUTE: ChatRoute = { chat: 'llm_chat', cancel: 'llm_cancel' };

export function createLlmClient(invoke: Invoke = tauriInvoke, route: ChatRoute = SIDECAR_ROUTE) {
  async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      throw isLlmError(error) ? new LlmCallError(error) : error;
    }
  }

  async function chat(request: ChatRequest, options: ChatOptions = {}): Promise<ChatResponse> {
    const { signal } = options;
    const extra = route.args ?? {};
    if (!signal) return call<ChatResponse>(route.chat, { ...extra, request });
    signal.throwIfAborted();
    const requestId = crypto.randomUUID();
    const cancel = () => {
      invoke(route.cancel, { requestId }).catch(() => undefined);
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      return await call<ChatResponse>(route.chat, { ...extra, requestId, request });
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
    async complete(request: ChatRequest, options: ChatOptions = {}): Promise<Completion> {
      const response = await chat(request, options);
      const choice = response.choices[0];
      const content = choice?.message.content;
      if (typeof content !== 'string') {
        throw new LlmCallError({ kind: 'request', detail: 'response contains no message' });
      }
      const logprobs = choice?.logprobs?.content;
      return {
        text: content,
        finishReason: choice?.finish_reason ?? null,
        ...(Array.isArray(logprobs) && { logprobs }),
      };
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
