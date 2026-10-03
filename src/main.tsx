import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Words } from './i18n/provider';
import './index.css';
import { fitToKeyboard } from './lib/viewport';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

fitToKeyboard();

// Outside `App` rather than inside it: everything App draws asks for words, including the
// two states it can return before there is a board — the loading line and the failure page.
createRoot(root).render(
  <StrictMode>
    <Words>
      <App />
    </Words>
  </StrictMode>,
);
