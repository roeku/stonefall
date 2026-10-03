// The sheet: every effect, as the game calls it. Labels pair the clips before and after.
// In scope: AudioPlayer, MusicManager, music, mark, sleep, land, signals, S.

// ---- the board: no music
mark('taps');
for (const p of [0.8, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4]) {
  AudioPlayer.playTap(p);
  await sleep(0.3);
}
await sleep(0.6);
for (const kind of ['keep', 'claim', 'take']) {
  mark(`raise ${kind}`);
  AudioPlayer.playRaise(kind);
  await sleep(2.2);
}
mark('unlock');
AudioPlayer.playUnlock();
await sleep(2);
mark('crumble small');
AudioPlayer.playCrumble(0.3);
await sleep(2.6);
mark('crumble big');
AudioPlayer.playCrumble(1);
await sleep(3);

// ---- a run: the bed, landings, milestones, the end
MusicManager.update(signals({ blocks: 1 }));
MusicManager.startRun();
await sleep(2.5);
for (let i = 0; i < 9; i++) {
  land(i > 4);
  await sleep(0.85);
}
mark('milestone pass');
land(false);
AudioPlayer.playMilestone('pass');
MusicManager.lift();
for (let i = 0; i < 3; i++) {
  await sleep(0.85);
  land(false);
}
await sleep(1.2);
mark('milestone best');
land(true);
AudioPlayer.playMilestone('best');
MusicManager.lift();
for (let i = 0; i < 3; i++) {
  await sleep(0.85);
  land(true);
}
await sleep(1.2);
mark('game over');
AudioPlayer.playGameOver();
MusicManager.update(signals({ scene: 'over' }));
MusicManager.gameOver();
await sleep(0.4);
AudioPlayer.playResult(false);
await sleep(5);
MusicManager.leave();
await sleep(1.6);

S.blocks = 1;
S.perfectStreak = 0;
MusicManager.update(signals({ blocks: 1 }));
MusicManager.startRun();
await sleep(2.5);
for (let i = 0; i < 6; i++) {
  land(i % 2 === 0);
  await sleep(0.85);
}
mark('game over, new best');
AudioPlayer.playGameOver();
MusicManager.update(signals({ scene: 'over' }));
MusicManager.gameOver();
await sleep(0.4);
AudioPlayer.playResult(true);
await sleep(5);
MusicManager.leave();
await sleep(1.6);

// ---- the relay: the bed waits through other turns
S.blocks = 20;
S.perfectStreak = 0;
MusicManager.setRelay(false, false);
MusicManager.update(signals({ mode: 'relay' }));
MusicManager.ensure();
await sleep(3);
mark('your turn');
MusicManager.setRelay(true, false);
AudioPlayer.playYourTurn();
await sleep(2.5);
mark('heal');
AudioPlayer.playHeal();
await sleep(2);
mark('fall, yours');
AudioPlayer.playMiss(true);
MusicManager.duck();
await sleep(2.5);
MusicManager.setRelay(false, false);
mark('fall, theirs');
AudioPlayer.playMiss(false);
MusicManager.duck();
await sleep(2.5);
mark('out, theirs');
AudioPlayer.playElimination(false);
MusicManager.duck();
await sleep(3);
mark('joined');
AudioPlayer.playTap(1.3);
await sleep(1.5);
mark('out, yours');
MusicManager.setRelay(false, true);
AudioPlayer.playElimination(true);
MusicManager.gameOver();
await sleep(5.5);
MusicManager.leave();
await sleep(1);
