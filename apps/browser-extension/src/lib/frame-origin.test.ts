import { describe, expect, it } from "vitest";

import { sameOriginFrameIds } from "./frame-origin";

describe("sameOriginFrameIds", () => {
  it("includes nested about:srcdoc and about:blank frames that inherit the top origin", () => {
    const frames = [
      { frameId: 0, parentFrameId: -1, url: "https://example.test/account" },
      { frameId: 2, parentFrameId: 0, url: "about:srcdoc" },
      { frameId: 3, parentFrameId: 2, url: "about:blank" },
    ];

    expect(sameOriginFrameIds(frames, "https://example.test")).toEqual([0, 2, 3]);
  });

  it("excludes cross-origin and non-inheriting opaque frames", () => {
    const frames = [
      { frameId: 0, parentFrameId: -1, url: "https://example.test/account" },
      { frameId: 2, parentFrameId: 0, url: "https://other.test/login" },
      { frameId: 3, parentFrameId: 0, url: "data:text/html,login" },
    ];

    expect(sameOriginFrameIds(frames, "https://example.test")).toEqual([0]);
  });
});
