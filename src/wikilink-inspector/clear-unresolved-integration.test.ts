/**
 * 集成测试:验证 collect → apply 的完整链路在真实文本上的行为。
 */
import { describe, it, expect } from "vitest";
import {
  collectUnresolvedEdits,
  applyEditsToString,
  type CollectorSourceLite,
} from "./clear-unresolved";

interface MockFile {
  path: string;
  content: string;
  links: Array<{
    link: string;
    position?: {
      start: { line: number; col: number };
      end: { line: number; col: number };
    };
  }>;
  unresolved: string[];
}

function makeSource(files: MockFile[]): CollectorSourceLite {
  const map = new Map(files.map((f) => [f.path, f]));
  return {
    listMarkdownFiles() {
      return files.map((f) => ({ path: f.path }));
    },
    getFileLinks(path) {
      const f = map.get(path);
      if (!f) return null;
      return f.links;
    },
    getUnresolvedTargets(path) {
      const f = map.get(path);
      return new Set(f?.unresolved ?? []);
    },
  };
}

function posFor(text: string, target: string) {
  const idx = text.indexOf(target);
  if (idx < 0) throw new Error(`not found: ${target}`);
  const before = text.slice(0, idx);
  const lines = before.split("\n");
  const line = lines.length - 1;
  const col = lines[lines.length - 1].length;
  const after = before + target;
  const endLines = after.split("\n");
  return {
    start: { line, col },
    end: { line: endLines.length - 1, col: endLines[endLines.length - 1].length },
  };
}

describe("集成:collect → apply", () => {
  it("单个文件单个未解析双链:写入后 [[x]] → [x]", () => {
    const content = "前言\n\n这是 [[不存在]] 的引用。\n";
    const file: MockFile = {
      path: "a.md",
      content,
      links: [{ link: "不存在", position: posFor(content, "[[不存在]]") }],
      unresolved: ["不存在"],
    };
    const src = makeSource([file]);
    const edits = collectUnresolvedEdits(src);
    expect(edits).toHaveLength(1);
    expect(edits[0].replacement).toBe("[不存在]");
    expect(edits[0].position).toBeDefined();
    expect(edits[0].end).toBeDefined();
    expect(edits[0].end.col).toBeGreaterThan(edits[0].position.col);

    const { result, applied } = applyEditsToString(content, edits);
    expect(applied).toBe(1);
    expect(result).toBe("前言\n\n这是 [不存在] 的引用。\n");
  });

  it("已解析双链不应被收集", () => {
    const content = "见 [[存在的笔记]] 和 [[不存在的笔记]]。";
    const file: MockFile = {
      path: "a.md",
      content,
      links: [
        { link: "存在的笔记", position: posFor(content, "[[存在的笔记]]") },
        { link: "不存在的笔记", position: posFor(content, "[[不存在的笔记]]") },
      ],
      unresolved: ["不存在的笔记"],
    };
    const src = makeSource([file]);
    const edits = collectUnresolvedEdits(src);
    expect(edits).toHaveLength(1);
    expect(edits[0].replacement).toBe("[不存在的笔记]");
  });

  it("带 alias 的未解析双链:replacement 正确", () => {
    const content = "见 [[不存在|别名]] 即可";
    const file: MockFile = {
      path: "a.md",
      content,
      links: [{ link: "不存在|别名", position: posFor(content, "[[不存在|别名]]") }],
      unresolved: ["不存在|别名"],
    };
    const src = makeSource([file]);
    const edits = collectUnresolvedEdits(src);
    expect(edits).toHaveLength(1);
    expect(edits[0].replacement).toBe("[别名]");

    const { result, applied } = applyEditsToString(content, edits);
    expect(applied).toBe(1);
    expect(result).toBe("见 [别名] 即可");
  });

  it("[[内部尾随空格]] ─ 不依赖 raw 重建,通过 end 精确定位", () => {
    const content = "前 [[bushi ]] 后";
    const file: MockFile = {
      path: "a.md",
      content,
      links: [{ link: "bushi", position: posFor(content, "[[bushi ]]") }],
      unresolved: ["bushi"],
    };
    const src = makeSource([file]);
    const edits = collectUnresolvedEdits(src);
    expect(edits).toHaveLength(1);
    // link 不含空格,但 end 位置包含空格和 ]],跨度正确
    expect(edits[0].replacement).toBe("[bushi]");

    const { result, applied } = applyEditsToString(content, edits);
    expect(applied).toBe(1);
    expect(result).toBe("前 [bushi] 后");
  });

  it("同一文件多个未解析双链,全部清除", () => {
    const content = "[[a]] 和 [[b]] 还有 [[c]]";
    const file: MockFile = {
      path: "a.md",
      content,
      links: [
        { link: "a", position: posFor(content, "[[a]]") },
        { link: "b", position: posFor(content, "[[b]]") },
        { link: "c", position: posFor(content, "[[c]]") },
      ],
      unresolved: ["a", "b", "c"],
    };
    const src = makeSource([file]);
    const edits = collectUnresolvedEdits(src);
    expect(edits).toHaveLength(3);

    const { result, applied } = applyEditsToString(content, edits);
    expect(applied).toBe(3);
    expect(result).toBe("[a] 和 [b] 还有 [c]");
  });

  it("带换行的文本:line/col 正确,降序替换不漂移", () => {
    const content = "line0\nline1 [[不1]]\nline2 [[不2]] end\n";
    const file: MockFile = {
      path: "a.md",
      content,
      links: [
        { link: "不1", position: posFor(content, "[[不1]]") },
        { link: "不2", position: posFor(content, "[[不2]]") },
      ],
      unresolved: ["不1", "不2"],
    };
    const src = makeSource([file]);
    const edits = collectUnresolvedEdits(src);
    expect(edits).toHaveLength(2);

    const { result, applied } = applyEditsToString(content, edits);
    expect(applied).toBe(2);
    expect(result).toBe("line0\nline1 [不1]\nline2 [不2] end\n");
  });
});
