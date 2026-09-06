# 首批新词包与可选下载

后续已加入 [九类日常中文词包](2026-09-05-daily-dictionary-packs.md)，现共十六类。下文保留原七个专业包的说明与当时验证记录。

版本：2026.09.05-1。精选整理日期：2026-09-05。上游词库快照：2026-09-04。

## 已接入的七包

| 词包 | 合计词条 | 本次精选词 | 联网下载量 | 精选样例 |
|---|---:|---:|---:|---|
| AI 模型与智能体 | 334 | 30 | 4.0 KB | Codex、ChatGPT、DeepSeek、Qwen3、MCP、RAG |
| 生图与视频 | 48 | 31 | 23.7 KB | ComfyUI、FLUX.2、Qwen Image、Z-Image、Wan 2.2、Seedance |
| 前端与全栈 | 521 | 28 | 5.7 KB | TypeScript、React、Vue、Next.js、Electron、FastAPI |
| 云端与容器 | 254 | 22 | 4.5 KB | Docker、Kubernetes、K8s、Nginx、GitHub Actions |
| 语音与音频 | 39 | 30 | 23.7 KB | FunASR、SenseVoice、Paraformer、sherpa-onnx、Whisper、FFmpeg |
| 游戏与三维 | 159 | 24 | 2.8 KB | Godot、Unity、Blender、Three.js、WebGPU、PBR |
| 软件与效率工具 | 604 | 24 | 7.4 KB | Obsidian、Notion、VS Code、GitHub、Markdown、Zotero |

七包条目数相加 1959，未跨包去重；其中本轮精选增补条目相加 189。部分增补覆盖上游同名词，不是所有条目都在本轮新出现。

七包下载量相加 71,830 字节，包含各包的许可文件，不含 HTTPS 协议开销；有些包从同一基础文件筛选，因此下载量不与条目数成正比。应用同时提供本轮编辑的精选增补规则。下载后存储为独立词包记录，实际存储量在界面另列；不需要新增语音模型或付费接口。

基础来自 [CSpell Dictionaries](https://github.com/streetsidesoftware/cspell-dicts/tree/033bb8b22f544b81f16e27c696aeadd0da431509/dictionaries) 的 data-science、software-terms、fullstack、docker、gaming-terms 子目录。本次逐一检查并下载这些子目录的 MIT 许可；不能把该仓库所有其他词库都视为 MIT。上游快照日期不代表每个词或每个文件都在当天更新。

精选词的参考包括 [ComfyUI 模型与功能清单](https://github.com/Comfy-Org/ComfyUI)、[Qwen3](https://github.com/QwenLM/Qwen3)、[Whisper.cpp](https://github.com/ggml-org/whisper.cpp) 及各包列出的官方产品或项目页面。这里整理的是名称和术语，不复制整篇文档，也不承诺覆盖所有最新产品。具体下载来源、修订号和 SHA-256 在 `resources/dictionary-catalog.json`。

## 操作

1. 进入齿轮 -> 词包，搜索类别或重点词；点击展开可在下载前看精选样例。
2. 点击该行的下载图标。下载期间可取消；原始源连接失败时尝试同内容的 CDN 镜像，校验必须一致。
3. 首次下载成功后默认不启用。打开该行开关即可保存并生效，不需再点设置保存。
4. 下载后展开可以搜索完整词表，包含明确纠错映射和只供参考的术语。
5. 筛选器可选全部、已下载或已启用。垃圾桶只删除该词包，不影响个人词典。
6. 环形箭头重新下载同一已审核版本，适用于修复。以后软件目录带来新版本时显示更新；当前不是随时抓取上游最新提交的自动更新服务。

词包状态与设置草稿独立；在词包页隐藏通用保存按钮，避免让人以为词包开关需要二次保存。切回其他设置页，原来的保存功能仍在。

下载需要联网，装好后的词包处理不联网。首批仅下载纯文本数据，不安装外部程序，不执行上游脚本，不解压不可信压缩包。下载失败、校验失败、取消均不覆盖此前安装的版本。

## 实际作用与边界

三种表达模式在本次录音结束后都可应用已启用词包中的明确替换，例如 `chat gpt` -> `ChatGPT`、`comfy ui` -> `ComfyUI`。这仍是识别后的处理，不是语音模型解码热词，也不会重新识别整段音频。

日常和条理模式会额外将本段匹配到的少量术语交给已有本地整理模型参考，上限 24 条；不会把所有词包塞进提示词。只出现在词表中、没有命中当前文本的词不会因此自动加入正文。模型仍可能误改，保留预览与原文恢复。

没有明确映射的词条仅供术语参考，不进行任意同音替换或模糊纠错。英文缩写字母读法、指定别称目前只覆盖列出的写法；不要将 1959 个词误解为 1959 条万能纠错规则。

个人词典优先，停用的个人同名规则也不会被公共包偷偷重新启用。重叠的个人规则抑制公共映射；公共包之间同一写法指向不同词时跳过歧义映射。不会自动读取联系人、聊天框、屏幕或 Obsidian 文件。

资料保存在 `%APPDATA%\voice-agent-pad\dictionary-packs.json`，包含下载后的词条、启用状态与许可证；与 `settings.json` 中的个人词典分开。缓存只驻留已启用词条，不加载新的神经网络。

## 验证记录

- 八项词包单元测试通过：源文件哈希与许可、解析安全、启停与持久化、个人优先、下载失败保护、取消与并发保护、损坏文件保护、所有包离线应用。
- Electron 真实下载测试通过：搜索与预览、AI 和生图包联网下载、默认关闭、开关生效、筛选、重启恢复、停用、删除、个人词典保留。未用请求拦截伪造联网下载。
- 在隔离测试中，真实下载并启用 AI 包后，原文处理得到“请打开ChatGPT再使用Codex和MCP。”。
- 原有八项功能单元测试、完整产品 UI 回归通过。
- 本地整理模型五条文本用例通过，其中词包参考用例保留 ComfyUI 和“先别安装”；不是个人语音准确率测试。

```powershell
npm run test:packs
npm run test:packs-ui
npm run test:features
npm run test:product-ui
npm run test:local-editor
```

测试词库样本位于 `tmp/dictionary-source-fixtures`，不属于正式用户已安装词包。该目录缺失时，维护者可执行 `node scripts/build-dictionary-catalog.js` 从固定上游版本重新生成校验目录和样本；普通用户只需使用界面下载。

改动前代码快照：`D:\GPT 工作区\voice-agent-pad-snapshots\before-dictionary-downloads-20260905-154145`。

相关：[首轮候选调研](2026-09-05-optional-dictionary-packs.md)、[基础功能使用说明](2026-09-05-product-features.md)。
