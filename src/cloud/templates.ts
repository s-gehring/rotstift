import { z } from 'zod';
import providersJson from '../../src-tauri/cloud-providers.json';

const cliSchema = z.strictObject({
  adapter: z.string().min(1),
  models: z.array(z.string().min(1)),
  install: z.string().min(1),
  login: z.string().min(1),
});

const templateSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  shortLabel: z.string().min(1).optional(),
  baseUrl: z.url().nullable(),
  key: z.enum(['required', 'optional', 'none']),
  tokenField: z.enum(['max_tokens', 'max_completion_tokens']),
  api: z.enum(['openai', 'anthropic', 'cli']).default('openai'),
  hidden: z.boolean().default(false),
  cli: cliSchema.optional(),
});

export type CloudTemplate = z.infer<typeof templateSchema>;

export const CLOUD_TEMPLATES: readonly CloudTemplate[] = z
  .strictObject({ templates: z.array(templateSchema).min(1) })
  .parse(providersJson).templates;

export const VISIBLE_TEMPLATES: readonly CloudTemplate[] = CLOUD_TEMPLATES.filter(
  (template) => !template.hidden,
);

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
