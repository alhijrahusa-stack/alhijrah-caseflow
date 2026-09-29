"use client";

import { useEffect } from "react";

const TACTILE_TARGETS = [
  ".staff-nav-link",
  ".executive-control",
  ".staff-topbar button",
  ".staff-bottom-bar a",
  ".staff-bottom-bar button",
  ".ops-primary-button",
  ".ops-segmented button",
  ".ops-client-actions a",
  ".staff-sidepanel a",
  ".staff-sidepanel button",
].join(",");

export function ExecutiveTactileFeedback() {
  useEffect(() => {
    let audioContext: AudioContext | null = null;

    async function playClick() {
      try {
        audioContext ??= new AudioContext();
        if (audioContext.state === "suspended") await audioContext.resume();

        const now = audioContext.currentTime;
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(190, now);
        oscillator.frequency.exponentialRampToValueAtTime(48, now + 0.022);

        gain.gain.setValueAtTime(0.022, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.024);

        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.024);

        oscillator.addEventListener(
          "ended",
          () => {
            oscillator.disconnect();
            gain.disconnect();
          },
          { once: true },
        );
      } catch {
        // Audio feedback is progressive enhancement only; UI actions must never depend on it.
      }
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      if (!(event.target instanceof Element)) return;

      const target = event.target.closest<HTMLElement>(TACTILE_TARGETS);
      if (!target) return;
      if (target.dataset.tactile === "off") return;
      if (target.matches(":disabled") || target.getAttribute("aria-disabled") === "true") return;

      void playClick();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      if (audioContext && audioContext.state !== "closed") void audioContext.close();
    };
  }, []);

  return null;
}
