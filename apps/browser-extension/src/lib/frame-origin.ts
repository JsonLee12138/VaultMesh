export type FrameLike = { frameId: number; parentFrameId: number; url: string };

export function sameOriginFrameIds(frames: FrameLike[], topOrigin: string) {
  const byId = new Map(frames.map((frame) => [frame.frameId, frame]));
  const origins = new Map<number, string | null>();

  const originFor = (frame: FrameLike, visiting = new Set<number>()): string | null => {
    if (origins.has(frame.frameId)) return origins.get(frame.frameId) ?? null;
    const direct = httpOrigin(frame.url);
    if (direct) {
      origins.set(frame.frameId, direct);
      return direct;
    }
    if (!inheritsParentOrigin(frame.url) || frame.parentFrameId < 0 || visiting.has(frame.frameId)) return null;
    visiting.add(frame.frameId);
    const parent = byId.get(frame.parentFrameId);
    const inherited = parent ? originFor(parent, visiting) : null;
    origins.set(frame.frameId, inherited);
    return inherited;
  };

  return frames.filter((frame) => originFor(frame) === topOrigin).map((frame) => frame.frameId);
}

function httpOrigin(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

function inheritsParentOrigin(url: string) {
  return url === "about:srcdoc" || url === "about:blank" || url.startsWith("about:blank#") || url.startsWith("about:blank?");
}
