import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());
// jsdom has no matchMedia; treat tests as "reduced motion" so GSAP never runs.
window.matchMedia = window.matchMedia || ((q) => ({ matches: /reduce/.test(q), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
