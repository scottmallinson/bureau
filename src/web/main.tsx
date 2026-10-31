import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { desktop } from './desktop.js';
import { App } from './App.js';
import './styles.css';

// The desktop window hides its title bar on macOS; the top bar makes room.
if (desktop?.platform) document.documentElement.dataset.desktop = desktop.platform;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
