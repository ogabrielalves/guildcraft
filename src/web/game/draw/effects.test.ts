import { describe, expect, it } from 'vitest';
import { EFFECTS } from '../stations.js';
import type { Emitter } from './effects.js';
import { MAX_PARTICLES, Particles, SPECS } from './effects.js';
import { recordingPaint } from './recording-paint.js';

function emitter(rate: number, key = 'a'): Emitter {
  return { key, kind: 'smoke', at: { x: 100, y: 50 }, rate };
}

describe('Particles', () => {
  it('has a spec for every station effect', () => {
    expect(Object.keys(SPECS).sort()).toEqual([...EFFECTS].sort());
  });

  it('emits at the emitter rate, carrying fractions between frames', () => {
    const particles = new Particles(() => 0);
    particles.update(0.25, [emitter(6)]);
    expect(particles.count).toBe(1);
    particles.update(0.25, [emitter(6)]);
    expect(particles.count).toBe(3);
  });

  it('forgets the debt of emitters that stop', () => {
    const particles = new Particles(() => 0);
    particles.update(0.15, [emitter(6)]);
    particles.update(0.15, []);
    particles.update(0.15, [emitter(6)]);
    expect(particles.count).toBe(0);
  });

  it('moves particles and drops them when they expire', () => {
    const particles = new Particles(() => 0.5);
    particles.spawn('bubbles', { x: 10, y: 10 });
    const ctx = recordingPaint();
    particles.draw(ctx);
    expect(ctx.named('fillRect')[0]?.args).toEqual([10, 10, 2, 2]);
    particles.update(0.5, []);
    particles.draw(ctx);
    expect(ctx.named('fillRect')[1]?.args[1]).toBe(3);
    expect(ctx.named('fillRect')[1]?.globalAlpha).toBeCloseTo(1 - 0.5 / 1.1);
    expect(ctx.globalAlpha).toBe(1);
    particles.update(1, []);
    expect(particles.count).toBe(0);
  });

  it('applies gravity', () => {
    const particles = new Particles(() => 0);
    particles.spawn('sparks', { x: 0, y: 0 });
    particles.update(0.1, []);
    const ctx = recordingPaint();
    particles.draw(ctx);
    expect(ctx.named('fillRect')[0]?.args.slice(0, 2)).toEqual([-4, -4]);
  });

  it('caps the number of particles', () => {
    const particles = new Particles(() => 0);
    particles.update(1, [emitter(MAX_PARTICLES + 50)]);
    expect(particles.count).toBe(MAX_PARTICLES);
  });

  it('falls back to white when the random source overflows', () => {
    const particles = new Particles(() => 1);
    particles.spawn('paper', { x: 0, y: 0 });
    const ctx = recordingPaint();
    particles.draw(ctx);
    expect(ctx.named('fillRect')[0]?.fillStyle).toBe('#ffffff');
  });
});
