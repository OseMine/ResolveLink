// @ts-ignore — plain JS module
import TextAnimator from './TextAnimator.js';

export type TextAnimatorSelector = 'letter' | 'word' | 'line' | 'all';
export type TextAnimatorOrder = 'forward' | 'backward' | 'random' | 'from-center' | 'to-center';
export type TextAnimatorLoop = 'none' | 'loop' | 'alternate' | 'yoyo';

export interface TextAnimatorFrom {
  opacity?: number;
  x?: number;
  y?: number;
  scale?: number;
  scaleX?: number | null;
  scaleY?: number | null;
  rotate?: number;
  rotateX?: number;
  rotateY?: number;
  skewX?: number;
  skewY?: number;
  blur?: number;
  brightness?: number;
  contrast?: number;
  saturate?: number;
  color?: string | null;
  letterSpacing?: string | number | null;
  wordSpacing?: string | number | null;
}

export interface TextAnimatorOptions {
  target: string;
  preset?: string;
  selector?: TextAnimatorSelector;
  order?: TextAnimatorOrder;
  from?: TextAnimatorFrom;
  to?: Partial<TextAnimatorFrom>;
  duration?: number;
  stagger?: number;
  delay?: number;
  easing?: string;
  loop?: TextAnimatorLoop;
  loopDelay?: number;
  onStart?: (anim: TextAnimatorInstance) => void;
  onComplete?: (anim: TextAnimatorInstance) => void;
  onLoop?: (anim: TextAnimatorInstance) => void;
  perspective?: number;
}

export interface TextAnimatorInstance {
  play: (direction?: 'forward' | 'reverse') => TextAnimatorInstance;
  forward: () => TextAnimatorInstance;
  reverse: () => TextAnimatorInstance;
  start: () => TextAnimatorInstance;
  stop: () => TextAnimatorInstance;
  seek: (progress: number) => TextAnimatorInstance;
  reset: () => TextAnimatorInstance;
  setText: (text: string) => TextAnimatorInstance;
  destroy: () => void;
  readonly isPlaying: boolean;
  readonly totalDuration: number;
}

export default TextAnimator;
