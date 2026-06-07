/**
 * Observe the app root's content box and report preferred dimensions to the
 * host via the embed bridge `resize` message. The host modal can use these to
 * size the iframe (or it can ignore them and use a fixed/responsive frame).
 */

import { useEffect } from "react";
import type { EmbedBridge } from "./embed";

export function useResizeReporter(
  bridge: EmbedBridge,
  el: HTMLElement | null,
): void {
  useEffect(() => {
    if (!bridge.embedded || !el) return;
    let raf = 0;
    const report = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        bridge.resize(el.scrollWidth, el.scrollHeight);
      });
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    report();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [bridge, el]);
}
