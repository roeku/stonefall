// Cut out of src/client/utils/days.ts on 2026-09-26. A record, not a module: `parse` lived beside
// it in that file.
//
// Its one caller was the closed map's "Tuesday's map is closed." line and its "Today's map"
// button, which sent players off to another post. An older post now shows its day as
// "Final · Tue 22 Sep" with its standings, and its Build plays today's map in place.

/** "Tuesday": whose map this was, for a sentence. */
export const longWeekday = (day: string): string => {
  const d = parse(day);
  return d ? d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }) : 'That day';
};
