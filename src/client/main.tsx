import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import { initializeConsoleSilencer } from '../shared/utils/consoleSilencer';

initializeConsoleSilencer();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
