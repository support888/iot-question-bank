# 物联网题库

物联网通信技术章节测验与综合测验合并复习站，共 **275 道不重复题**。

## 功能

- 122 道单选题、121 道判断题、17 道简答题、12 道分析题、3 道论述题
- 按题库、题型和复习状态筛选
- 题干、选项、答案与知识点的全文搜索
- 客观题即时判分，主观题可自评掌握状态
- 随机抽取 10 题
- 错题本、题目收藏和参考答案
- 学习进度、笔记只保存在访问者自己的浏览器中
- 桌面、平板和手机自适应，支持深色模式

## 本地预览

```powershell
cd iot-question-bank
python -m http.server 4173
```

打开 `http://127.0.0.1:4173/`。

## 更新题库

1. 用新的 Markdown 内容更新 `sources/merged-275.md`，保持题目标题、选项、答案和解析结构。
2. 运行数据构建脚本：

```powershell
node .\scripts\build-data.mjs
```

`sources/chapter-2.md`、`chapter-3.md`、`chapter-4.md` 保留原章节题的来源信息和题目标识。
构建脚本会用 `merged-275.md` 覆盖其中相同题目，并补入综合题库独有题，最后校验
275 题总数、答案与选项一致性，再生成 `data/questions.json`。

## 技术说明

项目是无构建依赖的静态站点，使用原生 HTML、CSS 和 JavaScript。直接部署仓库根目录至 GitHub Pages 即可运行。
