import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const dataPath = path.join(projectDir, "data", "questions.json");

const sources = [
  {
    code: "c2",
    label: "章节测验 2",
    shortLabel: "测验 2",
    course: "物联网通信技术",
    file: path.join(projectDir, "sources", "chapter-2.md"),
    expectedQuestions: 57,
  },
  {
    code: "c3",
    label: "章节测验 3",
    shortLabel: "测验 3",
    course: "物联网技术",
    file: path.join(projectDir, "sources", "chapter-3.md"),
    expectedQuestions: 68,
  },
  {
    code: "c4",
    label: "章节测验 4",
    shortLabel: "测验 4",
    course: "物联网通信技术",
    file: path.join(projectDir, "sources", "chapter-4.md"),
    expectedQuestions: 60,
  },
];

const typeMap = {
  单选题: "single",
  判断题: "judge",
  简答题: "short",
  分析题: "analysis",
};

const sectionTypeMap = {
  "一、单选题": "single",
  "二、判断题": "judge",
  "三、简答题": "short",
  "四、分析题": "analysis",
};

function clean(value = "") {
  return value.replace(/\uFEFF/g, "").replace(/\r/g, "").trim();
}

function parseSource(source, raw) {
  const text = clean(raw).replace(/\r?\n/g, "\n");
  const lines = text.split("\n");
  const questions = [];
  let current = null;
  let currentSectionType = "";

  function finishQuestion() {
    if (!current) return;

    const type = typeMap[current.typeLabel] || currentSectionType;
    if (!type) {
      throw new Error(`${source.code} 第 ${current.number} 题无法判断题型`);
    }

    let answer = current.answer;
    if (type === "judge") {
      const explicitJudgement = answer.match(/(对|错)/)?.[1];
      const judgementByKey = { A: "对", B: "错" }[answer.trim().charAt(0)];
      answer = explicitJudgement || judgementByKey || answer;
    }
    if (!answer && type === "judge") {
      const match = current.referenceText.match(/^(对|错)\s*$/m);
      answer = match?.[1] || "";
    }

    if (!answer && !["short", "analysis"].includes(type)) {
      throw new Error(`${source.code} 第 ${current.number} 题缺少答案`);
    }

    const reference = clean(
      current.referenceText
        .replace(/<details>|<\/details>|<summary>.*?<\/summary>/g, "")
        .replace(/^\*\*参考答案：\*\*\s*$/gm, "")
        .replace(/^\*\*答案：.*?\*\*\s*$/gm, "")
        .replace(/^\*\*解析：\*\*.*$/gm, "")
        .replace(/^---\s*$/gm, ""),
    );

    let options = current.options
      .map(({ key, text: optionText }) => ({ key, text: clean(optionText) }))
      .filter((option) => option.text);

    if (type === "judge") {
      options = [
        { key: "对", text: "正确" },
        { key: "错", text: "错误" },
      ];
    }

    questions.push({
      id: `${source.code}-${current.number}`,
      sourceCode: source.code,
      sourceLabel: source.label,
      sourceShortLabel: source.shortLabel,
      course: source.course,
      sourceQuestionNumber: current.number,
      sourceQuestionId: current.sourceQuestionId || "",
      type,
      typeLabel: current.typeLabel || {
        single: "单选题",
        judge: "判断题",
        short: "简答题",
        analysis: "分析题",
      }[type],
      points: Number.parseFloat(current.points?.match(/[\d.]+/)?.[0] || "0"),
      title: clean(current.title),
      options,
      answer,
      explanation: clean(current.explanation),
      reference,
      knowledge: clean(current.knowledge),
      originalSource: clean(current.originalSource),
    });

    current = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      if (sectionMatch[1] in sectionTypeMap) {
        finishQuestion();
        currentSectionType = sectionTypeMap[sectionMatch[1]];
      }
    }

    const questionMatch = line.match(/^###\s+(\d+)\.\s+(.+)$/);
    if (questionMatch) {
      finishQuestion();
      current = {
        number: Number(questionMatch[1]),
        title: questionMatch[2],
        typeLabel: "",
        points: "",
        sourceQuestionId: "",
        knowledge: "",
        originalSource: "",
        options: [],
        answer: "",
        explanation: "",
        referenceText: "",
      };
      continue;
    }

    if (!current) continue;

    const metaMatch = line.match(
      /^-\s+\*\*(题型|分值|题目 ID|知识点|知识标签|来源)：\*\*\s*(.*)$/,
    );
    if (metaMatch) {
      const [, key, value] = metaMatch;
      if (key === "题型") current.typeLabel = value.trim();
      if (key === "分值") current.points = value.trim();
      if (key === "题目 ID") current.sourceQuestionId = value.trim();
      if (["知识点", "知识标签"].includes(key)) current.knowledge = value.trim();
      if (key === "来源") current.originalSource = value.trim();
      continue;
    }

    const optionMatch =
      line.match(/^-?\s+\*\*([A-D])\.\*\*\s+(.+)$/) ||
      line.match(/^([A-D])\.\s+(.+)$/);
    if (optionMatch) {
      current.options.push({ key: optionMatch[1], text: optionMatch[2] });
      continue;
    }

    const answerMatch =
      line.match(/^\*\*答案：\s*(.+?)\*\*\s*$/) ||
      line.match(/^答案：\s*(.+?)\s*$/);
    if (answerMatch) {
      current.answer = answerMatch[1].trim();
      continue;
    }

    const explanationMatch = line.match(/^\*\*解析：\*\*\s*(.*)$/);
    if (explanationMatch) {
      current.explanation = explanationMatch[1];
      continue;
    }

    const type = typeMap[current.typeLabel] || currentSectionType;
    if (["short", "analysis"].includes(type)) {
      current.referenceText += `${line}\n`;
    } else {
      current.referenceText += `${line}\n`;
    }
  }

  finishQuestion();

  if (questions.length !== source.expectedQuestions) {
    throw new Error(
      `${source.label} 应解析 ${source.expectedQuestions} 题，实际得到 ${questions.length} 题`,
    );
  }

  return questions;
}

const allQuestions = [];

for (const source of sources) {
  const raw = await readFile(source.file, "utf8");
  allQuestions.push(...parseSource(source, raw));
}

const ids = new Set();
for (const question of allQuestions) {
  if (ids.has(question.id)) throw new Error(`题目 ID 重复：${question.id}`);
  ids.add(question.id);

  if (!question.title) throw new Error(`${question.id} 缺少题干`);
  if (["single", "judge"].includes(question.type)) {
    if (question.options.length < 2) {
      throw new Error(`${question.id} 选项少于 2 个`);
    }
    if (!question.options.some((option) => option.key === question.answer)) {
      throw new Error(`${question.id} 的答案 ${question.answer} 不在选项中`);
    }
  }
  if (["short", "analysis"].includes(question.type) && !question.reference) {
    throw new Error(`${question.id} 缺少参考答案`);
  }
}

const typeOrder = ["single", "judge", "short", "analysis"];
allQuestions.sort((a, b) => {
  const sourceOrder =
    sources.findIndex((source) => source.code === a.sourceCode) -
    sources.findIndex((source) => source.code === b.sourceCode);
  if (sourceOrder !== 0) return sourceOrder;
  return a.sourceQuestionNumber - b.sourceQuestionNumber;
});

allQuestions.forEach((question, index) => {
  question.order = index + 1;
});

const counts = Object.fromEntries(
  typeOrder.map((type) => [
    type,
    allQuestions.filter((question) => question.type === type).length,
  ]),
);

const payload = {
  meta: {
    title: "物联网题库",
    description: "物联网通信技术章节测验 2、3、4 合并复习题库",
    generatedAt: new Date().toISOString(),
    questionCount: allQuestions.length,
    sourceCount: sources.length,
    typeCounts: counts,
    sources: sources.map(({ file, expectedQuestions, ...source }) => ({
      ...source,
      questionCount: expectedQuestions,
    })),
  },
  questions: allQuestions,
};

await mkdir(path.dirname(dataPath), { recursive: true });
await writeFile(dataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(
  `已生成 ${allQuestions.length} 道题：` +
    sources
      .map((source) => `${source.label} ${source.expectedQuestions} 题`)
      .join("，"),
);
console.log(
  `题型统计：单选 ${counts.single}，判断 ${counts.judge}，简答 ${counts.short}，分析 ${counts.analysis}`,
);
