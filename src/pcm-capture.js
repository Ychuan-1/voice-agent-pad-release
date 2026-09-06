class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(Math.round(sampleRate / 20));
    this.offset = 0;
    this.stopped = false;
    this.port.onmessage = ({ data }) => {
      if (data === 'stop') {
        this.flush();
        this.stopped = true;
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  flush() {
    if (!this.offset) return;
    const pcm = this.buffer.slice(0, this.offset);
    this.port.postMessage({ type: 'pcm', pcm: pcm.buffer }, [pcm.buffer]);
    this.offset = 0;
  }

  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    let position = 0;
    while (position < input.length) {
      const count = Math.min(input.length - position, this.buffer.length - this.offset);
      this.buffer.set(input.subarray(position, position + count), this.offset);
      this.offset += count;
      position += count;
      if (this.offset === this.buffer.length) this.flush();
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
