import { describe, expect, it } from 'vitest';
import { MAX_MODEL_LENGTH, latestModel } from './transcript-model.js';

function assistant(model: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: 'assistant', message: { model, content: [] }, ...extra });
}

describe('latestModel', () => {
  it('reads the model and effort of the last assistant line', () => {
    const lines = [
      assistant('claude-haiku-5-5', { effort: 'low' }),
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      assistant('claude-sonnet-5-5', { effort: 'high' }),
      JSON.stringify({ type: 'system', subtype: 'turn_duration' }),
      '',
    ];
    expect(latestModel(lines)).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' });
  });

  it('reports no effort when the line has none', () => {
    expect(latestModel([assistant('claude-opus-5-5')])).toEqual({
      model: 'claude-opus-5-5',
      effort: null,
    });
    expect(latestModel([assistant('claude-opus-5-5', { effort: 7 })])?.effort).toBeNull();
  });

  it('skips synthetic, sidechain and malformed lines', () => {
    const lines = [
      assistant('claude-opus-5-5', { effort: 'medium' }),
      assistant('claude-haiku-5-5', { effort: 'low', isSidechain: true }),
      assistant('<synthetic>'),
      assistant(42),
      assistant('   '),
      assistant('x'.repeat(MAX_MODEL_LENGTH + 1)),
      JSON.stringify({ type: 'assistant', message: 'text' }),
      JSON.stringify({ type: 'progress', data: { type: 'assistant' }, message: { model: 'm' } }),
      '{"type":"assistant", broken',
      JSON.stringify(['assistant']),
    ];
    expect(latestModel(lines)).toEqual({ model: 'claude-opus-5-5', effort: 'medium' });
  });

  it('returns null without assistant lines', () => {
    expect(latestModel([])).toBeNull();
    expect(latestModel([JSON.stringify({ type: 'user' })])).toBeNull();
  });
});
