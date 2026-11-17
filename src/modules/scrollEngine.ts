import { gsap } from 'gsap';
import { ScrollSmoother } from 'gsap/ScrollSmoother';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger, ScrollSmoother);

type Callback = () => void;

const SMOOTHING_SECONDS = 1.1;
const INTRO_CLASS = 'is-intro-running';

const scrollSetups: Callback[] = [];
const introListeners: Callback[] = [];
let smoother: ScrollSmoother | null = null;
let isIntroFinished = false;

export function isReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function registerScrollSetup(setup: Callback): void {
  scrollSetups.push(setup);
}

export function isTouchOnly(): boolean {
  return window.matchMedia('(hover: none), (pointer: coarse)').matches;
}

export function startScrollEngine(wrapper: HTMLElement, content: HTMLElement): void {
  ScrollTrigger.config({ ignoreMobileResize: true });
  if (!isReducedMotion() && !isTouchOnly()) {
    smoother = ScrollSmoother.create({ wrapper, content, smooth: SMOOTHING_SECONDS, smoothTouch: false });
    smoother.paused(true);
    document.addEventListener('focusin', bringFocusIntoView);
  }
  scrollSetups.forEach((setup) => setup());
  ScrollTrigger.sort();
  ScrollTrigger.refresh();
}

function bringFocusIntoView(event: FocusEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches(':focus-visible')) return;
  const rectangle = target.getBoundingClientRect();
  const isInView = rectangle.top >= 0 && rectangle.bottom <= window.innerHeight;
  if (!isInView) smoother?.scrollTo(target, true, 'center center');
}

export function finishIntro(): void {
  if (isIntroFinished) return;
  isIntroFinished = true;
  document.documentElement.classList.remove(INTRO_CLASS);
  smoother?.paused(false);
  introListeners.forEach((listener) => listener());
}

export function onIntroFinished(listener: Callback): void {
  if (isIntroFinished) listener();
  else introListeners.push(listener);
}

export function scrollToTarget(selector: string): void {
  const target = document.querySelector<HTMLElement>(selector);
  if (!target) return;
  if (smoother) smoother.scrollTo(target, true, 'top top');
  else target.scrollIntoView({ behavior: isReducedMotion() ? 'auto' : 'smooth' });
}

export function refreshScrollPositions(): void {
  ScrollTrigger.refresh();
}
