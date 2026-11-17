import { onMounted, type Ref } from 'vue';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { INTRO_ENTER_GATE, SCROLL_ENTER_GATE } from './motionConstants';
import { onIntroFinished, registerScrollSetup } from './scrollEngine';
import { collectRevealPieces, hideRevealPieces, playRevealPiece, playRevealPieces } from './textReveal';

type RevealCause = 'intro' | 'scroll' | 'piece';

const SCROLL_REVEAL_START = 'top 85%';
export const ROOM_REVEAL_START = 'top 73%';

export function useSectionReveal(
  root: Ref<HTMLElement | null>,
  cause: RevealCause = 'scroll',
  start: string = SCROLL_REVEAL_START,
): void {
  onMounted(() => {
    const element = root.value;
    if (!element) return;
    hideRevealPieces(element);
    if (cause === 'intro') {
      onIntroFinished(() => playRevealPieces(element, INTRO_ENTER_GATE));
      return;
    }
    if (cause === 'piece') {
      registerScrollSetup(() => {
        collectRevealPieces(element).forEach((piece) => {
          ScrollTrigger.create({
            trigger: piece.closest<HTMLElement>('.lift-mask') ?? piece,
            start,
            once: true,
            onEnter: () => playRevealPiece(piece, SCROLL_ENTER_GATE),
          });
        });
      });
      return;
    }
    registerScrollSetup(() => {
      ScrollTrigger.create({
        trigger: element,
        start,
        once: true,
        onEnter: () => playRevealPieces(element, SCROLL_ENTER_GATE),
      });
    });
  });
}
