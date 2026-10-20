import { useEffect, useRef } from 'react';
import type { EyeGeometry, FrameLandmarks } from '../types/scanner';

interface Props {
  landmarks: FrameLandmarks | null;
  mirrored: boolean;
}

function drawEye(ctx: CanvasRenderingContext2D, eye: EyeGeometry, scale: number): void {
  ctx.lineWidth = 2 * scale;
  ctx.strokeStyle = '#2dd4bf';
  ctx.beginPath();
  eye.contour.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();

  if (eye.irisPoints.length > 0) {
    ctx.strokeStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(eye.irisCenter.x, eye.irisCenter.y, eye.irisRadiusPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#22d3ee';
    for (const p of eye.irisPoints) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.8 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(eye.irisCenter.x, eye.irisCenter.y, 2.5 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Draws eye contours and estimated iris circles on top of the video, in video-pixel coordinates. */
export function ScanOverlay({ landmarks, mirrored }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!landmarks || landmarks.faceCount !== 1) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    if (canvas.width !== landmarks.width || canvas.height !== landmarks.height) {
      canvas.width = landmarks.width;
      canvas.height = landmarks.height;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.max(1, landmarks.width / 640);
    if (landmarks.left) drawEye(ctx, landmarks.left, scale);
    if (landmarks.right) drawEye(ctx, landmarks.right, scale);
  }, [landmarks]);

  return <canvas ref={canvasRef} className={`overlay${mirrored ? ' mirrored' : ''}`} aria-hidden="true" />;
}
