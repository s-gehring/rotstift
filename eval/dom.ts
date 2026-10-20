/// <reference lib="dom" />
import { Window } from 'happy-dom';

export function installDom(): void {
  Object.assign(globalThis, { DOMParser: new Window().DOMParser });
}
