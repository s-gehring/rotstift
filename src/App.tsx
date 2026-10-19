import { ImportView } from './import/ImportView.tsx';

export function App() {
  return (
    <main className="app">
      <h1>Rotstift</h1>
      <p className="hint">Schülerarbeiten lokal korrigieren.</p>
      <ImportView />
    </main>
  );
}
