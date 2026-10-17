import { unwrapBitnob } from './bitnob-envelope.util';

describe('unwrapBitnob', () => {
  it('returns the `data` field of a full Bitnob envelope', () => {
    expect(
      unwrapBitnob({ success: true, message: 'ok', data: { x: 1 }, timestamp: '2026-08-29T00:00:00Z' }),
    ).toEqual({ x: 1 });
  });

  it('passes a non-envelope object through unchanged', () => {
    expect(unwrapBitnob({ x: 1 })).toEqual({ x: 1 });
  });

  it('passes null/primitive through unchanged', () => {
    expect(unwrapBitnob(null)).toBeNull();
    expect(unwrapBitnob('raw')).toBe('raw');
  });

  it('throws the envelope message when success is false', () => {
    expect(() =>
      unwrapBitnob({ success: false, message: 'nope', data: null, timestamp: '2026-08-29T00:00:00Z' }),
    ).toThrow('nope');
  });

  it('throws a fallback message when success is false and message is empty', () => {
    expect(() =>
      unwrapBitnob({ success: false, message: '', data: null, timestamp: '2026-08-29T00:00:00Z' }),
    ).toThrow('Bitnob returned success: false');
  });
});
