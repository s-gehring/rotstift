export function clip(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
