import type { Invoke } from './save-file.ts';

export interface RecordedCall {
  readonly command: string;
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

export function fakeInvoke(result: unknown = null, fail = false) {
  const calls: RecordedCall[] = [];
  const invoke: Invoke = (command, args, options) => {
    calls.push({
      command,
      body: args instanceof Uint8Array ? args : new Uint8Array(),
      headers: Object.fromEntries(new Headers(options?.headers)),
    });
    return fail ? Promise.reject(result) : Promise.resolve(JSON.parse(JSON.stringify(result)));
  };
  return { calls, invoke };
}

export function decodedHeader(call: RecordedCall | undefined, name: string): string {
  return decodeURIComponent(call?.headers[name] ?? '');
}
