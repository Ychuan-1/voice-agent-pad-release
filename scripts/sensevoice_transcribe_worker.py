import argparse
import json
import sys

from sensevoice_transcribe import DEFAULT_MODEL, extract_text, get_sensevoice_language, load_model
from text_normalize import normalize_language


def print_json(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def transcribe(model, request, model_name):
    language_mode = normalize_language(request.get("language") or "zh")
    result = model.generate(
        input=request["audio"],
        language=get_sensevoice_language(language_mode),
        use_itn=True,
        batch_size_s=60,
    )
    return {
        "id": request.get("id"),
        "ok": True,
        "text": extract_text(result, language_mode),
        "language": language_mode,
        "engine": "sensevoice",
        "model": model_name,
    }


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Persistent local SenseVoice worker for Voice Agent Pad.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    args = parser.parse_args()

    try:
        model = load_model(args.model, args.device)
    except Exception as exc:
        print_json({"event": "startup-error", "ok": False, "error": str(exc), "engine": "sensevoice"})
        return 1

    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            print_json(transcribe(model, request, args.model))
        except Exception as exc:
            request_id = request.get("id") if isinstance(request, dict) else None
            print_json({"id": request_id, "ok": False, "error": str(exc), "engine": "sensevoice"})

    return 0


if __name__ == "__main__":
    sys.exit(main())
