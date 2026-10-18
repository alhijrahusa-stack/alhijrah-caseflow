"use client";

import { useEffect, useRef, useState } from "react";

type Feedback = "confirm" | "reschedule" | "cancel" | "tap";

const FREQUENCIES: Record<Feedback, number> = {
  confirm: 740,
  reschedule: 640,
  cancel: 520,
  tap: 600,
};

/** Lightweight interaction feedback: one oscillator, no downloaded audio, optional and low-volume. */
export function usePublicTactileAudio() {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      const context = audioRef.current;
      audioRef.current = null;
      if (context) void context.close().catch(() => {});
    };
  }, []);

  function playFeedback(kind: Feedback) {
    if (!soundEnabled || typeof window === "undefined" || !window.AudioContext) return;
    try {
      const context = audioRef.current ?? new window.AudioContext();
      audioRef.current = context;
      if (context.state === "suspended") void context.resume().catch(() => {});

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(FREQUENCIES[kind], start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.012, start + 0.016);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.10);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    } catch {
      // Audio permission and device support never affect the actual appointment action.
    }
  }

  return { soundEnabled, setSoundEnabled, playFeedback };
}
