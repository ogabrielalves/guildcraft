export const TOOLTIP_OFFSET = 12;

export interface Tooltip {
  readonly element: HTMLElement;
  show(text: string, x: number, y: number): void;
  hide(): void;
  destroy(): void;
}

export interface Box {
  width: number;
  height: number;
}

export function placeTooltip(
  x: number,
  y: number,
  tip: Box,
  bounds: Box,
): { left: number; top: number } {
  const right = x + TOOLTIP_OFFSET + tip.width;
  const below = y + TOOLTIP_OFFSET + tip.height;
  const left = right > bounds.width ? x - TOOLTIP_OFFSET - tip.width : x + TOOLTIP_OFFSET;
  const top = below > bounds.height ? y - TOOLTIP_OFFSET - tip.height : y + TOOLTIP_OFFSET;
  return { left: Math.max(0, left), top: Math.max(0, top) };
}

export function createTooltip(): Tooltip {
  const element = document.createElement('div');
  element.className = 'tooltip';
  element.setAttribute('role', 'tooltip');
  element.hidden = true;

  return {
    element,
    show(text, x, y) {
      element.textContent = text;
      element.hidden = false;
      const parent = element.parentElement;
      const bounds = parent
        ? { width: parent.clientWidth, height: parent.clientHeight }
        : { width: Infinity, height: Infinity };
      const tip = { width: element.offsetWidth, height: element.offsetHeight };
      const { left, top } = placeTooltip(x, y, tip, bounds);
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    },
    hide() {
      element.hidden = true;
    },
    destroy() {
      element.remove();
    },
  };
}
