import { animate, type AnimationPlaybackControlsWithThen, type DOMKeyframesDefinition, type AnimationOptions } from "motion";

export const MOTION_EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function isMotionEnabled(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.dataset.motion === "off") return false;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }
  return true;
}

export function animateMotion(
  element: Element,
  keyframes: DOMKeyframesDefinition,
  options: AnimationOptions = {},
): AnimationPlaybackControlsWithThen | null {
  stopElementMotion(element, false);
  const token = nextAnimationToken++;
  const control = !isMotionEnabled()
    ? animate(element, keyframes, { ...options, duration: 0 })
    : animate(element, keyframes, {
        duration: 0.18,
        ease: MOTION_EASE_OUT,
        ...options,
      });
  activeAnimations.set(element, { token, control });
  void control.finished
    .then(() => {
      const entry = activeAnimations.get(element);
      if (entry?.token === token) {
        activeAnimations.delete(element);
      }
    })
    .catch(() => undefined);
  return control;
}

const activeAnimations = new WeakMap<Element, { token: number; control: AnimationPlaybackControlsWithThen }>();
let nextAnimationToken = 1;

export function clearMotionStyles(element: HTMLElement): void {
  element.style.opacity = "";
  element.style.transform = "";
  element.style.clipPath = "";
  element.style.transformOrigin = "";
}

export function stopElementMotion(element: Element | null | undefined, resetStyles = true): void {
  if (!element) return;
  const current = activeAnimations.get(element);
  if (current) {
    current.token = -1;
    current.control.stop();
    activeAnimations.delete(element);
  }
  if (resetStyles && element instanceof HTMLElement) {
    clearMotionStyles(element);
  }
}

export function playElementMotion(
  element: HTMLElement,
  keyframes: DOMKeyframesDefinition,
  options: AnimationOptions & { transformOrigin?: string; keepStyles?: boolean } = {},
): AnimationPlaybackControlsWithThen | null {
  const { transformOrigin, keepStyles = false, ...motionOptions } = options;
  stopElementMotion(element, true);
  if (!isMotionEnabled()) return null;

  if (transformOrigin) {
    element.style.transformOrigin = transformOrigin;
  }

  const token = nextAnimationToken++;
  const control = animate(element, keyframes, {
    duration: 0.2,
    ease: MOTION_EASE_OUT,
    ...motionOptions,
  });
  activeAnimations.set(element, { token, control });

  void control.finished
    .then(() => {
      const entry = activeAnimations.get(element);
      if (entry?.token === token) {
        activeAnimations.delete(element);
        if (!keepStyles) clearMotionStyles(element);
      }
    })
    .catch(() => undefined);

  return control;
}

export function animateFadeScaleIn(element: HTMLElement, duration = 0.16, yOffset = -4): AnimationPlaybackControlsWithThen | null {
  return playElementMotion(
    element,
    {
      opacity: [0, 1],
      y: [yOffset, 0],
      scale: [0.97, 1],
    },
    { duration },
  );
}
