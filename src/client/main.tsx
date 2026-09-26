import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import { initializeConsoleSilencer } from '../shared/utils/consoleSilencer';
import { AudioPlayer } from './components/audio/AudioPlayer';
import { watchPostVisibility } from './utils/postVisibility';

initializeConsoleSilencer();

// Sound stops while the post is scrolled away or the page is hidden, for both posts.
watchPostVisibility((visible) => AudioPlayer.setHidden(!visible));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
