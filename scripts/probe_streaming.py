"""Replay public WAV audio through the real worker; verify partial/final behavior."""

import argparse
import base64
import json
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
import wave

import numpy as np


ROOT = Path(__file__).resolve().parents[1]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--realtime", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    process = subprocess.Popen([
        sys.executable, "-u", str(ROOT / "scripts" / "streaming_asr_worker.py"),
        "--model-dir", str(ROOT / "models" / "paraformer-streaming-zh-en"),
    ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8")
    messages = queue.Queue()
    reader = threading.Thread(target=lambda: [messages.put(json.loads(line)) for line in process.stdout], daemon=True)
    reader.start()
    partials = []
    request_id = 0

    def request(op, **payload):
        nonlocal request_id
        request_id += 1
        process.stdin.write(json.dumps({"id": str(request_id), "op": op, **payload}) + "\n")
        process.stdin.flush()
        while True:
            message = messages.get(timeout=45)
            if message.get("event") == "partial":
                partials.append({"at": time.perf_counter(), **message})
            elif message.get("id") == str(request_id):
                assert message["ok"], message
                return message
            else:
                raise AssertionError(message)

    reports = []
    try:
        ready = messages.get(timeout=45)
        assert ready["event"] == "ready", ready
        print(json.dumps(ready), flush=True)
        wav_dir = ROOT / "models" / "paraformer-streaming-zh-en" / "test_wavs"
        cases = [("0.wav", "zh-en"), ("1.wav", "zh"), ("2.wav", "zh-en"), ("3.wav", "zh-en"), ("8k.wav", "zh-en"), ("0.wav", "en"), (None, "zh")]
        for case, (filename, language) in enumerate(cases):
            session = f"probe-{case}"
            if filename:
                with wave.open(str(wav_dir / filename), "rb") as wav:
                    assert wav.getnchannels() == 1 and wav.getsampwidth() == 2
                    rate = wav.getframerate()
                    samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float32) / 32768
            else:
                rate, samples = 48000, np.zeros(48000 * 3, dtype=np.float32)
            partials.clear()
            request("start", session=session, language=language)
            start = time.perf_counter()
            frame = round(rate * 0.05)
            for offset in range(0, len(samples), frame):
                chunk = samples[offset:offset + frame]
                if args.realtime and case == 0:
                    time.sleep(max(0, start + (offset + len(chunk)) / rate - time.perf_counter()))
                request("audio", session=session, sampleRate=rate, pcm=base64.b64encode(chunk.astype("<f4").tobytes()).decode("ascii"))
            before_finish = len(partials)
            finished = request("finish", session=session)
            elapsed = time.perf_counter() - start
            if filename:
                assert finished["text"], (filename, finished)
                assert before_finish > 0, "No text appeared before stopping"
                assert finished["text"] == partials[-1]["text"], "Final text duplicated or diverged from last partial"
            else:
                assert not finished["text"], "Silence hallucination"
            if language == "en":
                assert finished["text"].isascii(), finished
            report = {
                "file": filename or "silence", "language": language, **finished,
                "partialsBeforeStop": before_finish, "wallSeconds": round(elapsed, 3),
                "rtf": round(finished["decodeSeconds"] / finished["audioSeconds"], 3),
                "firstPartialWallMs": round((partials[0]["at"] - start) * 1000) if partials else None,
            }
            reports.append(report)
            print(json.dumps(report, ensure_ascii=False), flush=True)
        request("start", session="cancelled", language="zh")
        request("cancel", session="cancelled")
        request("start", session="after-cancel", language="zh")
        request("finish", session="after-cancel")
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps({"ready": ready, "cases": reports}, ensure_ascii=False, indent=2), encoding="utf-8")
        print("PASS: partial results, final flush, sequential sessions, languages, silence and cancellation", flush=True)
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


if __name__ == "__main__":
    main()
