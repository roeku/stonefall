import { type EnqueueResponse, notifications, redis } from '@devvit/web/server';
import { dayBefore } from '../../shared/social/streaks';
import { USER_DATA_TTL_SECONDS, notifyHourKey, notifySentKey } from './keys';
import { EVENING_HOUR, hoursToTurn, isOffset, isQuiet, utcHourFor } from './pushTiming';
import { Users } from './users';

/**
 * Push notifications, Devvit's gated beta: opt-in only, at most two a player a day, and every
 * message approved by Devvit before it can be sent.
 *
 * Two, one a day each: your tower on the map was taken, which can only be answered today, and
 * your streak ends at the turn of the day unless you play, which Devvit's guidance names as the
 * notification worth sending. Neither goes at night where the player is.
 *
 * Devvit keeps whether a player turned them on, and is asked whenever the bell is shown: a player
 * can turn them off in Reddit's own settings too. The record follows it (`notify`), with their
 * offset from UTC (`tz`) and the UTC hour their evening starts in (`notifyHour`), whose set the
 * hourly job reads.
 */

/**
 * On since Devvit accepted Stonefall into the beta (2026-10-23). Off, the game shows no bell and
 * sends nothing.
 */
export const PUSH_ENABLED = true;

/**
 * The words, as submitted to Devvit for approval: a change here needs approving again. Titles
 * stay within 60 characters and bodies within 100 once filled in.
 */
export const PUSH_COPY = {
  taken: {
    title: 'u/{{taker}} took your Stonefall tower on {{cell}}',
    body: "{{score}} holds {{cell}} now. Beat it before today's map resets to take it back.",
  },
  streak: {
    title: 'Your {{days}}-day Stonefall streak ends in {{left}}',
    body: "One run on today's map keeps it going.",
  },
} as const;

type T2 = `t2_${string}`;
type T3 = `t3_${string}`;

/** One push of a kind a player a day: false if today's has gone already. */
const claim = async (day: string, kind: keyof typeof PUSH_COPY, userId: string) => {
  const key = notifySentKey(day, kind, userId);
  if (await redis.exists(key)) return false;
  await redis.set(key, '1', { expiration: new Date(Date.now() + 2 * 86_400_000) });
  return true;
};

const offsetOf = (record: Record<string, string>): number | null => {
  const tz = record.tz === undefined || record.tz === '' ? NaN : Number(record.tz);
  return isOffset(tz) ? tz : null;
};

/** The hour set a player belongs in: their evening's UTC hour while on, none while off. */
const hourFor = (on: boolean, tz: number | null): string =>
  on ? String(utcHourFor(EVENING_HOUR, tz ?? 0)) : '';

/** File a player as on or off, moving them to the set for the hour their evening starts in. */
const file = async (
  userId: string,
  record: Record<string, string>,
  on: boolean,
  tz: number | null
) => {
  const was = Number(record.notifyHour);
  if (record.notifyHour && Number.isInteger(was)) await redis.zRem(notifyHourKey(was), [userId]);
  const hour = hourFor(on, tz);
  if (!on) {
    // Turned off is not the player playing: the record keeps its expiry.
    await Users.note(userId, { notify: '0', notifyHour: '' });
    return;
  }
  await Users.write(userId, { notify: '1', tz: tz === null ? '' : String(tz), notifyHour: hour });
  await redis.zAdd(notifyHourKey(Number(hour)), { member: userId, score: Date.now() });
};

/** Log what Devvit would not send. */
const sent = (kind: string, res: EnqueueResponse): number => {
  if (res.failureCount > 0) {
    console.warn(`notify: ${res.failureCount} ${kind} not sent`, res.errors.slice(0, 3));
  }
  return res.successCount;
};

export const Notify = {
  /** Where a player stands as the record has it, for a first paint: Devvit is asked by `state`. */
  stateOf(record: Record<string, string>): boolean | null {
    return PUSH_ENABLED ? record.notify === '1' : null;
  },

  /**
   * Where a player stands, asked of Devvit, which has the say. The record follows it, and
   * `offset`, the player's offset from UTC now, moves them to the hour their evening starts in if
   * it has moved: a clock change, a trip, or a record that expired while they were away.
   */
  async state(userId: string, offset: unknown): Promise<boolean | null> {
    if (!PUSH_ENABLED) return null;
    const record = await Users.read(userId);
    let on: boolean;
    try {
      on = await notifications.isOptedIn(userId as T2);
    } catch (err) {
      console.warn('notify: could not ask Reddit', err);
      return record.notify === '1';
    }
    const tz = isOffset(offset) ? offset : offsetOf(record);
    const filed =
      record.notify === '1' &&
      (record.tz ?? '') === (tz === null ? '' : String(tz)) &&
      record.notifyHour === hourFor(true, tz);
    if (on ? !filed : record.notify === '1') await file(userId, record, on, tz);
    return on;
  },

  /**
   * Turn them on or off, from the player's tap on the bell. `offset` is the player's offset from
   * UTC in minutes east, which puts them in the set for the hour their evening starts in.
   */
  async set(
    userId: string,
    on: boolean,
    offset: unknown
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!PUSH_ENABLED) return { ok: false, reason: 'Notifications are not on for Stonefall yet.' };
    try {
      const res = on
        ? await notifications.optInCurrentUser()
        : await notifications.optOutCurrentUser();
      if (!res.success) return { ok: false, reason: res.message ?? 'Reddit said no.' };
    } catch (err) {
      console.error('notify: Reddit refused', err);
      return { ok: false, reason: 'Reddit did not change it.' };
    }
    await file(userId, await Users.read(userId), on, isOffset(offset) ? offset : null);
    return { ok: true };
  },

  /** A day played: keeps the player in their hour's set, which forgets anyone gone a month. */
  async seen(userId: string): Promise<void> {
    if (!PUSH_ENABLED) return;
    const record = await Users.read(userId);
    const hour = Number(record.notifyHour);
    if (record.notify !== '1' || record.notifyHour === '' || !Number.isInteger(hour)) return;
    await redis.zAdd(notifyHourKey(hour), { member: userId, score: Date.now() });
  },

  /** Somebody took their tower on today's map. Never fails the take that caused it. */
  async taken(p: {
    userId: string;
    taker: string;
    cell: string;
    score: number;
    day: string;
    postId: string | null;
  }): Promise<void> {
    if (!PUSH_ENABLED || !p.postId) return;
    try {
      const record = await Users.read(p.userId);
      if (record.notify !== '1') return;
      const tz = offsetOf(record);
      if (tz !== null && isQuiet(Date.now(), tz)) return;
      if (!(await claim(p.day, 'taken', p.userId))) return;
      const res = await notifications.enqueue({
        ...PUSH_COPY.taken,
        recipients: [
          {
            userId: p.userId as T2,
            link: p.postId as T3,
            data: { taker: p.taker, cell: p.cell, score: p.score.toLocaleString('en-US') },
          },
        ],
      });
      sent('take', res);
    } catch (err) {
      console.warn('notify: could not send a take', err);
    }
  },

  /**
   * The hour's streak reminders: everyone whose evening starts now, who played yesterday and not
   * yet today, on two days in a row or more. Returns how many were sent.
   */
  async streaks(now: number, day: string, postId: string | null): Promise<number> {
    if (!PUSH_ENABLED || !postId) return 0;
    const hour = new Date(now).getUTCHours();
    const key = notifyHourKey(hour);
    await redis.zRemRangeByScore(key, 0, now - USER_DATA_TTL_SECONDS * 1000);
    // Most recently seen first; Devvit takes a thousand recipients a call.
    const rows = await redis.zRange(key, 0, 999, { by: 'rank', reverse: true });
    const ids = (rows ?? []).map((r) => r.member);
    const hours = hoursToTurn(now);
    const left = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    const recipients: Array<{ userId: T2; link: T3; data: Record<string, string> }> = [];
    const gone: string[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const records = await Promise.all(batch.map((id) => Users.read(id)));
      for (const [j, record] of records.entries()) {
        const id = batch[j]!;
        if (record.notify !== '1' || record.notifyHour !== String(hour)) {
          gone.push(id);
          continue;
        }
        const s = Users.streakOf(record);
        if (s.day !== dayBefore(day) || s.streak < 2) continue;
        if (!(await claim(day, 'streak', id))) continue;
        recipients.push({
          userId: id as T2,
          link: postId as T3,
          data: { days: String(s.streak), left },
        });
      }
    }
    if (gone.length) await redis.zRem(key, gone);
    if (recipients.length === 0) return 0;
    try {
      return sent(
        'streak reminders',
        await notifications.enqueue({ ...PUSH_COPY.streak, recipients })
      );
    } catch (err) {
      console.error('notify: streak reminders failed', err);
      return 0;
    }
  },
};
