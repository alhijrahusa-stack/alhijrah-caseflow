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

    async function ensureAudioContext() {
      audioContext ??= new AudioContext();

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      return audioContext;
    }

    async function playExecutiveClick() {
      try {
        const ctx = await ensureAudioContext();
        const now = ctx.currentTime;

        /*
         * Mechanical body:
         * low-frequency downward pulse gives physical mass.
         */
        const bodyOscillator = ctx.createOscillator();
        const bodyGain = ctx.createGain();

        bodyOscillator.type = "sine";

        bodyOscillator.frequency.setValueAtTime(
          190,
          now,
        );

        bodyOscillator.frequency.exponentialRampToValueAtTime(
          48,
          now + 0.024,
        );

        bodyGain.gain.setValueAtTime(
          0.021,
          now,
        );

        bodyGain.gain.exponentialRampToValueAtTime(
          0.0001,
          now + 0.026,
        );

        bodyOscillator.connect(bodyGain);
        bodyGain.connect(ctx.destination);

        /*
         * Metallic edge:
         * extremely short high-frequency transient.
         */
        const edgeOscillator = ctx.createOscillator();
        const edgeGain = ctx.createGain();

        edgeOscillator.type = "triangle";

        edgeOscillator.frequency.setValueAtTime(
          680,
          now,
        );

        edgeOscillator.frequency.exponentialRampToValueAtTime(
          240,
          now + 0.012,
        );

        edgeGain.gain.setValueAtTime(
          0.0045,
          now,
        );

        edgeGain.gain.exponentialRampToValueAtTime(
          0.0001,
          now + 0.014,
        );

        edgeOscillator.connect(edgeGain);
        edgeGain.connect(ctx.destination);

        bodyOscillator.start(now);
        edgeOscillator.start(now);

        bodyOscillator.stop(now + 0.027);
        edgeOscillator.stop(now + 0.015);

        bodyOscillator.addEventListener(
          "ended",
          () => {
            bodyOscillator.disconnect();
            bodyGain.disconnect();
          },
          { once: true },
        );

        edgeOscillator.addEventListener(
          "ended",
          () => {
            edgeOscillator.disconnect();
            edgeGain.disconnect();
          },
          { once: true },
        );
      } catch {
        /*
         * Progressive enhancement only.
         * No business action may depend on audio.
         */
      }
    }

    function handlePointerDown(
      event: PointerEvent,
    ) {
      if (event.button !== 0) {
        return;
      }

      if (!(event.target instanceof Element)) {
        return;
      }

      const target =
        event.target.closest<HTMLElement>(
          TACTILE_TARGETS,
        );

      if (!target) {
        return;
      }

      /*
       * Explicit opt-out.
       */
      if (target.dataset.tactile === "off") {
        return;
      }

      /*
       * Never play feedback on unavailable actions.
       */
      if (
        target.matches(":disabled") ||
        target.getAttribute("aria-disabled") === "true"
      ) {
        return;
      }

      void playExecutiveClick();
    }

    document.addEventListener(
      "pointerdown",
      handlePointerDown,
      true,
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        handlePointerDown,
        true,
      );

      if (
        audioContext &&
        audioContext.state !== "closed"
      ) {
        void audioContext.close();
      }
    };
  }, []);

  return null;
}
