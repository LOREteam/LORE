"use client";

import { useCallback, useRef, useState, useEffect } from "react";

const STORAGE_KEY = "lore:sound-muted";
const SOUND_SETTINGS_KEY = "lore:sound-settings";

export type SoundName = "bet" | "autoBet" | "reveal" | "win" | "myWin" | "tick";

export const SOUND_LABELS: Record<SoundName, string> = {
  bet: "Manual bet",
  autoBet: "Auto-miner bet",
  reveal: "Epoch reveal",
  win: "Round winner (other)",
  myWin: "My block wins",
  tick: "Timer (last 10 sec)",
};

const DEFAULT_SOUND_SETTINGS: Record<SoundName, boolean> = {
  bet: true,
  autoBet: true,
  reveal: true,
  win: true,
  myWin: true,
  tick: true,
};

function loadSoundSettings(): Record<SoundName, boolean> {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(SOUND_SETTINGS_KEY) : null;
    if (!raw) return { ...DEFAULT_SOUND_SETTINGS };
    const obj = JSON.parse(raw);
    const out = { ...DEFAULT_SOUND_SETTINGS };
    for (const k of Object.keys(out) as SoundName[]) {
      if (typeof obj[k] === "boolean") out[k] = obj[k];
    }
    return out;
  } catch {
    return { ...DEFAULT_SOUND_SETTINGS };
  }
}

function saveSoundSettings(settings: Record<SoundName, boolean>) {
  try {
    localStorage.setItem(SOUND_SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

const SOUND_DEFS: Record<SoundName, { freq: number[]; dur: number[]; type: OscillatorType; gain: number }> = {
  bet:    { freq: [440, 550], dur: [60, 60], type: "sine", gain: 0.12 },
  autoBet: { freq: [392, 494, 523], dur: [100, 100, 180], type: "sine", gain: 0.06 },
  reveal: { freq: [330, 440, 550, 660], dur: [80, 80, 80, 120], type: "triangle", gain: 0.1 },
  win:    { freq: [523, 659, 784, 1047], dur: [100, 100, 100, 200], type: "sine", gain: 0.15 },
  myWin:  { freq: [523, 659, 784, 880, 1047, 1175], dur: [80, 80, 80, 80, 100, 200], type: "sine", gain: 0.18 },
  tick:   { freq: [660, 784], dur: [60, 80], type: "sine", gain: 0.04 },
};

export function useSound() {
  const ctxRef = useRef<AudioContext | null>(null);
  const [muted, setMuted] = useState(true);
  const [soundSettings, setSoundSettingsState] = useState<Record<SoundName, boolean>>(DEFAULT_SOUND_SETTINGS);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "false") setMuted(false);
    } catch {}
  }, []);

  useEffect(() => {
    setSoundSettingsState(loadSoundSettings());
  }, []);

  const setSoundEnabled = useCallback((name: SoundName, enabled: boolean) => {
    setSoundSettingsState((prev) => {
      const next = { ...prev, [name]: enabled };
      saveSoundSettings(next);
      return next;
    });
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  const play = useCallback((name: SoundName) => {
    if (muted) return;
    if (!soundSettings[name]) return;
    try {
      if (!ctxRef.current) ctxRef.current = new AudioContext();
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") ctx.resume();

      const def = SOUND_DEFS[name];
      let t = ctx.currentTime;

      for (let i = 0; i < def.freq.length; i++) {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.type = def.type;
        osc.frequency.value = def.freq[i];
        gainNode.gain.value = def.gain;
        gainNode.gain.exponentialRampToValueAtTime(0.001, t + def.dur[i] / 1000);
        osc.connect(gainNode).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + def.dur[i] / 1000);
        t += def.dur[i] / 1000;
      }

      if ((name === "win" || name === "myWin") && navigator.vibrate) {
        navigator.vibrate(name === "myWin" ? [50, 30, 80] : [50]);
      }
    } catch {}
  }, [muted, soundSettings]);

  return { play, muted, toggleMute, soundSettings, setSoundEnabled };
}
