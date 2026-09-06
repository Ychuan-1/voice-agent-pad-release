"""Persistent, offline Paraformer decoder. JSON-lines over local stdin/stdout."""

import argparse
import base64
import json
from pathlib import Path
import sys
import time

import numpy as np
import sherpa_onnx

from text_normalize import normalize_language, normalize_transcript


def emit(message):
    print(json.dumps(message, ensure_ascii=False), flush=True)


def join_text(left, right):
    if not left or not right:
        return left or right
    space = left[-1].isascii() and left[-1].isalnum() and right[0].isascii() and right[0].isalnum()
    return left + (" " if space else "") + right


class StreamingDecoder:
    def __init__(self, model_dir, threads=2):
        self.recognizer = sherpa_onnx.OnlineRecognizer.from_paraformer(
            tokens=str(model_dir / "tokens.txt"),
            encoder=str(model_dir / "encoder.int8.onnx"),
            decoder=str(model_dir / "decoder.int8.onnx"),
            num_threads=threads,
            provider="cpu",
            enable_endpoint_detection=True,
            rule1_min_trailing_silence=2.4,
            rule2_min_trailing_silence=1.2,
            rule3_min_utterance_length=30,
        )
        self.stream = None
        self.session = None
        # Warm the decoder once, before accepting microphone audio.
        warm = self.recognizer.create_stream()
        warm.accept_waveform(16000, np.zeros(16000, dtype=np.float32))
        warm.input_finished()
        while self.recognizer.is_ready(warm):
            self.recognizer.decode_stream(warm)

    def start(self, session, language):
        if self.stream is not None:
            raise ValueError("A recording is already active")
        self.session = session
        self.language = normalize_language(language)
        self.stream = self.recognizer.create_stream()
        self.committed = ""
        self.last_text = ""
        self.audio_seconds = 0
        self.decode_seconds = 0
        self.partial_count = 0
        self.first_partial_audio_seconds = None
        self.sample_rate = None

    def text(self):
        current = normalize_transcript(self.recognizer.get_result(self.stream), self.language)
        return join_text(self.committed, current)

    def decode(self, endpoint=True):
        started = time.perf_counter()
        while self.recognizer.is_ready(self.stream):
            self.recognizer.decode_stream(self.stream)
            text = self.text()
            if text != self.last_text:
                self.last_text = text
                self.partial_count += 1
                if text and self.first_partial_audio_seconds is None:
                    self.first_partial_audio_seconds = self.audio_seconds
                emit({"event": "partial", "session": self.session, "text": text})
            if endpoint and self.recognizer.is_endpoint(self.stream):
                self.committed = text
                self.recognizer.reset(self.stream)
        self.decode_seconds += time.perf_counter() - started

    def audio(self, pcm, sample_rate):
        if sample_rate not in {8000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000}:
            raise ValueError("Unsupported microphone sample rate")
        if self.sample_rate is not None and self.sample_rate != sample_rate:
            raise ValueError("Microphone sample rate changed during recording")
        self.sample_rate = sample_rate
        raw = base64.b64decode(pcm, validate=True)
        if len(raw) % 4 or len(raw) > sample_rate * 4:
            raise ValueError("Invalid PCM frame")
        samples = np.frombuffer(raw, dtype="<f4")
        if not np.isfinite(samples).all():
            raise ValueError("Invalid audio samples")
        self.audio_seconds += samples.size / sample_rate
        self.stream.accept_waveform(sample_rate, samples)
        self.decode()

    def finish(self):
        started = time.perf_counter()
        rate = self.sample_rate or 16000
        self.stream.accept_waveform(rate, np.zeros(round(rate * 0.8), dtype=np.float32))
        self.stream.input_finished()
        self.decode(endpoint=False)
        result = {
            "text": self.text(),
            "audioSeconds": round(self.audio_seconds, 3),
            "decodeSeconds": round(self.decode_seconds, 3),
            "finishMs": round((time.perf_counter() - started) * 1000, 1),
            "partialCount": self.partial_count,
            "firstPartialAudioSeconds": self.first_partial_audio_seconds,
        }
        self.stream = None
        self.session = None
        return result

    def handle(self, message):
        operation = message.get("op")
        session = message.get("session")
        if operation == "start":
            self.start(session, message.get("language", "zh-en"))
            return {}
        if self.stream is None or session != self.session:
            raise ValueError("Recording session is no longer active")
        if operation == "audio":
            self.audio(message["pcm"], int(message["sampleRate"]))
            return {}
        if operation == "finish":
            return self.finish()
        if operation == "cancel":
            self.stream = None
            self.session = None
            return {}
        raise ValueError("Unknown streaming operation")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()
    started = time.perf_counter()
    try:
        decoder = StreamingDecoder(args.model_dir, min(4, max(1, args.threads)))
    except Exception as error:
        emit({"event": "startup-error", "error": str(error)})
        return 1
    emit({"event": "ready", "loadMs": round((time.perf_counter() - started) * 1000), "version": sherpa_onnx.__version__})
    for line in sys.stdin:
        message = {}
        try:
            message = json.loads(line)
            result = decoder.handle(message)
            emit({"id": message["id"], "ok": True, **result})
        except Exception as error:
            emit({"id": message.get("id"), "ok": False, "error": str(error)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
