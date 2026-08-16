export const REDUCED_MOTION_STORAGE_KEY = "lore:reduced-motion";
export const REDUCED_MOTION_CHANGE_EVENT = "lore:reduced-motion-change";

export type ReducedMotionPreference = {
  explicit: boolean;
  reduced: boolean;
};

export type ReducedMotionStorage = Pick<Storage, "getItem" | "removeItem">;
export type ReducedMotionMedia = Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;
export type ReducedMotionEventTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export function readReducedMotionPreference({
  storage,
  media,
}: {
  storage?: ReducedMotionStorage;
  media?: Pick<MediaQueryList, "matches">;
}): ReducedMotionPreference {
  try {
    const stored = storage?.getItem(REDUCED_MOTION_STORAGE_KEY) ?? null;
    if (stored === "true") return { explicit: true, reduced: true };
    if (stored === "false") return { explicit: true, reduced: false };
    if (stored !== null) storage?.removeItem(REDUCED_MOTION_STORAGE_KEY);
  } catch {
    // Storage availability must not prevent the operating-system preference.
  }
  return { explicit: false, reduced: media?.matches === true };
}

export function subscribeToSystemReducedMotion(
  media: ReducedMotionMedia,
  isExplicitPreference: () => boolean,
  setReducedMotion: (reduced: boolean) => void,
) {
  const handleChange = (event: MediaQueryListEvent) => {
    if (!isExplicitPreference()) setReducedMotion(event.matches);
  };
  media.addEventListener("change", handleChange);
  return () => media.removeEventListener("change", handleChange);
}

export function subscribeToReducedMotionPreference(
  target: ReducedMotionEventTarget,
  setReducedMotion: (reduced: boolean) => void,
) {
  const handleChange = (event: Event) => {
    const reduced = (event as CustomEvent<unknown>).detail;
    if (typeof reduced === "boolean") setReducedMotion(reduced);
  };
  target.addEventListener(REDUCED_MOTION_CHANGE_EVENT, handleChange);
  return () => target.removeEventListener(REDUCED_MOTION_CHANGE_EVENT, handleChange);
}

export function shouldRenderMotionDecorations(motionReady: boolean, reducedMotion: boolean) {
  return motionReady && !reducedMotion;
}

export function motionClass(reducedMotion: boolean, animationClass: string) {
  return reducedMotion ? "" : animationClass;
}
