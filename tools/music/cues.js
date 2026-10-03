// What stonefall.strudel is rendered into, and the mixes the REPL can play.
//
// Every stem is eight bars and loops; the game plays all of them at once and sets each one's
// level from the run (src/client/components/audio/music.ts). A stem is rendered from its second
// pass, so it starts with the tails of its own end and loops without a seam. A one-shot is
// rendered with room for its tail; the game starts the loop a bar after the intro begins.
export const BPM = 120;
export const BARS = 8;
export const STEMS = ['riff', 'drums', 'stabs', 'arp', 'lead', 'drive'];
export const SHOTS = [
  { name: 'intro', bars: 1 },
  { name: 'lift', bars: 1 },
  { name: 'derez', bars: 2 },
];
/** Seconds of tail rendered after a one-shot's bars. */
export const TAIL = 2;

/** The mixes the game moves between, to hear them in the REPL. */
export const PRESETS = [
  { label: 'build', play: 'riff', note: 'a run starts' },
  { label: 'first blocks', play: 'riff drums', note: 'the first drop' },
  { label: 'groove', play: 'riff drums stabs', note: '6 blocks up' },
  { label: 'high', play: 'riff drums stabs arp', note: '14 blocks up' },
  { label: 'streak', play: 'riff drums stabs arp lead', note: '3 perfects' },
  { label: 'danger', play: 'riff drums stabs arp drive', note: 'the block is small' },
  { label: 'everything', play: 'riff drums stabs arp lead drive', note: 'small, and perfect' },
  ...SHOTS.map(({ name }) => ({ label: name, play: name, note: 'one-shot' })),
];

/** The track's code with PLAY set to `play`. */
export const withPlay = (code, play) =>
  code.replace(/const PLAY = '[^']*'/, `const PLAY = '${play}'`);
