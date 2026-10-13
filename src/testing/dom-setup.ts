/**
 * Vitest setup for component tests running under jsdom. jsdom lacks a few
 * layout APIs that Radix / cmdk touch on open; stub them so components can
 * mount. Node-environment tests import this too but skip the DOM parts.
 */
import { afterEach } from "vitest";

if (typeof window !== "undefined") {
  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, "ResizeObserver", { value: ResizeObserverStub });
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  // jsdom implements neither; the composer only uses them for layout polish.
  window.scrollTo = () => {};
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as typeof HTMLCanvasElement.prototype.getContext;
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      }),
    });
  }

  afterEach(async () => {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  });
}
