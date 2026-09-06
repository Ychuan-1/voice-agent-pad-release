import re


INITIAL_PROMPT = (
    "请使用简体中文转写。保留英文产品名和技术名词，不要翻译它们。"
    "常见术语包括 Codex、Obsidian、ComfyUI、Agent、Whisper、faster-whisper、"
    "ChatGPT、OpenAI、Stable Diffusion、LoRA、ControlNet、前端、后端、插件、"
    "智能体、卡片笔记、知识库、语音转文字。"
)

HOTWORDS = (
    "Codex Obsidian ComfyUI Agent Whisper faster-whisper ChatGPT OpenAI "
    "Stable Diffusion LoRA ControlNet AI GPT Bilibili Markdown "
    "前端 后端 插件 智能体 卡片笔记 知识库 语音转文字 简体中文"
)

_OPENCC = None
_OPENCC_LOADED = False

_FALLBACK_TRADITIONAL_TO_SIMPLIFIED = str.maketrans({
    "後": "后",
    "裡": "里",
    "裏": "里",
    "這": "这",
    "個": "个",
    "們": "们",
    "來": "来",
    "為": "为",
    "會": "会",
    "說": "说",
    "語": "语",
    "話": "话",
    "轉": "转",
    "寫": "写",
    "識": "识",
    "別": "别",
    "錯": "错",
    "誤": "误",
    "顯": "显",
    "現": "现",
    "當": "当",
    "前": "前",
    "輸": "输",
    "入": "入",
    "框": "框",
    "點": "点",
    "擊": "击",
    "開": "开",
    "啟": "启",
    "關": "关",
    "閉": "闭",
    "錄": "录",
    "音": "音",
    "聲": "声",
    "紋": "纹",
    "設": "设",
    "置": "置",
    "選": "选",
    "擇": "择",
    "麥": "麦",
    "風": "风",
    "電": "电",
    "腦": "脑",
    "內": "内",
    "帶": "带",
    "機": "机",
    "統": "统",
    "默": "默",
    "認": "认",
    "體": "体",
    "簡": "简",
    "繁": "繁",
    "復": "复",
    "製": "制",
    "貼": "贴",
    "歷": "历",
    "記": "记",
    "錄": "录",
    "資": "资",
    "料": "料",
    "檔": "档",
    "案": "案",
    "學": "学",
    "習": "习",
    "圖": "图",
    "庫": "库",
    "節": "节",
    "構": "构",
    "劃": "划",
    "劑": "剂",
    "軟": "软",
    "體": "体",
    "應": "应",
    "該": "该",
    "無": "无",
    "論": "论",
    "時": "时",
    "候": "候",
    "並": "并",
    "與": "与",
    "還": "还",
    "讓": "让",
    "級": "级",
    "務": "务",
    "務": "务",
    "確": "确",
    "實": "实",
    "權": "权",
    "限": "限",
    "網": "网",
    "絡": "络",
    "雲": "云",
    "端": "端",
    "數": "数",
    "據": "据",
    "腳": "脚",
    "本": "本",
    "視": "视",
    "頻": "频",
    "訊": "讯",
    "號": "号",
    "標": "标",
    "籤": "签",
    "題": "题",
    "頁": "页",
    "線": "线",
    "遠": "远",
    "過": "过",
    "長": "长",
    "準": "准",
    "壓": "压",
    "縮": "缩",
    "檢": "检",
    "測": "测",
    "覽": "览",
    "預": "预",
    "熱": "热",
    "詞": "词",
    "彙": "汇",
    "專": "专",
    "業": "业",
    "術": "术",
    "語": "语",
})

_SENSEVOICE_TAG_RE = re.compile(r"<\|[^|]+\|>")
_KANA_HANGUL_RE = re.compile(r"[\u3040-\u30ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]")
_CJK_AND_KANA_HANGUL_RE = re.compile(
    r"[\u3040-\u30ff\uff66-\uff9f\u3400-\u9fff\uf900-\ufaff\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]"
)
_NOT_ASCII_TEXT_RE = re.compile(r"[^\x20-\x7e\r\n]")
_NOT_ZH_EN_TEXT_RE = re.compile(
    r"""[^\u3400-\u9fff\uf900-\ufaffA-Za-z0-9\s，。！？、；：,.!?;:'"()[\]{}<>《》【】+\-*/_=#@&%$`~^|\\/]"""
)
_NOT_ZH_TEXT_RE = re.compile(
    r"""[^\u3400-\u9fff\uf900-\ufaff0-9\s，。！？、；：,.!?;:'"()[\]{}<>《》【】+\-*/_=#@&%$`~^|\\/]"""
)


def normalize_language(language):
    value = str(language or "").strip().lower()
    if value in {"en", "english"}:
        return "en"
    if value in {"zh-en", "zhen", "bilingual", "auto"}:
        return "zh-en"
    return "zh"


def _get_opencc():
    global _OPENCC, _OPENCC_LOADED
    if _OPENCC_LOADED:
        return _OPENCC

    _OPENCC_LOADED = True
    try:
        from opencc import OpenCC

        _OPENCC = OpenCC("t2s")
    except Exception:
        _OPENCC = None
    return _OPENCC


def to_simplified(text):
    clean_text = str(text or "")
    converter = _get_opencc()
    if converter:
        return converter.convert(clean_text)
    return clean_text.translate(_FALLBACK_TRADITIONAL_TO_SIMPLIFIED)


def filter_transcript_by_language(text, language="zh"):
    clean_text = _SENSEVOICE_TAG_RE.sub("", str(text or ""))
    mode = normalize_language(language)

    if mode == "en":
        clean_text = _CJK_AND_KANA_HANGUL_RE.sub(" ", clean_text)
        clean_text = _NOT_ASCII_TEXT_RE.sub("", clean_text)
    else:
        clean_text = to_simplified(clean_text)
        clean_text = _KANA_HANGUL_RE.sub("", clean_text)
        clean_text = (_NOT_ZH_EN_TEXT_RE if mode == "zh-en" else _NOT_ZH_TEXT_RE).sub("", clean_text)

    return re.sub(r"[ \t]+", " ", clean_text).strip()


def normalize_transcript(text, language="zh"):
    return filter_transcript_by_language(text, language)
