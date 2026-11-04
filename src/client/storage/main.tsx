import './storage.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StorageApp } from './StorageApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StorageApp />
  </StrictMode>
);
