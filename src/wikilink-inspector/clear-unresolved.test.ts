import { describe, it, expect } from "vitest";
import {
  applyEditsToString,
  extractBracketedText,
  groupEditsByPath,
  type UnresolvedEdit,
} from "./clear-unresolved";

function edit(
  sourcePath: string,
  line: number,
  col: number,
  endLine: number,
  endCol: number,
  replacement: string,
): UnresolvedEdit {
  return {
    sourcePath,
    position: { line, col },
    end: { line: endLine, col: endCol },
    replacement,
  };
}

/** 快捷:根据 raw 字符串自动计算 end(line/col),col 指 offset。 */
function editFrom(
  text: string,
  rawStart: number,
  sourcePath: string,
  raw: string,
  replacement: string,
): UnresolvedEdit {
  const before = text.slice(0, rawStart);
  const lines = before.split("\n");
  const line = lines.length - 1;
  const col = lines[lines.length - 1].length;
  const after = before + raw;
  const endLines = after.split("\n");
  const endLine = endLines.length - 1;
  const endCol = endLines[endLines.length - 1].length;
  return {
    sourcePath,
    position: { line, col },
    end: { line: endLine, col: endCol },
    replacement,
  };
}

describe("extractBracketedText", () => {
  it("无 alias/anchor: 原样返回", () => {
    expect(extractBracketedText("目标")).toBe("目标");
  });

  it("带 alias: 取 | 之后(与现有 flatten 语义一致)", () => {
    expect(extractBracketedText("目标|显示")).toBe("显示");
  });

  it("带 anchor: 保留 anchor(与现有 flatten 语义一致)", () => {
    expect(extractBracketedText("目标#标题")).toBe("目标#标题");
  });

  it("alias + anchor: 切到 alias 后,anchor 保留", () => {
    expect(extractBracketedText("目标|显示#标题")).toBe("显示#标题");
  });
});

describe("applyEditsToString", () => {
  it("空编辑列表返回原文,applied=0", () => {
    const out = applyEditsToString("hello", []);
    expect(out.result).toBe("hello");
    expect(out.applied).toBe(0);
  });

  it("单个 [[目标]] → [目标](通过 end 定位长度)", () => {
    const text = "before [[目标]] after";
    // "before " = 7 chars; "[[" starts at col 7, "]]" ends after col 13
    const e = editFrom(text, 7, "a.md", "[[目标]]", "[目标]");
    const out = applyEditsToString(text, [e]);
    expect(out.result).toBe("before [目标] after");
    expect(out.applied).toBe(1);
  });

  it("多行 col 计算正确(编辑跨行时 end position)", () => {
    const text = "line0\nline1 [[目\n标]] end";
    const e = editFrom(text, 12, "a.md", "[[目\n标]]", "[目标]");
    const out = applyEditsToString(text, [e]);
    expect(out.result).toBe("line0\nline1 [目标] end");
    expect(out.applied).toBe(1);
  });

  it("多个编辑按降序替换,位置不漂移", () => {
    const text = "[[a]] and [[b]] and [[c]]";
    const edits = [
      editFrom(text, 0, "a.md", "[[a]]", "[a]"),
      editFrom(text, 10, "a.md", "[[b]]", "[b]"),
      editFrom(text, 20, "a.md", "[[c]]", "[c]"),
    ];
    const out = applyEditsToString(text, edits);
    expect(out.result).toBe("[a] and [b] and [c]");
    expect(out.applied).toBe(3);
  });

  it("编辑顺序乱序传入也能正确处理", () => {
    const text = "[[a]] and [[b]]";
    const edits = [
      editFrom(text, 10, "a.md", "[[b]]", "[b]"),
      editFrom(text, 0, "a.md", "[[a]]", "[a]"),
    ];
    const out = applyEditsToString(text, edits);
    expect(out.result).toBe("[a] and [b]");
    expect(out.applied).toBe(2);
  });

  it("[[内部有尾随空格]由来容忍,不依赖raw", () => {
    const text = "前 [[bushi ]] 后";
    const e = edit("a.md", 2, 24, 2, 19, "[bushi]");
    e.position = { line: 0, col: 2 };
    e.end = { line: 0, col: 12 };
    e.replacement = "[bushi]";
    const out = applyEditsToString(text, [e]);
    expect(out.result).toBe("前 [bushi] 后");
    expect(out.applied).toBe(1);
  });

  it("直接使用 end 差值的精度: [[a]] → [a]", () => {
    const text = "[[a]] skip [[b]]";
    const e = edit("a.md", 0, 0, 0, 5, "[a]");
    const out = applyEditsToString(text, [e]);
    expect(out.result).toBe("[a] skip [[b]]");
    expect(out.applied).toBe(1);
  });

  it("跨行的双重编辑", () => {
    const text = "a\n[[b]]\nc\n[[d]]";
    // a\n = 2; [[b]] at offset 2; c\n at offset 7; [[d]] at offset 10
    const edits = [
      editFrom(text, 2, "a.md", "[[b]]", "[b]"),
      editFrom(text, 10, "a.md", "[[d]]", "[d]"),
    ];
    const out = applyEditsToString(text, edits);
    expect(out.result).toBe("a\n[b]\nc\n[d]");
    expect(out.applied).toBe(2);
  });
});

describe("groupEditsByPath", () => {
  it("按 sourcePath 拆分,保持原顺序", () => {
    const edits = [
      edit("a.md", 0, 0, 0, 5, "[x]"),
      edit("b.md", 0, 0, 0, 5, "[y]"),
      edit("a.md", 1, 0, 1, 5, "[z]"),
    ];
    const m = groupEditsByPath(edits);
    expect(m.size).toBe(2);
    expect(m.get("a.md")?.length).toBe(2);
    expect(m.get("b.md")?.length).toBe(1);
  });
});
