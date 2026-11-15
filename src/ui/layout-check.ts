/** HUD 版面檢查：確保按鈕彼此不重疊、不超出安全區、不遮住狀態列。純函式可單元測試。 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LayoutItem {
  id: string;
  rect: Rect;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return (
    a.left < b.right + margin &&
    b.left < a.right + margin &&
    a.top < b.bottom + margin &&
    b.top < a.bottom + margin
  );
}

export function findLayoutIssues(
  items: readonly LayoutItem[],
  viewportWidth: number,
  viewportHeight: number,
  safe: Insets = { top: 0, right: 0, bottom: 0, left: 0 },
  minGap = 4,
): string[] {
  const issues: string[] = [];
  for (const it of items) {
    const r = it.rect;
    if (r.right - r.left <= 0 || r.bottom - r.top <= 0) {
      issues.push(`${it.id}: 尺寸為 0（未顯示）`);
      continue;
    }
    if (
      r.left < safe.left - 0.5 ||
      r.top < safe.top - 0.5 ||
      r.right > viewportWidth - safe.right + 0.5 ||
      r.bottom > viewportHeight - safe.bottom + 0.5
    ) {
      issues.push(`${it.id}: 超出安全顯示區`);
    }
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (rectsOverlap(a.rect, b.rect, minGap)) issues.push(`${a.id} 與 ${b.id} 重疊或間距小於 ${minGap}px`);
    }
  }
  return issues;
}

/** 觸控目標最小尺寸（Apple HIG 建議 44pt） */
export function findSmallTouchTargets(items: readonly LayoutItem[], min = 44): string[] {
  return items
    .filter((it) => it.rect.right - it.rect.left < min - 0.5 || it.rect.bottom - it.rect.top < min - 0.5)
    .map((it) => `${it.id}: 觸控範圍小於 ${min}px`);
}

/** 瀏覽器端：收集 HUD 中標記 data-layout 的元素 */
export function collectLayoutItems(root: ParentNode): LayoutItem[] {
  return [...root.querySelectorAll<HTMLElement>("[data-layout]")].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.layout ?? el.id, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
  });
}

/** 瀏覽器端：讀取 CSS env(safe-area-inset-*) 實際數值 */
export function readSafeAreaInsets(): Insets {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;" +
    "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const insets = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

export function checkHud(root: ParentNode, insets: Insets = readSafeAreaInsets()): string[] {
  const items = collectLayoutItems(root);
  const touch = items.filter((i) => i.id.startsWith("btn-"));
  return [
    ...findLayoutIssues(items, window.innerWidth, window.innerHeight, insets),
    ...findSmallTouchTargets(touch),
  ];
}
