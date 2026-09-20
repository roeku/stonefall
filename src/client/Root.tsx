import React from 'react';
import { context } from '@devvit/web/client';
import { App } from './App';
import { RelayApp } from './RelayApp';

/**
 * Which post this is.
 *
 * Both posts are served by one bundle; `postData.kind` says which. Outside the platform (the
 * local harness) `?relay` on the URL opens the relay.
 */
const isRelayPost = (): boolean => {
  const kind = (context?.postData as { kind?: unknown } | undefined)?.kind;
  if (kind === 'relay') return true;
  if (kind === 'map') return false;
  try {
    return new URLSearchParams(window.location.search).has('relay');
  } catch {
    return false;
  }
};

export const Root: React.FC = () => (isRelayPost() ? <RelayApp /> : <App />);
