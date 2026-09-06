"""Download only the public INT8 streaming model, with SHA-256 validation."""

import hashlib
import json
from pathlib import Path
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models" / "paraformer-streaming-zh-en"
REPO = "csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en"
FILES = {
    "encoder.int8.onnx": (165462184, "81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a"),
    "decoder.int8.onnx": (71664561, "f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f"),
    "tokens.txt": (75756, None),
    "test_wavs/0.wav": (321744, None),
    "test_wavs/1.wav": (163244, None),
    "test_wavs/2.wav": (150124, None),
    "test_wavs/3.wav": (282604, None),
    "test_wavs/8k.wav": (282284, None),
    "README.md": (415, None),
}


def valid(path, size, digest):
    if not path.is_file() or path.stat().st_size != size:
        return False
    if not digest:
        return True
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest() == digest


def main():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(f"https://huggingface.co/api/models/{REPO}", timeout=30) as response:
        revision = json.load(response)["sha"]
    for name, (size, digest) in FILES.items():
        target = MODEL_DIR / name
        if valid(target, size, digest):
            print(f"Verified: {name}", flush=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + ".download")
        print(f"Downloading: {name} ({size / 1024 / 1024:.1f} MiB)", flush=True)
        request = urllib.request.Request(
            f"https://huggingface.co/{REPO}/resolve/{revision}/{name}",
            headers={"User-Agent": "VoiceAgentPad-local-setup/1.0"},
        )
        with urllib.request.urlopen(request, timeout=60) as response, temporary.open("wb") as output:
            while block := response.read(1024 * 1024):
                output.write(block)
        if not valid(temporary, size, digest):
            raise RuntimeError(f"Download validation failed: {name}")
        temporary.replace(target)
    manifest = {"repository": REPO, "revision": revision, "files": FILES, "license": "Apache-2.0"}
    (MODEL_DIR / "download-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Local streaming model ready.", flush=True)


if __name__ == "__main__":
    main()
