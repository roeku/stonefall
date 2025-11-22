export type PlayerColorChoice = 'orange' | 'blue';

export const PLAYER_COLOR_CHOICES: readonly PlayerColorChoice[] = ['orange', 'blue'] as const;

export const isPlayerColorChoice = (
  value: string | null | undefined
): value is PlayerColorChoice => {
  if (typeof value !== 'string') {
    return false;
  }
  return (PLAYER_COLOR_CHOICES as readonly string[]).includes(value);
};
