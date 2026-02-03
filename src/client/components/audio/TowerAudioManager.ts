// Audio system for tower emergence and world interactions
export class TowerAudioManager {
  private audioContext: AudioContext | null = null;
  private masterVolume = 0.3;

  constructor() {
    // Initialize Web Audio API
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (error) {
      console.warn('Web Audio API not supported:', error);
    }
  }

  // Create a synthesized sound using Web Audio API
  private createTone(frequency: number, duration: number, type: OscillatorType = 'sine'): void {
    if (!this.audioContext) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
    oscillator.type = type;

    // Envelope for smooth sound
    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(this.masterVolume, this.audioContext.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + duration);
  }

  // TRON-style rising sound - ascending frequency sweep
  playTowerRising(): void {
    if (!this.audioContext) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    const filterNode = this.audioContext.createBiquadFilter();

    oscillator.connect(filterNode);
    filterNode.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    // TRON-style electronic sound
    oscillator.type = 'sawtooth';
    filterNode.type = 'lowpass';
    filterNode.frequency.setValueAtTime(800, this.audioContext.currentTime);

    // Rising frequency sweep
    oscillator.frequency.setValueAtTime(80, this.audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(400, this.audioContext.currentTime + 1.5);

    // Filter sweep for TRON effect
    filterNode.frequency.exponentialRampToValueAtTime(2000, this.audioContext.currentTime + 1.5);

    // Volume envelope
    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(
      this.masterVolume * 0.6,
      this.audioContext.currentTime + 0.1
    );
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 2.0);

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + 2.0);
  }

  // TRON-style sinking sound - descending frequency sweep
  playTowerSinking(): void {
    if (!this.audioContext) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    const filterNode = this.audioContext.createBiquadFilter();

    oscillator.connect(filterNode);
    filterNode.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    // TRON-style electronic sound
    oscillator.type = 'triangle';
    filterNode.type = 'lowpass';
    filterNode.frequency.setValueAtTime(1200, this.audioContext.currentTime);

    // Descending frequency sweep
    oscillator.frequency.setValueAtTime(300, this.audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(60, this.audioContext.currentTime + 1.8);

    // Filter sweep for TRON effect
    filterNode.frequency.exponentialRampToValueAtTime(200, this.audioContext.currentTime + 1.8);

    // Volume envelope
    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(
      this.masterVolume * 0.5,
      this.audioContext.currentTime + 0.05
    );
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 2.0);

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + 2.0);
  }

  // Chunk loading ambient sound
  playChunkLoading(): void {
    this.createTone(150, 0.3, 'sine');
    setTimeout(() => this.createTone(200, 0.2, 'sine'), 100);
  }

  // Tower placement confirmation sound
  playTowerPlaced(): void {
    // Quick ascending chord
    this.createTone(220, 0.15, 'sine');
    setTimeout(() => this.createTone(330, 0.15, 'sine'), 50);
    setTimeout(() => this.createTone(440, 0.2, 'sine'), 100);
  }

  // Set master volume (0-1)
  setVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
  }

  // Resume audio context (required for user interaction)
  resumeAudioContext(): void {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }
}

// Global instance
export const towerAudio = new TowerAudioManager();
