const playNote = (
  ctx: AudioContext,
  payload: {
    frequency: number;
    start: number;
    peak: number;
    end: number;
  },
) => {
  const { frequency, start, peak, end } = payload;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.12, peak);
  gain.gain.exponentialRampToValueAtTime(0.01, end);
  oscillator.start(start);
  oscillator.stop(end);
  return oscillator;
};

export const playPopupSound = () => {
  try {
    const ctx = new AudioContext();
    const play = () => {
      if (ctx.state !== 'running') {
        void ctx.close();
        return;
      }

      const t = ctx.currentTime;

      playNote(ctx, { frequency: 784, start: t, peak: t + 0.02, end: t + 0.2 });
      const last = playNote(ctx, { frequency: 1047, start: t + 0.12, peak: t + 0.14, end: t + 0.37 });

      last.onended = () => void ctx.close();
    };

    if (ctx.state === 'suspended') void ctx.resume().then(play);
    else play();
  } catch {
    // Audio not supported — silent fallback
  }
};
