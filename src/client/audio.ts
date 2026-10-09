import { ShipType } from '../shared/types.ts';

export interface AudioSettings {
  muted: boolean;
  masterVolume: number; // 0 to 1
  sfxVolume: number; // 0 to 1
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private settings: AudioSettings = {
    muted: false,
    masterVolume: 0.7,
    sfxVolume: 0.8,
  };
  private lastLaserTime = 0;
  private lastBoostTime = 0;

  public updateSettings(partial: Partial<AudioSettings>) {
    this.settings = { ...this.settings, ...partial };
  }

  public getSettings(): AudioSettings {
    return this.settings;
  }

  private ensureContext(): AudioContext | null {
    if (this.settings.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private getGain(): number {
    if (this.settings.muted) return 0;
    return this.settings.masterVolume * this.settings.sfxVolume;
  }

  public playLaser(shipType: ShipType = 'vanguard') {
    const now = performance.now();
    if (now - this.lastLaserTime < 55) return;
    this.lastLaserTime = now;

    const ctx = this.ensureContext();
    const vol = this.getGain() * 0.18;
    if (!ctx || vol <= 0.001) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const startFreq =
      shipType === 'phantom'
        ? 980
        : shipType === 'titan'
          ? 420
          : shipType === 'nova'
            ? 1240
            : 760;
    const endFreq = shipType === 'titan' ? 110 : 190;
    const duration = shipType === 'titan' ? 0.16 : 0.11;

    osc.type = shipType === 'nova' ? 'sine' : shipType === 'titan' ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + duration);

    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  public playExplosion(intensity: 'small' | 'medium' | 'large' | 'boss' = 'medium') {
    const ctx = this.ensureContext();
    const scale =
      intensity === 'boss' ? 0.42 : intensity === 'large' ? 0.3 : intensity === 'medium' ? 0.2 : 0.1;
    const vol = this.getGain() * scale;
    if (!ctx || vol <= 0.001) return;

    const duration =
      intensity === 'boss' ? 0.75 : intensity === 'large' ? 0.45 : intensity === 'medium' ? 0.28 : 0.12;

    // Low frequency punch
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(intensity === 'small' ? 220 : 130, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(28, ctx.currentTime + duration);

    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  public playBoost() {
    const now = performance.now();
    if (now - this.lastBoostTime < 280) return;
    this.lastBoostTime = now;

    const ctx = this.ensureContext();
    const vol = this.getGain() * 0.12;
    if (!ctx || vol <= 0.001) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(520, ctx.currentTime + 0.18);

    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  }

  public playPowerUp() {
    const ctx = this.ensureContext();
    const vol = this.getGain() * 0.2;
    if (!ctx || vol <= 0.001) return;

    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const start = ctx.currentTime + idx * 0.055;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(vol, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.12);
    });
  }

  public playWaveAlert(isBoss = false) {
    const ctx = this.ensureContext();
    const vol = this.getGain() * 0.22;
    if (!ctx || vol <= 0.001) return;

    const freqs = isBoss ? [220, 196, 220, 164.8] : [440, 554.37, 659.25];
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isBoss ? 'sawtooth' : 'sine';
      const start = ctx.currentTime + idx * 0.14;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(vol, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.22);
    });
  }

  public playMatchEnd(victory: boolean) {
    const ctx = this.ensureContext();
    const vol = this.getGain() * 0.25;
    if (!ctx || vol <= 0.001) return;

    const chord = victory ? [523.25, 659.25, 783.99, 1046.5] : [392.0, 349.23, 311.13, 261.63];
    chord.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const start = ctx.currentTime + idx * 0.12;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(vol, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.45);
    });
  }
}

export const soundEngine = new SoundEngine();
