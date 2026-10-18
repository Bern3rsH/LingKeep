# LingKeep

基于 Electron、React 和 TypeScript 的本地语境学习应用。需求依据为 [需求文档](docs/requirements.md)，执行记录见 [实现计划](implementation-plan.mdc)。

## 下载与发布

安装包见 [GitHub Releases](https://github.com/Bern3rsH/LingKeep/releases)。macOS 提供 Apple Silicon（arm64）和 Intel（x64）DMG/ZIP；Windows 提供 x64 安装包、便携 EXE 和带 `win-x64` 后缀的 ZIP。发布说明见 [release-notes.md](release-notes.md)，每次发布包含 SHA-256 校验值。

`npm run pack` 生成当前系统的应用目录，`npm run dist` 生成安装包；先执行 `npm run dictionaries` 生成完整词库。应用图标沿用界面中的 K 标识，可用 `node scripts/build-icon.mjs` 重新生成。

推送与 `package.json` 版本一致的 `v*.*.*` 标签会运行测试，并在三个原生平台分别构建、检查词库/PDF 资源、验证实际 PDF 提取和封面渲染、启动打包后的应用检查导入与 Keep 保存；全部通过后创建 GitHub Release。本次未配置 Developer ID 公证、Windows 代码签名或自动更新。

## 运行

要求 Node.js 24 或更高版本。当前工作区已经安装依赖并生成完整离线词库，可直接运行：

```sh
npm run dev
```

全新检出时执行：

```sh
npm ci
npm run dictionaries
npm run dev
```

词库生成需要联网；生成后的查词无需联网。`resources/dictionaries/*.json.gz` 和 `manifest.json` 是生成资源，由 `.gitignore` 排除；重新检出时需重新生成，发布应用时需包含整个词库资源目录及许可证。

## 已接入的功能

| 范围 | 行为 |
| --- | --- |
| 本地用户 | 中文母语学英文或法语、英文母语学中文或法语；各自保存材料、Keep、笔记和复习进度 |
| Library | 文本、网页、可重排 EPUB、文字型 PDF；导入前预览并删除内容、标题回退、重命名、重复打开或副本 |
| 资源 | 网页图片本地保存；EPUB 图片和原包保存；缺失占位、单张及全部重试 |
| 阅读 | 章节选择、位置保存、点击单词、跨句连续划选、不连续组合选词、收藏高亮、重叠 Keep 切换 |
| 中文 | 逐段 AI 分词、章节就绪状态、失败恢复、手动合并和逐字拆分，保持原文位置不变 |
| 法语 | 本地识别重音与省音词边界、AI 母语释义与变位/性数变化、语境笔记讲解、法语发音；复用导入、Keep 与复习 |
| 释义 | AI 与本地词库独立加载和重试；按语境缓存和去重；候选结果不覆盖已绑定释义 |
| Keep | 每个原文语境独立收藏；唯一释义和来源、记忆等级、Markdown 自动保存笔记；移出保留历史 |
| 来源跳转 | 跳回材料及章节；临时查看不改原进度；返回阅读位置；来源删除后保留原句、笔记和复习 |
| AI 设置 | Gemini、OpenAI、DeepSeek、OpenRouter、Anthropic、Ollama；模型刷新、环境变量密钥状态、遮罩及删除 |
| 复习 | ts-fsrs 5.2.3；到期语境卡片、正反面、Again/Hard/Good、等级联动、原子评分和幂等重试 |

首次选语言后即可进入 Library。英文和法语阅读、手动释义、Keep 和复习不要求 AI；中英离线查词使用现有词库，法语暂无离线词库，释义与讲解使用 AI。中文正文可先保存为待分词。AI 配置由所有语言用户共用，设置返回会保留当前阅读选词。已有中英数据读取时会补齐独立的法语空间，原材料和进度保留。

## 数据与边界

- 数据位于 Electron 的应用用户目录：`state.json`、上一份有效备份 `state.json.bak` 和 `assets/`。
- 数据更新经过校验和串行化，采用同目录临时文件写入、文件同步和原子重命名。损坏文件会保留，恢复备份时显示通知；没有有效备份时明确报错，不用默认值覆盖。
- 设置文件和备份含应用内保存的 API Key，按当前系统用户权限保存。密钥不通过快照返回渲染进程，也不写入日志。
- 窗口关闭会等待未完成的笔记和释义保存；保存失败时保留窗口与输入，允许重试。
- 网页导入只接受公开 HTTP(S) 地址，逐次重定向检查、固定已校验的 DNS 地址，并限制下载与解压大小。脚本、iframe、外部字体和音视频不会进入阅读器。
- EPUB 按 spine 顺序生成章节，读取 EPUB 3 导航或 EPUB 2 NCX 标题。加密与固定版式会拒绝导入。浏览器中的登录态或需要执行脚本才能获取的正文不在当前网页解析范围内，失败时可使用粘贴文本。
- PDF 提取文字后按原页顺序生成可选词的正文，首页预览作为资料库封面；空白或无文字页略过。支持不超过 80 MB、1000 页及正文长度限制的文件；加密 PDF 需先解密，扫描件需先 OCR。PDF 原始排版、表格和正文插图不会完整复原，复杂分栏的文字顺序取决于文件本身。

## 验证

```sh
npm test           # 领域、持久化、导入、AI 协议、词库、复习及自动保存测试
npm run typecheck  # TypeScript 检查
npm run build      # 生产构建
npm run smoke      # 构建后打开真实 Electron 窗口，使用独立临时数据
npm run check:web  # 联网检查公开网页的真实 HTTPS 下载与正文提取
```

2026-10-18 本机验证结果：

- 31 个测试文件、273 项测试通过；类型检查和生产构建通过。
- Electron 窗口检查通过：语言选择、预览导入、单词/连续/组合选词、设置返回、释义收藏、双入口笔记、来源跳转与返回、显示释义和 FSRS 评分、重启恢复、输入后立即关闭仍完成保存。
- 真实网页 `https://example.com` 的下载与正文提取通过；图片下载失败及重试、EPUB 目录及本地图片恢复使用可控文件夹具验证。
- 完整 ECDICT 基础版有 768729 个查询键，CC-CEDICT 有 198463 个查询键；校验值和原始来源记录在生成清单中，实际断网查询检查通过。
- 六种 AI 协议使用离线响应测试；未使用真实密钥调用付费模型，也未连接真实 Ollama。模型可用性和实际分词/释义质量需要用户配置后验证。
- 本机 macOS ARM64 应用打包、资源完整性、真实打包后启动、词库、导入、Keep 和刷新恢复检查通过；跨平台安装包由标签发布工作流继续验证。未验证签名、公证与升级流程。

## 参考与归属

- [OpenAI Chat Completions 官方协议](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)：OpenAI 及兼容服务商请求结构。
- EnglishAsk 的当前共享 AI 定义、provider adapters、Ollama 模型能力筛选和原生 API 头部代码：六服务商设置行为参考；未复制其业务功能或用户配置。
- FenyiDic 的 FSRS 服务：Again/Hard/Good 和复习调度行为参考。
- [ECDICT](https://github.com/skywind3000/ECDICT)：基础版 `ecdict.csv`，MIT；仅做查词键、词形回退与独立义项转换，许可证见 `resources/dictionaries/ECDICT-LICENSE.txt`。
- [CC-CEDICT / MDBG](https://www.mdbg.net/chinese/dictionary?page=cc-cedict)：CC BY-SA 4.0；转换为简繁查询键及独立义项，原始声明和转换说明见 `resources/dictionaries/CC-CEDICT-NOTICE.txt`。
