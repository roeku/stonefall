/**
 * Days as the chrome says them. Every day in Stonefall is a UTC calendar day, YYYY-MM-DD, so
 * they are read at noon UTC and printed in UTC: a player west of Greenwich must not see
 * yesterday's name on today's map.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parse = (day: string): Date | null => {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "Tue 22 Sep": a map's day, short enough for a kicker. */
export const shortDay = (day: string): string => {
  const d = parse(day);
  if (!d) return day;
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
