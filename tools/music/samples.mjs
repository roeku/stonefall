// Fetch the samples the track plays, all public domain (CC0): npm run samples
//
// Two sources, each checked: Sonic Pi's sample library (every file CC0, per its
// etc/samples/README.md; pinned to one commit) and Freesound sounds whose own page says CC0 at
// the moment they are fetched. Files land in samples/ (not committed); samples/strudel.json maps
// them for Strudel, and samples/CREDITS.md says where each came from. Only the rendered stems go
// into the game.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const dir = path.join(here, 'samples');

const SONIC_PI_COMMIT = 'b1702c06bf80354b9135b2427e985777251641e0';
const SONIC_PI = `https://raw.githubusercontent.com/sonic-pi-net/sonic-pi/${SONIC_PI_COMMIT}/etc/samples/`;

/** Sonic Pi samples, by the name the track calls them (sp_<file>). */
const SONIC_PI_FILES = [
  'bd_haus',
  'bd_tek',
  'bd_klub',
  'bd_808',
  'bd_zum',
  'sn_dolf',
  'sn_zome',
  'sn_generic',
  'elec_snare',
  'elec_hi_snare',
  'elec_filt_snare',
  'hat_bdu',
  'hat_cab',
  'hat_gem',
  'hat_raw',
  'hat_snap',
  'hat_star',
  'hat_tap',
  'hat_zild',
  'hat_metal',
  'drum_cymbal_open',
  'drum_splash_hard',
  'ride_via',
  'ride_tri',
  'perc_snap',
  'misc_cineboom',
  'perc_impact1',
  'perc_impact2',
  'glitch_perc1',
  'glitch_perc2',
  'glitch_perc3',
  'glitch_perc4',
  'glitch_perc5',
  'glitch_robot1',
  'glitch_robot2',
  'glitch_bass_g',
  'elec_blip',
  'elec_blip2',
  'elec_ping',
  'elec_twip',
  'elec_fuzz_tom',
  'elec_hollow_kick',
  'bass_hit_c',
  'bass_hard_c',
  'bass_thick_c',
  'bass_trance_c',
  'bass_dnb_f',
  'tbd_highkey_c4',
  'tbd_perc_blip',
  'tbd_perc_hat',
  'tbd_perc_tap_1',
  'tbd_perc_tap_2',
];

/**
 * Freesound sounds. `bank` groups them under one name in the sample map; `note`, where given,
 * is the pitch the sound was recorded at, so Strudel can play it at any other. Some are prepared
 * before use (samples/prepared/): `cents` retunes a recording that is off its note (measured with
 * a YIN pitch tracker, checked against test tones), `trim` cuts the silence before it starts,
 * `seconds` keeps only the start of a long held note.
 */
const FREESOUND = [
  // GRD-music-, "TR-909 Drum Hits": a Roland JD-Xi's 909 kit.
  ...[414970, 414969, 414968, 414973, 414972].map((id) => ({ id, bank: 'tr909_bd' })),
  ...[414946, 414945, 414944, 414951].map((id) => ({ id, bank: 'tr909_cp' })),
  ...[414954, 414955].map((id) => ({ id, bank: 'tr909_sd' })),
  ...[414958, 414959, 414956, 414957].map((id) => ({ id, bank: 'tr909_rim' })),
  ...[414967, 414966, 414965].map((id) => ({ id, bank: 'tr909_hh' })),
  ...[414964, 414971].map((id) => ({ id, bank: 'tr909_oh' })),
  ...[414949, 414948, 414953, 414952].map((id) => ({ id, bank: 'tr909_cy' })),
  // synthway, "Phatty Bass #1": a Moog Little Phatty, a minor third apart.
  // Recorded about a third of a semitone sharp, after a second of silence.
  ...[
    [172574, 'eb1', 38],
    [172581, 'f#1', 38],
    [172573, 'a1', 38],
    [172577, 'c2', 35],
    [172579, 'eb2', 35],
    [172580, 'f#2', 32],
    [172572, 'a2', 32],
    [172576, 'c3', 32],
    [172578, 'eb3', 30],
    [172582, 'f#3', 31],
    [172571, 'a3', 30],
    [172575, 'c4', 30],
  ].map(([id, note, cents]) => ({ id, bank: 'phatty', note, cents, trim: true, seconds: 3 })),
  // Sorinious_Genious, "Roland JD-Xi Leadsounds": leads held on a C, 16 to 20 seconds each.
  { id: 573093, bank: 'jdxi_sawbuzz', note: 'c3', seconds: 3 },
  { id: 573092, bank: 'jdxi_seqbuzz', note: 'c4', seconds: 3 },
  { id: 573097, bank: 'jdxi_tbsquare', note: 'c4', seconds: 3 },
  { id: 573088, bank: 'jdxi_tbfilter', note: 'c3', seconds: 3 },
  { id: 573094, bank: 'jdxi_sync', note: 'c3', seconds: 3 },
  { id: 573084, bank: 'jdxi_tekno', note: 'c4', seconds: 3 },
  // Stereo Surgeon, "Synth Stabs".
  { id: 265675, bank: 'stab' },
  { id: 265676, bank: 'stab' },
  // Pausenraum, "Moog Voyager".
  { id: 369153, bank: 'voyager_bass' },
  { id: 369157, bank: 'voyager_saw' },
];

const get = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'stonefall-music-samples' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
};

fs.mkdirSync(dir, { recursive: true });
const map = {};
const credits = [];

for (const name of SONIC_PI_FILES) {
  const file = `sonic-pi/${name}.flac`;
  const dest = path.join(dir, file);
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await (await get(`${SONIC_PI}${name}.flac`)).arrayBuffer()));
  }
  map[`sp_${name}`] = [file];
}
credits.push(
  `- \`sonic-pi/*\`: Sonic Pi's sample library, ${SONIC_PI}, commit ${SONIC_PI_COMMIT}. CC0 (etc/samples/README.md: "from http://freesound.org and ... placed in the public domain via the Creative Commons 0 License").`
);

for (const sound of FREESOUND) {
  const known = fs.readdirSync(dir).find((f) => f.startsWith(`fs-${sound.id}.`));
  let file = known;
  const page = await (await get(`https://freesound.org/s/${sound.id}/`)).text();
  const title = (/<title>([^<]*)/.exec(page)?.[1] ?? '').replace('Freesound - ', '').trim();
  if (!page.includes('creativecommons.org/publicdomain/zero/1.0')) {
    throw new Error(`freesound ${sound.id} (${title}) is not CC0 any more: not using it`);
  }
  if (!file) {
    // The page links the high-quality mp3 preview; the same preview is also served as ogg,
    // which keeps more of the top end. Without an account, the previews are what can be had.
    const mp3 = /https:\/\/cdn\.freesound\.org\/previews\/\d+\/\d+_\d+-hq\.mp3/.exec(page)?.[0];
    if (!mp3) throw new Error(`no preview for freesound ${sound.id}`);
    let body;
    try {
      body = Buffer.from(await (await get(mp3.replace(/\.mp3$/, '.ogg'))).arrayBuffer());
      file = `fs-${sound.id}.ogg`;
    } catch {
      body = Buffer.from(await (await get(mp3)).arrayBuffer());
      file = `fs-${sound.id}.mp3`;
    }
    fs.writeFileSync(path.join(dir, file), body);
  }
  credits.push(
    `- \`${file}\` (${sound.bank}): "${title}", https://freesound.org/s/${sound.id}/ — CC0`
  );
  if (sound.cents || sound.trim || sound.seconds) file = prepare(file, sound);
  if (sound.note) (map[sound.bank] ??= {})[sound.note] = file;
  else (map[sound.bank] ??= []).push(file);
}

/** Retuned, trimmed and shortened as the manifest says, into samples/prepared/. */
function prepare(file, { cents = 0, trim = false, seconds = 0 }) {
  const out = `prepared/${file.replace(/\.\w+$/, '.flac')}`;
  const dest = path.join(dir, out);
  if (fs.existsSync(dest)) return out;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const filters = [];
  if (trim) filters.push('silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.004');
  // Playing it back at a slightly different rate moves the pitch by `cents` (and the length by
  // under 3%, which a one-shot does not miss).
  if (cents)
    filters.push(`asetrate=44100*${Math.pow(2, -cents / 1200).toFixed(6)},aresample=44100`);
  if (seconds) filters.push(`atrim=0:${seconds},afade=t=out:st=${seconds - 0.25}:d=0.25`);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    path.join(dir, file),
    '-ar',
    '44100',
    '-af',
    filters.join(','),
    dest,
  ]);
  return out;
}

fs.writeFileSync(path.join(dir, 'strudel.json'), JSON.stringify(map, null, 1) + '\n');
fs.writeFileSync(
  path.join(dir, 'CREDITS.md'),
  `# Samples\n\nEvery sample here is public domain (CC0); no attribution is required, but here is where each came from.\n\n${credits.join('\n')}\n`
);
console.log(`${Object.keys(map).length} sounds in samples/strudel.json`);
