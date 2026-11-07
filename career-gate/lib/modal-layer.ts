"use client";

const layers: symbol[] = [];
let previousOverflow: string | null = null;

/** All staff dialogs share Escape ownership and one body-scroll lock. */
export function acquireModalLayer(token: symbol) {
  if (layers.includes(token)) return;
  if (layers.length === 0) previousOverflow = document.body.style.overflow;
  layers.push(token);
  document.body.style.overflow = "hidden";
}

export function isTopModalLayer(token: symbol) { return layers.at(-1) === token; }

export function releaseModalLayer(token: symbol) {
  const position = layers.indexOf(token);
  if (position === -1) return;
  layers.splice(position, 1);
  if (layers.length === 0) {
    document.body.style.overflow = previousOverflow ?? "";
    previousOverflow = null;
  }
}
