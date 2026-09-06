import argparse
import json
import sys

from text_normalize import HOTWORDS, INITIAL_PROMPT, normalize_language, normalize_transcript


def print_json(payload):
    print(json.dumps(payload, ensure_ascii=False))


def normalize_device(device):
    if device == "auto":
        return "cuda"
    return device


def transcribe_with_faster_whisper(args):
    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        raise RuntimeError(
            "本地 Whisper 依赖还没有安装。请在 voice-agent-pad 目录运行："
            "pip install -r requirements-local.txt"
        ) from exc

    device = normalize_device(args.device)
    compute_type = "float16" if device == "cuda" else "int8"

    try:
        model = WhisperModel(args.model, device=device, compute_type=compute_type)
    except Exception:
        if args.device == "auto":
            model = WhisperModel(args.model, device="cpu", compute_type="int8")
        else:
            raise

    language_mode = normalize_language(args.language)
    language = None if language_mode == "zh-en" else language_mode
    segments, info = model.transcribe(
        args.audio,
        language=language,
        vad_filter=True,
        beam_size=5,
        condition_on_previous_text=False,
        initial_prompt=None if language_mode == "en" else INITIAL_PROMPT,
        hotwords=None if language_mode == "en" else HOTWORDS,
    )
    text = "".join(segment.text for segment in segments).strip()
    text = normalize_transcript(text, language_mode)

    return {
        "ok": True,
        "text": text,
        "language": getattr(info, "language", None),
        "language_probability": getattr(info, "language_probability", None),
        "model": args.model
    }


def main():
    parser = argparse.ArgumentParser(description="Local Whisper transcription for Voice Agent Pad.")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default="zh")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    args = parser.parse_args()

    try:
        print_json(transcribe_with_faster_whisper(args))
    except Exception as exc:
        print_json({"ok": False, "error": str(exc)})
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
