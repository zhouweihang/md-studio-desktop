/**
 * 视图控制的纯逻辑（REQ-025）：缩放级别夹取与步进。
 * 主进程与渲染层共用，便于单测（Chromium zoom level：0=100%，每级约 20%）。
 */

import { ZOOM_LEVEL_MAX, ZOOM_LEVEL_MIN } from './settings';

export const ZOOM_STEP = 1;

export function clampZoomLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(ZOOM_LEVEL_MAX, Math.max(ZOOM_LEVEL_MIN, Math.round(level)));
}

/** 相对步进：direction 1=放大、-1=缩小、0=重置。 */
export function stepZoomLevel(current: number, direction: 1 | -1 | 0): number {
  if (direction === 0) return 0;
  return clampZoomLevel(current + direction * ZOOM_STEP);
}

/** 缩放级别的百分比显示（Chromium 每级 1.2 倍）。 */
export function zoomPercent(level: number): string {
  const factor = 1.2 ** clampZoomLevel(level);
  return `${Math.round(factor * 100)}%`;
}
