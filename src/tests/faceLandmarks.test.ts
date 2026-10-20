import { describe, expect, it } from 'vitest';
import {
  assessFrame,
  EYE_LANDMARKS,
  extractEyes,
  eyeAspectRatio,
  meanEar,
  type NormalizedPoint,
} from '../vision/faceLandmarks';

const W = 1280;
const H = 720;

/**
 * Builds a synthetic 478-point face. `openness` is the eye's height/width ratio in PIXELS
 * (landmarks are normalised, so the vertical extent is rescaled by W/H).
 */
function syntheticFace(openness: number, opts: { irisOffset?: number; iris?: boolean } = {}): NormalizedPoint[] {
  const pts: NormalizedPoint[] = Array.from({ length: opts.iris === false ? 468 : 478 }, () => ({ x: 0.5, y: 0.5 }));
  const place = (side: 'left' | 'right', cx: number) => {
    const def = EYE_LANDMARKS[side];
    const w = 0.1; // eye width in normalised units
    const h = (w * W * openness) / H; // normalised height that is `openness` x width in pixels
    // p1..p6 = corner, upper, upper, corner, lower, lower
    const [p1, p2, p3, p4, p5, p6] = def.ear;
    pts[p1] = { x: cx - w / 2, y: 0.4 };
    pts[p4] = { x: cx + w / 2, y: 0.4 };
    pts[p2] = { x: cx - w / 6, y: 0.4 - h / 2 };
    pts[p3] = { x: cx + w / 6, y: 0.4 - h / 2 };
    pts[p6] = { x: cx - w / 6, y: 0.4 + h / 2 };
    pts[p5] = { x: cx + w / 6, y: 0.4 + h / 2 };
    def.contour.forEach((idx) => {
      if (!def.ear.includes(idx as never)) pts[idx] = { x: cx, y: 0.4 };
    });
    if (opts.iris !== false) {
      const ix = cx + (opts.irisOffset ?? 0) * w;
      pts[def.irisCenter] = { x: ix, y: 0.4 };
      const r = 0.02;
      def.irisRing.forEach((idx, i) => {
        const a = (i * Math.PI) / 2;
        pts[idx] = { x: ix + r * Math.cos(a), y: 0.4 + r * Math.sin(a) };
      });
    }
  };
  place('right', 0.4);
  place('left', 0.6);
  return pts;
}

describe('eyeAspectRatio', () => {
  it('matches the formula for a hand-computed eye', () => {
    // width 10, both vertical gaps 3 -> EAR = (3 + 3) / (2 * 10) = 0.3
    const ear = eyeAspectRatio([
      { x: 0, y: 0 },
      { x: 3, y: -1.5 },
      { x: 7, y: -1.5 },
      { x: 10, y: 0 },
      { x: 7, y: 1.5 },
      { x: 3, y: 1.5 },
    ]);
    expect(ear).toBeCloseTo(0.3, 5);
  });

  it('returns 0 for a degenerate eye and validates input length', () => {
    const p = { x: 1, y: 1 };
    expect(eyeAspectRatio([p, p, p, p, p, p])).toBe(0);
    expect(() => eyeAspectRatio([p])).toThrow(RangeError);
  });
});

describe('extractEyes / assessFrame', () => {
  it('reports no face for an empty result', () => {
    const fl = extractEyes([], W, H);
    expect(fl.faceCount).toBe(0);
    expect(assessFrame(fl, 0).faceStatus).toBe('none');
    expect(meanEar(fl)).toBeNull();
  });

  it('refuses frames with more than one face', () => {
    const fl = extractEyes([syntheticFace(0.3), syntheticFace(0.3)], W, H);
    const a = assessFrame(fl, 0);
    expect(a.faceStatus).toBe('multiple');
    expect(a.usable).toBe(false);
    expect(meanEar(fl)).toBeNull();
  });

  it('computes a plausible EAR and a usable assessment for an open, centred eye', () => {
    const fl = extractEyes([syntheticFace(0.3)], W, H);
    expect(meanEar(fl)).toBeCloseTo(0.3, 1);
    expect(fl.hasIrisLandmarks).toBe(true);
    expect(fl.right!.irisRadiusPx).toBeGreaterThan(0);
    const a = assessFrame(fl, 0);
    expect(a.usable).toBe(true);
    expect(a.eyeStatus).toBe('ok');
  });

  it('gives a much lower EAR for a closed eye', () => {
    const open = meanEar(extractEyes([syntheticFace(0.3)], W, H))!;
    const closed = meanEar(extractEyes([syntheticFace(0.05)], W, H))!;
    expect(closed).toBeLessThan(open / 3);
  });

  it('asks the user to move closer when the eyes are too small', () => {
    const fl = extractEyes([syntheticFace(0.3)], 320, 180); // same face, tiny frame -> small eyes in px
    const a = assessFrame(fl, 0);
    expect(a.eyeStatus).toBe('too-small');
    expect(a.guidance).toMatch(/closer/i);
  });

  it('asks the user to look at the camera when the iris is far off-centre', () => {
    const fl = extractEyes([syntheticFace(0.3, { irisOffset: 0.4 })], W, H);
    const a = assessFrame(fl, 0);
    expect(a.eyeStatus).toBe('off-axis');
    expect(a.guidance).toMatch(/look/i);
  });

  it('asks the user to hold still when the face is moving', () => {
    const fl = extractEyes([syntheticFace(0.3)], W, H);
    const a = assessFrame(fl, 0.2);
    expect(a.usable).toBe(false);
    expect(a.guidance).toMatch(/still/i);
  });

  it('does not claim iris localisation when the model returned no iris landmarks', () => {
    const fl = extractEyes([syntheticFace(0.3, { iris: false })], W, H);
    expect(fl.hasIrisLandmarks).toBe(false);
    expect(assessFrame(fl, 0).usable).toBe(false);
  });
});
