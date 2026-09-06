import argparse
import json
import sys
from pathlib import Path

from text_normalize import normalize_language, normalize_transcript


DEFAULT_MODEL = "iic/SenseVoiceSmall"
DEFAULT_VAD_MODEL = "fsmn-vad"
KNOWN_MODELSCOPE_CACHE_PATHS = {
    "iic/SenseVoiceSmall": Path.home() / ".cache" / "modelscope" / "models" / "iic--SenseVoiceSmall" / "snapshots" / "master",
    "fsmn-vad": Path.home() / ".cache" / "modelscope" / "models" / "iic--speech_fsmn_vad_zh-cn-16k-common-pytorch" / "snapshots" / "master",
}


def print_json(payload):
    print(json.dumps(payload, ensure_ascii=False))


def normalize_device(device):
    if device != "auto":
        return device

    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def get_sensevoice_language(language):
    mode = normalize_language(language)
    return "auto" if mode == "zh-en" else mode


def postprocess_text(text, language="zh"):
    clean_text = str(text or "").strip()
    if not clean_text:
        return ""

    try:
        from funasr.utils.postprocess_utils import rich_transcription_postprocess

        clean_text = rich_transcription_postprocess(clean_text)
    except Exception:
        pass

    return normalize_transcript(clean_text, language)


def resolve_model_reference(model_name):
    model_path = Path(str(model_name)).expanduser()
    if model_path.exists():
        return str(model_path)

    cached_path = KNOWN_MODELSCOPE_CACHE_PATHS.get(str(model_name))
    if cached_path and cached_path.exists():
        return str(cached_path)

    return model_name


def extract_text(result, language="zh"):
    if not isinstance(result, list):
        result = [result]

    parts = []
    for item in result:
        if not isinstance(item, dict):
            parts.append(str(item))
            continue

        sentence_info = item.get("sentence_info")
        if sentence_info:
            for sentence in sentence_info:
                if isinstance(sentence, dict):
                    parts.append(sentence.get("text") or sentence.get("sentence") or "")
            continue

        parts.append(item.get("text") or "")

    return postprocess_text("".join(parts), language)


def load_model(model_name, device_name):
    try:
        from funasr import AutoModel
    except Exception as exc:
        raise RuntimeError(
            "本地 SenseVoice 依赖还没有安装。请在 voice-agent-pad 目录运行："
            "pip install -r requirements-local.txt"
        ) from exc

    device = normalize_device(device_name)
    options = {
        "model": resolve_model_reference(model_name),
        "vad_model": resolve_model_reference(DEFAULT_VAD_MODEL),
        "device": device,
        "disable_update": True,
    }

    try:
        return AutoModel(**options)
    except TypeError:
        options.pop("disable_update", None)
        return AutoModel(**options)


def transcribe_with_sensevoice(args):
    language_mode = normalize_language(args.language)
    model = load_model(args.model, args.device)
    result = model.generate(
        input=args.audio,
        language=get_sensevoice_language(language_mode),
        use_itn=True,
        batch_size_s=60,
    )

    return {
        "ok": True,
        "text": extract_text(result, language_mode),
        "language": language_mode,
        "engine": "sensevoice",
        "model": args.model,
    }


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Local SenseVoice transcription for Voice Agent Pad.")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--language", default="zh")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    args = parser.parse_args()

    try:
        print_json(transcribe_with_sensevoice(args))
    except Exception as exc:
        print_json({"ok": False, "error": str(exc), "engine": "sensevoice"})
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
