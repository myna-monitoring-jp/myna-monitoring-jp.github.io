import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from '@/App';
import '@/styles/global.css';

/**
 * Hash routing is deliberate: the bundle must run from any static host
 * (file share, SharePoint, S3, GitHub Pages) without server rewrite rules,
 * while `#/incidents?category=common_system` stays a shareable deep link.
 */
const container = document.getElementById('root');
if (!container) throw new Error('#root element not found');

createRoot(container).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
