// GSAP helpers. Every animation is skipped (elements jump straight to their final state) when the user
// prefers reduced motion, and animations only touch transform/opacity for performance.
import { useEffect, useLayoutEffect } from 'react';
import gsap from 'gsap';

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Fade/slide children marked with [data-animate] into place, staggered. */
export function useEnter(ref, deps = []) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || prefersReducedMotion()) return undefined;
    const targets = root.querySelectorAll('[data-animate]');
    if (!targets.length) return undefined;
    const ctx = gsap.context(() => {
      gsap.fromTo(targets, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: 'power2.out', stagger: 0.06, clearProps: 'transform,opacity' });
    }, root);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function animateIn(el, { y = 10, duration = 0.28 } = {}) {
  if (!el || prefersReducedMotion()) return;
  gsap.fromTo(el, { y, opacity: 0 }, { y: 0, opacity: 1, duration, ease: 'power2.out', clearProps: 'transform,opacity' });
}

/** Modal / drawer entrance. */
export function useDialogMotion(ref, open, kind = 'modal') {
  useEffect(() => {
    if (!open || !ref.current || prefersReducedMotion()) return;
    const el = ref.current;
    const from = kind === 'drawer' ? { x: -24, opacity: 0 } : { y: 16, scale: 0.98, opacity: 0 };
    gsap.fromTo(el, from, { x: 0, y: 0, scale: 1, opacity: 1, duration: 0.26, ease: 'power2.out', clearProps: 'transform,opacity' });
  }, [open, ref, kind]);
}

/** Smoothly expand/collapse an element of unknown height (transaction details). */
export function expandCollapse(el, open) {
  if (!el) return;
  if (prefersReducedMotion()) { el.style.height = open ? 'auto' : '0px'; el.style.opacity = open ? 1 : 0; return; }
  if (open) {
    gsap.fromTo(el, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, duration: 0.3, ease: 'power2.out' });
  } else {
    gsap.to(el, { height: 0, opacity: 0, duration: 0.22, ease: 'power2.in' });
  }
}

export function countUp(el, to, format, duration = 0.8) {
  if (!el) return;
  if (prefersReducedMotion()) { el.textContent = format(to); return; }
  const o = { v: 0 };
  gsap.to(o, { v: to, duration, ease: 'power2.out', onUpdate: () => { el.textContent = format(Math.round(o.v)); } });
}
