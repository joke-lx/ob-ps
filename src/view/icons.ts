// 双色线性图标 —— 风格参考 icons_minimal_line.html
//   - 2px 描边 / round cap & join / fill none, viewBox 24×24
//   - 主描边 currentColor (随按钮文字色, 亮/暗自适应)
//   - 点缀 var(--lr-accent) (merged-view 作用域内的靛蓝强调色)
//
// 仅用于 4 个操作按钮, 替代 Obsidian 内置 setIcon。
// 注意: 本项目 lint 开启了 SDL 安全规则, 禁止 innerHTML, 故用
// createElementNS 逐节点构建 SVG, 不解析任何 HTML 字符串。

export type LrIconName =
  | "erase-current"
  | "erase-all"
  | "repair"
  | "new-process";

const SVG_NS = "http://www.w3.org/2000/svg";

interface LrNode {
  tag: "path" | "line" | "rect" | "circle";
  /** true → 强调色 (var(--lr-accent)); 否则主描边 currentColor */
  accent?: boolean;
  attrs: Record<string, string>;
}

const ICONS: Record<LrIconName, LrNode[]> = {
  // 清除当前 —— 橡皮擦, 底部擦除轨迹用强调色
  "erase-current": [
    { tag: "path", attrs: { d: "m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" } },
    { tag: "path", attrs: { d: "m5 11 9 9" } },
    { tag: "line", accent: true, attrs: { x1: "22", y1: "21", x2: "7", y2: "21" } },
  ],
  // 清除全部 —— 扫帚, 底部扬尘用强调色
  "erase-all": [
    { tag: "path", attrs: { d: "M21 3 13 11" } },
    { tag: "path", attrs: { d: "M8 7 17 16" } },
    { tag: "path", attrs: { d: "M9 13c-2 0-4 1.5-4.5 3.5" } },
    { tag: "path", attrs: { d: "M12 14c-2 0-3.5 1-4.5 3" } },
    { tag: "line", accent: true, attrs: { x1: "3.5", y1: "20.5", x2: "6.5", y2: "20.5" } },
    { tag: "line", accent: true, attrs: { x1: "8.5", y1: "20.5", x2: "12", y2: "20.5" } },
  ],
  // 完善 —— 魔法火花, 两侧小十字火花用强调色
  repair: [
    { tag: "path", attrs: { d: "M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z" } },
    { tag: "line", accent: true, attrs: { x1: "19", y1: "3", x2: "19", y2: "7" } },
    { tag: "line", accent: true, attrs: { x1: "17", y1: "5", x2: "21", y2: "5" } },
    { tag: "line", accent: true, attrs: { x1: "4.5", y1: "17", x2: "4.5", y2: "19" } },
    { tag: "line", accent: true, attrs: { x1: "3.5", y1: "18", x2: "5.5", y2: "18" } },
  ],
  // 新建进程 —— 终端 + 强调色加号徽标
  "new-process": [
    { tag: "rect", attrs: { x: "3", y: "4", width: "14", height: "14", rx: "2" } },
    { tag: "path", attrs: { d: "m6 10 2 2-2 2" } },
    { tag: "line", attrs: { x1: "11", y1: "14", x2: "14", y2: "14" } },
    { tag: "line", accent: true, attrs: { x1: "19", y1: "6", x2: "19", y2: "12" } },
    { tag: "line", accent: true, attrs: { x1: "16", y1: "9", x2: "22", y2: "9" } },
  ],
};

function buildSvg(nodes: LrNode[]): SVGSVGElement {
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "lr-icon");
  for (const n of nodes) {
    const node = activeDocument.createElementNS(SVG_NS, n.tag) as SVGElement;
    if (n.accent) {
      // 强调色由 CSS 类 .lr-ac 提供 (var(--lr-accent), merged-view 作用域内解析)
      node.setAttribute("class", "lr-ac");
    } else {
      node.setAttribute("stroke", "currentColor");
    }
    for (const [k, v] of Object.entries(n.attrs)) {
      node.setAttribute(k, v);
    }
    svg.appendChild(node);
  }
  return svg;
}

/** 把双色线性图标注入 el (替代 setIcon, 仅用于 4 个操作按钮)。 */
export function setLrIcon(el: HTMLElement, name: LrIconName): void {
  el.empty();
  el.appendChild(buildSvg(ICONS[name]));
}
