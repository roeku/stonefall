/**
 * ARCHIVED — types removed from src/shared/types/api.ts during the pre-pivot cleanup.
 *
 * Each existed solely to type a route that was removed in the same pass
 * (see archive/server/removed-endpoints.ts). No client code referenced any of them.
 *
 * This file is a record, not a module. It is outside every tsconfig project and is not
 * compiled, linted, or bundled.
 */

// Response shapes for the Devvit starter-template counter routes
// (POST /api/increment, POST /api/decrement).
export type IncrementResponse = {
  type: 'increment';
  postId: string;
  count: number;
};

export type DecrementResponse = {
  type: 'decrement';
  postId: string;
  count: number;
};

// Response shape for DELETE /api/game/clear-towers.
export type ClearTowersResponse = {
  status: 'success' | 'error';
  message: string;
};
