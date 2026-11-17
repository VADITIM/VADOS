import { GESTURE_GAP_MILLISECONDS } from './motionConstants';

type Direction = 1 | -1;
type TouchDecision = 'undecided' | 'blocked' | 'passed';

export interface SceneGateHandlers {
  isAdvanced: () => boolean;
  isMoving: () => boolean;
  advance: () => void;
  retreat: () => void;
}

const TOP_TOLERANCE_PIXELS = 2;
const TOUCH_INTENT_PIXELS = 12;
const FORWARD_KEYS = ['ArrowDown', 'PageDown', 'End', ' '];
const BACK_KEYS = ['ArrowUp', 'PageUp', 'Home'];
const CONTROL_SELECTOR = 'input, textarea, select, button, [contenteditable="true"]';

export function createSceneGate(handlers: SceneGateHandlers): () => void {
  let isHeld = false;
  let lastWheelTime = Number.NEGATIVE_INFINITY;
  let touchStartY = 0;
  let touchDecision: TouchDecision = 'passed';

  function isAtTop(): boolean {
    return window.scrollY <= TOP_TOLERANCE_PIXELS;
  }

  function shouldBlock(direction: Direction, isFresh: boolean): boolean {
    if (isFresh) isHeld = false;
    if (!handlers.isAdvanced()) {
      if (direction > 0) {
        isHeld = true;
        handlers.advance();
      }
      return true;
    }
    if (direction < 0) {
      if (isFresh) {
        isHeld = true;
        handlers.retreat();
      }
      return true;
    }
    return isHeld || handlers.isMoving();
  }

  function onWheel(event: WheelEvent): void {
    const isFresh = event.timeStamp - lastWheelTime > GESTURE_GAP_MILLISECONDS;
    lastWheelTime = event.timeStamp;
    if (event.deltaY === 0 || event.ctrlKey || !isAtTop()) return;
    if (shouldBlock(event.deltaY > 0 ? 1 : -1, isFresh)) event.preventDefault();
  }

  function onTouchStart(event: TouchEvent): void {
    touchStartY = event.touches[0]?.clientY ?? 0;
    touchDecision = 'undecided';
  }

  function onTouchMove(event: TouchEvent): void {
    if (touchDecision === 'passed' || event.touches.length > 1) return;
    if (touchDecision === 'blocked') {
      event.preventDefault();
      return;
    }
    if (!isAtTop()) {
      touchDecision = 'passed';
      return;
    }
    const travel = touchStartY - (event.touches[0]?.clientY ?? touchStartY);
    if (Math.abs(travel) < TOUCH_INTENT_PIXELS) {
      const mayScroll = handlers.isAdvanced() && travel > 0 && !handlers.isMoving();
      if (!mayScroll) event.preventDefault();
      return;
    }
    const isBlocked = shouldBlock(travel > 0 ? 1 : -1, true);
    touchDecision = isBlocked ? 'blocked' : 'passed';
    if (isBlocked) event.preventDefault();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || !isAtTop()) return;
    if (event.target instanceof Element && event.target.closest(CONTROL_SELECTOR)) return;
    const isBack = BACK_KEYS.includes(event.key) || (event.key === ' ' && event.shiftKey);
    const isForward = !isBack && FORWARD_KEYS.includes(event.key);
    if (!isBack && !isForward) return;
    if (shouldBlock(isForward ? 1 : -1, !event.repeat)) event.preventDefault();
  }

  const activeListener = { passive: false };
  window.addEventListener('wheel', onWheel, activeListener);
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, activeListener);
  window.addEventListener('keydown', onKeyDown);

  return () => {
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('keydown', onKeyDown);
  };
}
