class TelemetryAudio {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private lastPingMs = 0;

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Hydrophone sub-bass thud + glass-fiber snap + descending optical LOS tone.
   */
  public playCableCut(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 1. Subsea hydrophone thud
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(118, now);
    subOsc.frequency.exponentialRampToValueAtTime(32, now + 0.42);
    subGain.gain.setValueAtTime(0.32, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.46);
    subOsc.connect(subGain).connect(ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.48);

    // 2. Silica fiber fracture transient (bandpass noise burst)
    const bufferSize = Math.floor(ctx.sampleRate * 0.14);
    const noiseBuf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.18));
    }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2600, now);
    filter.Q.setValueAtTime(3.2, now);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.28, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    noiseSrc.connect(filter).connect(noiseGain).connect(ctx.destination);
    noiseSrc.start(now);

    // 3. Descending BGP Optical-LOS chirp
    const losOsc = ctx.createOscillator();
    const losGain = ctx.createGain();
    losOsc.type = 'triangle';
    losOsc.frequency.setValueAtTime(880, now + 0.05);
    losOsc.frequency.exponentialRampToValueAtTime(310, now + 0.28);
    losGain.gain.setValueAtTime(0.09, now + 0.05);
    losGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    losOsc.connect(losGain).connect(ctx.destination);
    losOsc.start(now + 0.05);
    losOsc.stop(now + 0.32);
  }

  /**
   * Subtle 3-note BGP convergence pulse.
   */
  public playRerouteChirp(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + i * 0.055;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.13);
    });
  }

  /**
   * Ascending emerald optical-lock chord when a repair ship completes splicing.
   */
  public playRepairSplice(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + i * 0.06;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.07, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.28);
    });
  }

  /**
   * Throttled micro-sonar tick on hover.
   */
  public playHoverTick(): void {
    const nowMs = performance.now();
    if (nowMs - this.lastPingMs < 90) return;
    this.lastPingMs = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1320, now);
    gain.gain.setValueAtTime(0.018, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  }
}

export const telemetryAudio = new TelemetryAudio();

