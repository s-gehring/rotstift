export async function loadDemoClass(): Promise<File[]> {
  if (import.meta.env.DEV) {
    const { demoClassFiles } = await import('./demo-class.ts');
    return demoClassFiles();
  }
  throw new Error('Die Demo-Klasse ist nur im Entwicklungsmodus verfügbar.');
}
