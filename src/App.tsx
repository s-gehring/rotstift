import { LiveAppProvider } from './app/app-context.tsx';
import { Shell } from './app/Shell.tsx';

export function App() {
  return (
    <LiveAppProvider>
      <Shell />
    </LiveAppProvider>
  );
}
