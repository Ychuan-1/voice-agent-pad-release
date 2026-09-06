const entry = (term, ...aliases) => ({ term, aliases });
const root = 'dictionaries/';
const source = (category, ...files) => files.map((file) => root + category + '/src/' + file + '.txt');

// Independently curated additions. Upstream files are downloaded only on request.
module.exports = [
  ...require('./daily-dictionary-recipes'),
  {
    id: 'ai-models', name: 'AI 模型与智能体', category: 'AI 创作', icon: 'brain-circuit',
    summary: '大模型、智能体、检索增强与推理',
    files: source('data-science', 'data-science-models', 'data-science-terms', 'data-science-tools'),
    references: ['https://github.com/QwenLM/Qwen3', 'https://github.com/deepseek-ai/DeepSeek-V3', 'https://modelcontextprotocol.io/'],
    additions: [entry('Codex', 'code x'), entry('ChatGPT', 'chat gpt'), entry('DeepSeek', 'deep seek'), entry('Qwen3', 'qwen 3'), entry('Qwen'), entry('Claude'), entry('Gemini'), entry('Ollama', '欧拉玛'), entry('llama.cpp', 'llama cpp'), entry('MCP', 'm c p'), entry('RAG', 'r a g'), entry('Agent'), entry('Skill'), entry('Embedding'), entry('Transformer'), entry('Token'), entry('GGUF', 'g g u f'), entry('Function Calling'), entry('Tool Calling'), entry('上下文窗口'), entry('检索增强生成'), entry('多模态'), entry('推理模型'), entry('量化'), entry('智能体'), entry('工具调用'), entry('向量数据库'), entry('系统提示词'), entry('知识蒸馏'), entry('模型上下文协议')]
  },
  {
    id: 'image-video', name: '生图与视频', category: 'AI 创作', icon: 'image',
    summary: 'ComfyUI、扩散模型、图像编辑与视频生成',
    files: source('software-terms', 'software-terms'), filter: 'image|pixel|render|shader|frame|video|graphic|diffus|opencv|opengl|gltf',
    references: ['https://github.com/Comfy-Org/ComfyUI', 'https://github.com/black-forest-labs/flux', 'https://github.com/Wan-Video/Wan2.2'],
    additions: [entry('ComfyUI', 'comfy ui', '康菲UI', '康菲 UI'), entry('FLUX.2', 'flux 2'), entry('FLUX'), entry('Qwen Image', 'qwenimage'), entry('Qwen Image Edit'), entry('Z-Image', 'z image'), entry('Stable Diffusion'), entry('SDXL', 's d x l'), entry('LoRA', 'low ra'), entry('ControlNet', 'control net'), entry('IP-Adapter', 'ip adapter'), entry('VAE', 'v a e'), entry('KSampler', 'k sampler'), entry('Wan 2.2'), entry('HunyuanVideo'), entry('LTX-Video'), entry('Seedance'), entry('Nano Banana'), entry('AnimateDiff'), entry('Checkpoint'), entry('CLIP'), entry('潜空间'), entry('采样器'), entry('降噪强度'), entry('提示词权重'), entry('负面提示词'), entry('文生图'), entry('图生图'), entry('图生视频'), entry('局部重绘'), entry('工作流节点')]
  },
  {
    id: 'web-development', name: '前端与全栈', category: '开发', icon: 'code-2',
    summary: '网页框架、接口、数据库与桌面开发',
    files: source('fullstack', 'fullstack', 'tools-and-services'),
    references: ['https://react.dev/', 'https://vuejs.org/', 'https://www.electronjs.org/'],
    additions: [entry('TypeScript', 'type script'), entry('JavaScript', 'java script'), entry('React'), entry('Vue'), entry('Next.js', 'next js'), entry('Node.js', 'node js'), entry('Electron'), entry('Vite'), entry('Tailwind CSS', 'tailwindcss'), entry('FastAPI', 'fast api'), entry('PostgreSQL', 'postgre sql'), entry('SQLite', 'sql lite'), entry('WebSocket', 'web socket'), entry('REST API'), entry('JSON', 'j s o n'), entry('HTML', 'h t m l'), entry('CSS', 'c s s'), entry('前端'), entry('后端'), entry('全栈'), entry('组件'), entry('状态管理'), entry('跨域'), entry('服务端渲染'), entry('接口鉴权'), entry('依赖注入'), entry('单元测试'), entry('端到端测试')]
  },
  {
    id: 'cloud-devops', name: '云端与容器', category: '开发', icon: 'container',
    summary: 'Docker、网络协议、部署与持续集成',
    files: [...source('docker', 'docker-words'), ...source('software-terms', 'network-protocols', 'computing-acronyms')],
    references: ['https://docs.docker.com/', 'https://kubernetes.io/'],
    additions: [entry('Docker'), entry('Docker Compose'), entry('Kubernetes', 'kubernets'), entry('K8s', 'k 8 s'), entry('Nginx'), entry('GitHub Actions', 'git hub actions'), entry('CI/CD'), entry('HTTPS', 'h t t p s'), entry('SSH', 's s h'), entry('DNS', 'd n s'), entry('TCP', 't c p'), entry('UDP', 'u d p'), entry('TLS', 't l s'), entry('容器镜像'), entry('反向代理'), entry('负载均衡'), entry('环境变量'), entry('持续集成'), entry('持续部署'), entry('端口映射'), entry('访问令牌'), entry('服务发现')]
  },
  {
    id: 'speech-audio', name: '语音与音频', category: 'AI 创作', icon: 'audio-lines',
    summary: '本地听写、音频格式、转写与混音',
    files: source('software-terms', 'software-terms'), filter: 'audio|codec|ffmpeg|sample|wave|sound|speech|voice|bitrate|opus|vorbis|flac|midi|pcm',
    references: ['https://github.com/ggml-org/whisper.cpp', 'https://github.com/modelscope/FunASR', 'https://github.com/FunAudioLLM/SenseVoice', 'https://ffmpeg.org/'],
    additions: [entry('FunASR', 'fun asr'), entry('SenseVoice', 'sense voice'), entry('Paraformer', 'para former'), entry('sherpa-onnx', 'sherpa onnx'), entry('Whisper'), entry('whisper.cpp', 'whisper cpp'), entry('FFmpeg', 'ff mpeg'), entry('ASR', 'a s r'), entry('TTS', 't t s'), entry('VAD', 'v a d'), entry('PCM', 'p c m'), entry('WAV', 'w a v'), entry('FLAC'), entry('Opus'), entry('MIDI', 'm i d i'), entry('DAW', 'd a w'), entry('采样率'), entry('位深'), entry('声道'), entry('回声消除'), entry('语音活动检测'), entry('流式识别'), entry('端点检测'), entry('实时率'), entry('音轨'), entry('混音'), entry('压缩器'), entry('均衡器'), entry('母带'), entry('降噪')]
  },
  {
    id: 'game-3d', name: '游戏与三维', category: '创作', icon: 'gamepad-2',
    summary: '游戏开发、渲染、三维资产与引擎',
    files: source('gaming-terms', 'game-development', 'gaming-terms', 'godot', 'unity'),
    references: ['https://godotengine.org/', 'https://www.blender.org/', 'https://threejs.org/'],
    additions: [entry('Godot'), entry('Unity'), entry('Unreal Engine'), entry('Blender'), entry('Three.js', 'three js'), entry('WebGL', 'web gl'), entry('WebGPU', 'web gpu'), entry('glTF'), entry('GLB', 'g l b'), entry('PBR', 'p b r'), entry('Shader'), entry('Mesh'), entry('UV'), entry('法线贴图'), entry('骨骼动画'), entry('物理引擎'), entry('碰撞检测'), entry('光线追踪'), entry('材质'), entry('纹理'), entry('着色器'), entry('帧率'), entry('粒子系统'), entry('场景树')]
  },
  {
    id: 'productivity', name: '软件与效率工具', category: '办公', icon: 'notebook-pen',
    summary: '知识库、编辑器、协作与桌面工具',
    files: source('software-terms', 'software-tools'),
    references: ['https://obsidian.md/', 'https://code.visualstudio.com/', 'https://github.com/iDvel/rime-ice'],
    additions: [entry('Obsidian', '奥比西安'), entry('Notion'), entry('VS Code', 'vs code'), entry('GitHub', 'git hub'), entry('GitLab', 'git lab'), entry('Cursor'), entry('Markdown', 'mark down'), entry('PowerShell', 'power shell'), entry('Windows'), entry('Rime'), entry('Raycast'), entry('Zotero'), entry('Logseq'), entry('双向链接'), entry('反向链接'), entry('知识图谱'), entry('卡片笔记'), entry('每日笔记'), entry('悬浮窗'), entry('快捷键'), entry('剪贴板'), entry('系统托盘'), entry('插件'), entry('工作区')]
  }
];
