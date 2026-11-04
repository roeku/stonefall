import type { StorageFamilyId } from '../../shared/types/storage';

/** "41.2 MB": decimal units, as Devvit gives its limits. The server's `bytesText`, for the page. */
export const bytes = (n: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.max(0, n);
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return `${u === 0 ? Math.round(v) : Number(v.toPrecision(3))} ${units[u]}`;
};

export const whole = (n: number): string => Math.round(n).toLocaleString('en-US');

/** "1 key", "2,210 keys". */
export const count = (n: number, noun: string): string =>
  `${whole(n)} ${Math.round(n) === 1 ? noun : `${noun}s`}`;

export const share = (part: number, of: number): string => {
  if (!(of > 0)) return '';
  const pct = (100 * part) / of;
  if (pct === 0) return '0%';
  if (pct < 0.1) return '<0.1%';
  return `${Number(pct.toPrecision(pct < 10 ? 2 : 3))}%`;
};

/** "4 Nov", from a UTC day or a time. */
export const shortDay = (day: string | number): string =>
  new Date(typeof day === 'string' ? `${day}T00:00:00Z` : day).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** "in 3 days", "in 2 hours", "never". */
export const until = (at: number | null, now = Date.now()): string => {
  if (at === null) return 'never';
  const s = (at - now) / 1000;
  if (s <= 0) return 'now';
  if (s < 90) return `in ${Math.round(s)} s`;
  if (s < 5400) return `in ${Math.round(s / 60)} min`;
  if (s < 129_600) return `in ${Math.round(s / 3600)} h`;
  return `in ${Math.round(s / 86_400)} days`;
};

/** "2 min ago". */
export const ago = (at: number, now = Date.now()): string => {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
};

/**
 * The five colours the families are drawn in: the dark steps of the reference categorical
 * palette, validated against this page's surface (adjacent CVD ΔE ≥ 8.4). Families fold into
 * five groups so no chart needs a sixth hue; the rest is grey.
 */
export type Group = 'runs' | 'players' | 'maps' | 'relay' | 'other';

export const GROUPS: ReadonlyArray<{ id: Group; label: string; color: string }> = [
  { id: 'runs', label: 'Runs', color: '#3987e5' },
  { id: 'players', label: 'Players', color: '#d95926' },
  { id: 'maps', label: 'Maps', color: '#199e70' },
  { id: 'relay', label: 'Relay', color: '#c98500' },
  { id: 'other', label: 'Other', color: '#6f7a88' },
];

export const groupOf = (family: StorageFamilyId): Group => {
  switch (family) {
    case 'runs':
      return 'runs';
    case 'users':
      return 'players';
    case 'maps':
    case 'boards':
    case 'records':
    case 'feeds':
      return 'maps';
    case 'relayTowers':
    case 'relayPlayers':
      return 'relay';
    default:
      return 'other';
  }
};

export const colorOf = (group: Group): string => GROUPS.find((g) => g.id === group)!.color;

export const METHOD_WORDS = {
  read: 'every key read',
  sampled: 'sampled',
  tallied: 'counted as written',
} as const;
