import { gsap } from 'gsap';

import {
  COUNT_SECONDS,
  HORIZONTAL_STAGGER_WEIGHT,
  LIFT_DISPLAY_SECONDS,
  LIFT_SNAP_ORDER_SECONDS,
  LIFT_SNAP_SECONDS,
  LIFT_TEXT_SECONDS,
  MODULE_ENTER_SECONDS,
  PANEL_ENTER_SECONDS,
  SWEEP_GROW_SECONDS,
  SWEEP_RETRACT_SECONDS,
  VERTICAL_STAGGER_WEIGHT,
} from './motionConstants';
import { isReducedMotion } from './scrollEngine';

const LABEL_SELECTOR = '.pc-label-inner';
const LIFT_SELECTOR = '.lift-piece';
const PANEL_SELECTOR = '.reveal-panel';
const COUNT_SELECTOR = '.reveal-count';
const CLIPPED_TEXT = 'inset(0 100% 0 0)';
const OPEN_TEXT = 'inset(0 0% 0 0)';
const CLIPPED_PANEL = 'inset(0 0 100% 0)';
const OPEN_PANEL = 'inset(0 0 0% 0)';
const CLIPPED_CONTROL = 'inset(0 0 0 100%)';
const OPEN_CONTROL = 'inset(0 0 0 0%)';
const CONTROL_SELECTOR = '.sweep-control';
const HIDDEN_LIFT_PERCENT = 115;
const MODULE_SELECTOR = '.module';
const WELL_SELECTOR = '.module-well';
const CLIPPED_MODULE = 'inset(0 100% 0 0)';
const OPEN_MODULE = 'inset(0 0% 0 0)';
const MODULE_WELL_SCALE = 1.14;

function collect(root: HTMLElement, selector: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)];
}

function positionalDelay(element: HTMLElement, frame: DOMRect, startAt: number): number {
  const rectangle = element.getBoundingClientRect();
  const verticalFraction = gsap.utils.clamp(0, 1, (rectangle.top - frame.top) / frame.height);
  const horizontalFraction = gsap.utils.clamp(0, 1, (rectangle.left - frame.left) / frame.width);
  return startAt + verticalFraction * VERTICAL_STAGGER_WEIGHT + horizontalFraction * HORIZONTAL_STAGGER_WEIGHT;
}

function formatCount(element: HTMLElement, value: number): string {
  const width = Number(element.dataset.countWidth ?? '1');
  return String(Math.round(value)).padStart(width, '0');
}

export function buildLabelReveal(label: HTMLElement): gsap.core.Timeline {
  const timeline = gsap.timeline();
  const text = label.querySelector('.pc-label-text');
  const bar = label.querySelector('.pc-label-bar');
  if (!text || !bar) return timeline;
  gsap.killTweensOf([text, bar]);
  gsap.set(text, { clipPath: CLIPPED_TEXT });
  gsap.set(bar, { scaleX: 0, opacity: 1, transformOrigin: 'left center' });
  timeline
    .to(bar, { scaleX: 1, duration: SWEEP_GROW_SECONDS, ease: 'power3.inOut' })
    .set(text, { clipPath: OPEN_TEXT })
    .set(bar, { transformOrigin: 'right center' })
    .to(bar, { scaleX: 0, duration: SWEEP_RETRACT_SECONDS, ease: 'power3.inOut' })
    .set(bar, { opacity: 0 });
  return timeline;
}

export function hideRevealPieces(root: HTMLElement): void {
  if (isReducedMotion()) return;
  collect(root, LABEL_SELECTOR).forEach((label) => {
    gsap.set(label.querySelector('.pc-label-text'), { clipPath: CLIPPED_TEXT });
    gsap.set(label.querySelector('.pc-label-bar'), { scaleX: 0, opacity: 1, transformOrigin: 'left center' });
  });
  gsap.set(collect(root, LIFT_SELECTOR), { yPercent: HIDDEN_LIFT_PERCENT });
  collect(root, PANEL_SELECTOR).forEach((panel) => {
    if (panel.matches(MODULE_SELECTOR)) {
      gsap.set(panel, { clipPath: CLIPPED_MODULE });
      gsap.set(panel.querySelector(WELL_SELECTOR), { scale: MODULE_WELL_SCALE, transformOrigin: 'left center' });
      return;
    }
    gsap.set(panel, { clipPath: panel.matches(CONTROL_SELECTOR) ? CLIPPED_CONTROL : CLIPPED_PANEL });
  });
  collect(root, COUNT_SELECTOR).forEach((element) => {
    element.textContent = formatCount(element, 0);
  });
}

function liftPiece(piece: HTMLElement, delay: number): void {
  const kind = piece.dataset.lift;
  const order = Number(piece.dataset.liftOrder ?? '0');
  if (kind === 'snap') {
    gsap.to(piece, {
      yPercent: 0,
      duration: LIFT_SNAP_SECONDS,
      ease: 'expo.out',
      delay: delay + order * LIFT_SNAP_ORDER_SECONDS,
      overwrite: 'auto',
    });
    return;
  }
  const isDisplay = kind === 'display';
  gsap.to(piece, {
    yPercent: 0,
    duration: isDisplay ? LIFT_DISPLAY_SECONDS : LIFT_TEXT_SECONDS,
    ease: isDisplay ? 'back.out(1.4)' : 'power2.out',
    delay: delay + order * 0.035,
    overwrite: 'auto',
  });
}

function openModule(panel: HTMLElement, delay: number): void {
  gsap.to(panel, {
    clipPath: OPEN_MODULE,
    duration: MODULE_ENTER_SECONDS,
    ease: 'power3.out',
    delay,
    overwrite: 'auto',
    clearProps: 'clipPath',
  });
  gsap.to(panel.querySelector(WELL_SELECTOR), {
    scale: 1,
    duration: MODULE_ENTER_SECONDS * 1.25,
    ease: 'power3.out',
    delay,
    overwrite: 'auto',
    clearProps: 'transform',
  });
}

function openPanel(panel: HTMLElement, delay: number): void {
  if (panel.matches(MODULE_SELECTOR)) {
    openModule(panel, delay);
    return;
  }
  gsap.to(panel, {
    clipPath: panel.matches(CONTROL_SELECTOR) ? OPEN_CONTROL : OPEN_PANEL,
    duration: PANEL_ENTER_SECONDS,
    ease: 'power2.out',
    delay,
    overwrite: 'auto',
    clearProps: 'clipPath',
  });
}

function countUp(element: HTMLElement, delay: number): void {
  const counter = { value: 0 };
  gsap.to(counter, {
    value: Number(element.dataset.countTo ?? '0'),
    duration: COUNT_SECONDS,
    ease: 'power2.out',
    delay,
    onUpdate: () => {
      element.textContent = formatCount(element, counter.value);
    },
  });
}

export function collectRevealPieces(root: HTMLElement): HTMLElement[] {
  return collect(root, [LABEL_SELECTOR, LIFT_SELECTOR, PANEL_SELECTOR, COUNT_SELECTOR].join(', '));
}

export function playRevealPiece(piece: HTMLElement, delay: number): void {
  if (isReducedMotion()) return;
  if (piece.matches(LABEL_SELECTOR)) buildLabelReveal(piece).delay(delay);
  else if (piece.matches(LIFT_SELECTOR)) liftPiece(piece, delay);
  else if (piece.matches(PANEL_SELECTOR)) openPanel(piece, delay);
  else if (piece.matches(COUNT_SELECTOR)) countUp(piece, delay);
}

export function playRevealPieces(root: HTMLElement, startAt: number): void {
  if (isReducedMotion()) return;
  const frame = root.getBoundingClientRect();
  collectRevealPieces(root).forEach((piece) => {
    const isSnap = piece.dataset.lift === 'snap';
    playRevealPiece(piece, isSnap ? startAt : positionalDelay(piece, frame, startAt));
  });
}
