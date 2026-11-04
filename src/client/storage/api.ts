import type {
  StorageAction,
  StorageActionResult,
  StorageKeyDetail,
  StorageListing,
  StorageOverview,
  StorageScope,
} from '../../shared/types/storage';

/** The dashboard's calls. Each throws with the server's words, which the page shows as they are. */

const read = async <T>(res: Response): Promise<T> => {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || body === null) {
    throw new Error(body?.error ?? `The server answered ${res.status}.`);
  }
  return body;
};

export const fetchOverview = async (): Promise<StorageOverview> =>
  read(await fetch('/api/storage/overview'));

export const fetchListing = async (scope: StorageScope): Promise<StorageListing> => {
  const q = new URLSearchParams(
    scope.kind === 'map'
      ? { kind: 'map', day: scope.day }
      : scope.kind === 'relay'
        ? { kind: 'relay', postId: scope.postId }
        : { kind: 'family', family: scope.family }
  );
  return read(await fetch(`/api/storage/listing?${q}`));
};

export const fetchKey = async (name: string): Promise<StorageKeyDetail> =>
  read(await fetch(`/api/storage/key?${new URLSearchParams({ name })}`));

export const act = async (action: StorageAction): Promise<StorageActionResult> =>
  read(
    await fetch('/api/storage/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    })
  );
