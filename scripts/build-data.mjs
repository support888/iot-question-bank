import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const dataPath = path.join(projectDir, "data", "questions.json");

const chapterSources = [
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

const mergedSource = {
  code: "exam",
  label: "综合测验",
  shortLabel: "综合",
  course: "物联网通信技术",
  file: path.join(projectDir, "sources", "merged-275.md"),
  expectedQuestions: 275,
};

const sources = [...chapterSources, mergedSource];

const typeMap = {
  单选题: "single",
  判断题: "judge",
  简答题: "short",
  分析题: "analysis",
  论述题: "discussion",
};

const sectionTypeMap = {
  "一、单选题": "single",
  "二、判断题": "judge",
  "三、简答题": "short",
  "四、分析题": "analysis",
  "五、论述题": "discussion",
};

function clean(value = "") {
  return value.replace(/\uFEFF/g, "").replace(/\r/g, "").trim();
}

function normalizeTitle(value = "") {
  return clean(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replaceAll("π", "pi")
    .replace(/[^\p{L}\p{N}]+/gu, "");
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

    if (!answer && !["short", "analysis", "discussion"].includes(type)) {
      throw new Error(`${source.code} 第 ${current.number} 题缺少答案`);
    }

    const reference = clean(
      current.referenceText
        .replace(/<details>|<\/details>|<summary>.*?<\/summary>/g, "")
        .replace(/^\*\*(?:题型|分值|题目 ID|知识点|知识标签|来源|合并来源)：\*\*.*$/gm, "")
        .replace(/^\*\*参考答案：\*\*\s*$/gm, "")
        .replace(/^\*\*答案：.*?\*\*\s*$/gm, "")
        .replace(/^\*\*解析：\*\*.*$/gm, "")
        .replace(/^##(?!#)\s+.*$/gm, "")
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
        discussion: "论述题",
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

    const inlineMetaMatch = line.match(
      /^\*\*题型：\*\*\s*(.+?)(?:\s+\*\*分值：\*\*\s*(.*))?$/,
    );
    if (inlineMetaMatch) {
      current.typeLabel = inlineMetaMatch[1].trim();
      if (inlineMetaMatch[2]) current.points = inlineMetaMatch[2].trim();
      continue;
    }

    const provenanceMatch = line.match(/^\*\*合并来源：\*\*\s*(.*)$/);
    if (provenanceMatch) {
      current.originalSource = provenanceMatch[1].trim();
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
      line.match(/^\*\*(?:正确)?答案：\s*(.+?)(?:\*\*)?\s*$/) ||
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
    if (["short", "analysis", "discussion"].includes(type)) {
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

const chapterQuestions = [];

for (const source of chapterSources) {
  const raw = await readFile(source.file, "utf8");
  chapterQuestions.push(...parseSource(source, raw));
}

const mergedRaw = await readFile(mergedSource.file, "utf8");
const mergedQuestions = parseSource(mergedSource, mergedRaw);

const chapterByTitle = new Map();
for (const question of chapterQuestions) {
  const key = normalizeTitle(question.title);
  if (chapterByTitle.has(key)) {
    throw new Error(`章节题库存在重复题：${question.title}`);
  }
  chapterByTitle.set(key, question);
}

const matchedChapterIds = new Set();
const allQuestions = mergedQuestions.map((question) => {
  const legacyQuestion = chapterByTitle.get(normalizeTitle(question.title));
  if (!legacyQuestion) {
    return {
      ...question,
      id: `exam-${question.sourceQuestionNumber}`,
    };
  }

  if (matchedChapterIds.has(legacyQuestion.id)) {
    throw new Error(`同一章节题被多次覆盖：${legacyQuestion.id}`);
  }
  matchedChapterIds.add(legacyQuestion.id);

  return {
    ...question,
    id: legacyQuestion.id,
    sourceCode: legacyQuestion.sourceCode,
    sourceLabel: legacyQuestion.sourceLabel,
    sourceShortLabel: legacyQuestion.sourceShortLabel,
    course: legacyQuestion.course,
    sourceQuestionNumber: legacyQuestion.sourceQuestionNumber,
    sourceQuestionId: legacyQuestion.sourceQuestionId,
    knowledge: question.knowledge || legacyQuestion.knowledge,
    originalSource: question.originalSource || legacyQuestion.originalSource,
  };
});

if (matchedChapterIds.size !== chapterQuestions.length) {
  const missing = chapterQuestions
    .filter((question) => !matchedChapterIds.has(question.id))
    .map((question) => `${question.id} ${question.title}`);
  throw new Error(`以下章节题未在新题库中找到对应项：\n${missing.join("\n")}`);
}

if (allQuestions.length !== 275) {
  throw new Error(`合并后应为 275 题，实际得到 ${allQuestions.length} 题`);
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
  if (
    ["short", "analysis", "discussion"].includes(question.type) &&
    !question.reference
  ) {
    throw new Error(`${question.id} 缺少参考答案`);
  }
}

const typeOrder = ["single", "judge", "short", "analysis", "discussion"];
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

const sourceSummaries = sources.map(({ file, expectedQuestions, ...source }) => ({
  ...source,
  questionCount: allQuestions.filter((question) => question.sourceCode === source.code).length,
}));

const payload = {
  meta: {
    title: "物联网题库",
    description: "物联网通信技术章节测验 2、3、4 与综合测验合并去重题库",
    generatedAt: new Date().toISOString(),
    questionCount: allQuestions.length,
    sourceCount: sourceSummaries.length,
    typeCounts: counts,
    sources: sourceSummaries,
  },
  questions: allQuestions,
};

await mkdir(path.dirname(dataPath), { recursive: true });
await writeFile(dataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(
  `已生成 ${allQuestions.length} 道题：` +
    sourceSummaries
      .map((source) => `${source.label} ${source.questionCount} 题`)
      .join("，"),
);
console.log(
  `题型统计：单选 ${counts.single}，判断 ${counts.judge}，简答 ${counts.short}，分析 ${counts.analysis}，论述 ${counts.discussion}`,
);
