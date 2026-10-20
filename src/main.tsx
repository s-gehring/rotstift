import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './ui/tokens.css';
import './ui/ui.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root is missing');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
