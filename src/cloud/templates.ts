import { z } from 'zod';
import providersJson from '../../src-tauri/cloud-providers.json';

const templateSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  baseUrl: z.url().nullable(),
  key: z.enum(['required', 'optional']),
  tokenField: z.enum(['max_tokens', 'max_completion_tokens']),
});

export type CloudTemplate = z.infer<typeof templateSchema>;

export const CLOUD_TEMPLATES: readonly CloudTemplate[] = z
  .strictObject({ templates: z.array(templateSchema).min(1) })
  .parse(providersJson).templates;

export function findTemplate(id: string): CloudTemplate | undefined {
  return CLOUD_TEMPLATES.find((template) => template.id === id);
}

export function isLoopbackUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase();
    return host === 'localhost' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/u.test(host);
  } catch {
    return false;
  }
}
