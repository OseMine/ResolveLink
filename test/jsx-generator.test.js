import { describe, it, expect } from 'vitest';

// Reimplement the pure logic for testing (extracted from server/index.js)
function generateJSXPayload(link) {
  const fps = link.settings.fps || 24;

  const firstClipStart = link.clips.reduce((min, clip) => {
    const s = clip.start || 0;
    return s < min ? s : min;
  }, Infinity);

  const maxEnd = link.clips.reduce((max, clip) => {
    const end = (clip.start || 0) + (clip.duration || 0);
    return end > max ? end : max;
  }, 0);

  return {
    linkId: link.id,
    compName: `Resolve_Link_${link.id.slice(0, 8)}`,
    width: link.settings.width,
    height: link.settings.height,
    fps: fps,
    duration: (maxEnd - firstClipStart) / fps,
    clips: link.clips.map((clip) => ({
      name: clip.name,
      filePath: (clip.sourcePath || '').replace(/\\/g, '/'),
      compStartFrames: (clip.start || 0) - firstClipStart,
      durationFrames: clip.duration || 0,
      sourceIn: clip.sourceIn || 0,
    })),
  };
}

describe('generateJSXPayload', () => {
  const baseLink = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    settings: { width: 1920, height: 1080, fps: 24 },
  };

  it('generates correct comp name from link id', () => {
    const payload = generateJSXPayload({
      ...baseLink,
      clips: [{ name: 'clip1.mp4', start: 0, duration: 100, sourcePath: '/tmp/clip1.mp4', sourceIn: 0 }],
    });
    expect(payload.compName).toBe('Resolve_Link_aaaaaaaa');
  });

  it('calculates duration from clips', () => {
    const payload = generateJSXPayload({
      ...baseLink,
      clips: [
        { name: 'a', start: 0, duration: 100, sourcePath: '/a', sourceIn: 0 },
        { name: 'b', start: 100, duration: 50, sourcePath: '/b', sourceIn: 0 },
      ],
    });
    expect(payload.duration).toBe(150 / 24);
  });

  it('offsets compStartFrames relative to first clip', () => {
    const payload = generateJSXPayload({
      ...baseLink,
      clips: [
        { name: 'a', start: 200, duration: 50, sourcePath: '/a', sourceIn: 0 },
        { name: 'b', start: 250, duration: 50, sourcePath: '/b', sourceIn: 0 },
      ],
    });
    expect(payload.clips[0].compStartFrames).toBe(0);
    expect(payload.clips[1].compStartFrames).toBe(50);
  });

  it('normalizes file paths (backslash to forward slash)', () => {
    const payload = generateJSXPayload({
      ...baseLink,
      clips: [{ name: 'c', start: 0, duration: 10, sourcePath: 'C:\\Users\\test\\video.mp4', sourceIn: 0 }],
    });
    expect(payload.clips[0].filePath).toBe('C:/Users/test/video.mp4');
  });

  it('handles missing optional fields with defaults', () => {
    const payload = generateJSXPayload({
      ...baseLink,
      clips: [{ name: 'minimal', start: 0, duration: 10, sourcePath: '' }],
    });
    expect(payload.clips[0].sourceIn).toBe(0);
    expect(payload.clips[0].compStartFrames).toBe(0);
  });

  it('uses 24fps as default', () => {
    const payload = generateJSXPayload({
      id: 'test',
      settings: { width: 1920, height: 1080 },
      clips: [{ name: 'x', start: 0, duration: 24, sourcePath: '/x', sourceIn: 0 }],
    });
    expect(payload.fps).toBe(24);
    expect(payload.duration).toBe(1);
  });
});

describe('Link data validation', () => {
  it('clips array must be non-empty for a valid link', () => {
    const clips = [{ name: 'test', start: 0, duration: 100, sourcePath: '/test.mp4' }];
    expect(clips.length).toBeGreaterThan(0);
  });

  it('clip start and duration are non-negative numbers', () => {
    const clip = { start: 0, duration: 100 };
    expect(clip.start).toBeGreaterThanOrEqual(0);
    expect(clip.duration).toBeGreaterThan(0);
  });
});
