import { useEffect, useState, type RefObject } from 'react';
import type { FrameLandmarks } from '../types/scanner';
import { ScanOverlay } from './ScanOverlay';

interface Props {
  stream: MediaStream | null;
  videoRef: RefObject<HTMLVideoElement>;
  mirrored: boolean;
  landmarks: FrameLandmarks | null;
}

/**
 * Live preview. The frame takes the video's own aspect ratio (portrait or landscape) and is capped
 * by CSS to the viewport, so the preview never overflows the layout. The overlay canvas shares the
 * same box and the same mirroring, so landmarks line up with the picture.
 */
export function CameraView({ stream, videoRef, mirrored, landmarks }: Props) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;

    const onSize = () => {
      if (video.videoWidth > 0) setSize({ w: video.videoWidth, h: video.videoHeight });
    };
    video.addEventListener('loadedmetadata', onSize);
    video.addEventListener('resize', onSize); // fires when the device rotates

    if (stream) {
      video.play().catch(() => {
        /* Autoplay can be refused until the next tap; the camera start was already user-initiated. */
      });
    }
    return () => {
      video.removeEventListener('loadedmetadata', onSize);
      video.removeEventListener('resize', onSize);
      video.srcObject = null;
    };
  }, [stream, videoRef]);

  return (
    <div
      className="camera-frame"
      style={{ aspectRatio: size ? `${size.w} / ${size.h}` : '4 / 3' }}
      role="group"
      aria-label="Live camera preview"
    >
      <video ref={videoRef} className={mirrored ? 'mirrored' : undefined} playsInline muted autoPlay />
      <ScanOverlay landmarks={landmarks} mirrored={mirrored} />
      <div className="reticle" aria-hidden="true" />
    </div>
  );
}
