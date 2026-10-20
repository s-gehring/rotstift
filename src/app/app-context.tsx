import { createContext, use, type ReactNode } from 'react';
import type { AppModel } from './types.ts';
import { useAppModel } from './use-app-model.ts';

const AppContext = createContext<AppModel | null>(null);

export function AppProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: AppModel;
}) {
  return <AppContext value={value}>{children}</AppContext>;
}

export function LiveAppProvider({ children }: { readonly children: ReactNode }) {
  return <AppProvider value={useAppModel()}>{children}</AppProvider>;
}

export function useApp(): AppModel {
  const model = use(AppContext);
  if (model === null) throw new Error('useApp braucht einen AppProvider.');
  return model;
}
