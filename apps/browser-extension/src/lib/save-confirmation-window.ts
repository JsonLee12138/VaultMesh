export const SAVE_CONFIRMATION_WINDOW_WIDTH = 340;
export const SAVE_CONFIRMATION_WINDOW_HEIGHT = 150;
export const SAVE_CONFIRMATION_WINDOW_INSET = 8;

type WindowBounds = {
  left?: number;
  top?: number;
  width?: number;
};

export function saveConfirmationWindowPosition(bounds: WindowBounds | null | undefined): { left?: number; top?: number } {
  if (bounds?.left == null || bounds.top == null || bounds.width == null) return {};
  return {
    left: Math.round(Math.max(bounds.left, bounds.left + bounds.width - SAVE_CONFIRMATION_WINDOW_WIDTH - SAVE_CONFIRMATION_WINDOW_INSET)),
    top: Math.round(bounds.top + SAVE_CONFIRMATION_WINDOW_INSET),
  };
}
