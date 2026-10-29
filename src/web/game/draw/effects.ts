import type { Point } from '../map.js';
import type { Effect } from '../stations.js';
import type { Paint } from './paint.js';

export const MAX_PARTICLES = 400;

export type ParticleKind = Effect;

export interface Emitter {
  key: string;
  kind: ParticleKind;
  at: Point;
  rate: number;
}

interface Spec {
  colors: readonly string[];
  life: [number, number];
  speed: { x: [number, number]; y: [number, number] };
  gravity: number;
  size: number;
  spread: number;
}

export const SPECS: Record<ParticleKind, Spec> = {
  bubbles: {
    colors: ['#7fe0c4', '#c38bff', '#ff8ad8'],
    life: [0.8, 1.4],
    speed: { x: [-4, 4], y: [-18, -10] },
    gravity: 0,
    size: 2,
    spread: 6,
  },
  sparks: {
    colors: ['#ffe28a', '#ffb347', '#ffffff'],
    life: [0.25, 0.5],
    speed: { x: [-30, 30], y: [-40, -15] },
    gravity: 120,
    size: 1,
    spread: 3,
  },
  magic: {
    colors: ['#b07cff', '#7fd3ff', '#e2c6ff'],
    life: [0.7, 1.2],
    speed: { x: [-6, 6], y: [-16, -8] },
    gravity: -4,
    size: 1,
    spread: 8,
  },
  smoke: {
    colors: ['#8c8c8c', '#a9a9a9', '#6e6e6e'],
    life: [1.2, 2],
    speed: { x: [-3, 5], y: [-12, -6] },
    gravity: -2,
    size: 3,
    spread: 6,
  },
  dust: {
    colors: ['#c9a77a', '#e0c79e'],
    life: [0.5, 0.9],
    speed: { x: [-10, 10], y: [-8, -2] },
    gravity: 20,
    size: 1,
    spread: 8,
  },
  embers: {
    colors: ['#ff8a2a', '#ffcf5a', '#ff5a2a'],
    life: [0.9, 1.6],
    speed: { x: [-5, 5], y: [-22, -12] },
    gravity: -3,
    size: 1,
    spread: 6,
  },
  sawdust: {
    colors: ['#e8c48a', '#d4a964'],
    life: [0.5, 0.9],
    speed: { x: [-16, 16], y: [-14, -4] },
    gravity: 60,
    size: 1,
    spread: 6,
  },
  paper: {
    colors: ['#f6efe0', '#e8dcc2'],
    life: [1, 1.6],
    speed: { x: [-10, 10], y: [-10, -4] },
    gravity: 8,
    size: 2,
    spread: 6,
  },
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  color: string;
  size: number;
  gravity: number;
}

function between(random: () => number, [min, max]: [number, number]): number {
  return min + random() * (max - min);
}

export class Particles {
  private particles: Particle[] = [];
  private readonly debt = new Map<string, number>();

  constructor(private readonly random: () => number = Math.random) {}

  get count(): number {
    return this.particles.length;
  }

  spawn(kind: ParticleKind, at: Point): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    const spec = SPECS[kind];
    const color = spec.colors[Math.floor(this.random() * spec.colors.length)] ?? '#ffffff';
    this.particles.push({
      x: at.x + (this.random() - 0.5) * spec.spread,
      y: at.y + (this.random() - 0.5) * (spec.spread / 2),
      vx: between(this.random, spec.speed.x),
      vy: between(this.random, spec.speed.y),
      age: 0,
      life: between(this.random, spec.life),
      color,
      size: spec.size,
      gravity: spec.gravity,
    });
  }

  update(dt: number, emitters: readonly Emitter[]): void {
    this.particles = this.particles.filter((particle) => {
      particle.age += dt;
      particle.vy += particle.gravity * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      return particle.age < particle.life;
    });
    const active = new Set<string>();
    for (const emitter of emitters) {
      active.add(emitter.key);
      let due = (this.debt.get(emitter.key) ?? 0) + emitter.rate * dt;
      while (due >= 1) {
        this.spawn(emitter.kind, emitter.at);
        due -= 1;
      }
      this.debt.set(emitter.key, due);
    }
    for (const key of this.debt.keys()) {
      if (!active.has(key)) this.debt.delete(key);
    }
  }

  draw(ctx: Paint): void {
    for (const particle of this.particles) {
      ctx.globalAlpha = Math.max(0, 1 - particle.age / particle.life);
      ctx.fillStyle = particle.color;
      ctx.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
    }
    ctx.globalAlpha = 1;
  }
}
