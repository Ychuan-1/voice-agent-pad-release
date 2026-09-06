import argparse
import json
import sys

from text_normalize import HOTWORDS, INITIAL_PROMPT, normalize_language, normalize_transcript


def print_json(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def normalize_device(device):
    if device == "auto":
        return "cuda"
    return device


def load_model(model_name, device_name):
    from faster_whisper import WhisperModel

    device = normalize_device(device_name)
    compute_type = "float16" if device == "cuda" else "int8"

    try:
        return WhisperModel(model_name, device=device, compute_type=compute_type)
    except Exception:
        if device_name == "auto":
            return WhisperModel(model_name, device="cpu", compute_type="int8")
        raise


def transcribe(model, request):
    language_mode = normalize_language(request.get("language") or "zh")
    language = None if language_mode == "zh-en" else language_mode
    segments, info = model.transcribe(
        request["audio"],
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
        "id": request.get("id"),
        "ok": True,
        "text": text,
        "language": getattr(info, "language", None),
        "language_probability": getattr(info, "language_probability", None),
    }


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Persistent local Whisper worker for Voice Agent Pad.")
    parser.add_argument("--model", default="base")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    args = parser.parse_args()

    try:
        model = load_model(args.model, args.device)
    except Exception as exc:
        print_json({"event": "startup-error", "ok": False, "error": str(exc)})
        return 1

    for line in sys.stdin:
        try:
            request = json.loads(line)
            print_json(transcribe(model, request))
        except Exception as exc:
            request_id = None
            try:
                request_id = request.get("id")
            except Exception:
                pass
            print_json({"id": request_id, "ok": False, "error": str(exc)})

    return 0


if __name__ == "__main__":
    sys.exit(main())
