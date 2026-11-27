import type { AppView, MemoryItem, TimerWidgetData } from '../types/chat';
import { fetchLiveTicket } from './authClient';

export type LiveVoiceName = 'Zephyr' | 'Kore' | 'Puck' | 'Charon' | 'Fenrir';

export const LIVE_VOICES: Array<{ id: LiveVoiceName; label: string; tone: string }> = [
  { id: 'Zephyr', label: 'Zephyr', tone: 'Warm & balanced' },
  { id: 'Kore', label: 'Kore', tone: 'Clear & bright' },
  { id: 'Puck', label: 'Puck', tone: 'Lively & upbeat' },
  { id: 'Charon', label: 'Charon', tone: 'Calm & deep' },
  { id: 'Fenrir', label: 'Fenrir', tone: 'Crisp & direct' },
];

export type LiveConnectionState =
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'error'
  | 'closed';

export interface LiveMemoryEvent {
  action: 'saved' | 'forgotten';
  memory?: MemoryItem;
  removedIds?: string[];
}

export interface LiveSessionCallbacks {
  onStateChange: (state: LiveConnectionState) => void;
  onInputTranscript: (text: string) => void;
  onOutputTranscript: (text: string) => void;
  onTurnComplete: () => void;
  onAudioLevel: (levels: { input: number; output: number }) => void;
  onTimer?: (timer: TimerWidgetData) => void;
  onMemoryEvent?: (event: LiveMemoryEvent) => void;
  onError: (message: string) => void;
}

function downsampleTo16k(
  samples: Float32Array,
  sourceRate: number
): Float32Array {
  if (sourceRate === 16000) return samples;
  const ratio = sourceRate / 16000;
  const outputLength = Math.max(1, Math.floor(samples.length / ratio));
  const result = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += samples[j];
      count++;
    }
    result[i] = count > 0 ? sum / count : samples[start] ?? 0;
  }
  return result;
}

function float32PcmToBase64(floatSamples: Float32Array): string {
  const bytes = new Uint8Array(floatSamples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < floatSamples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, floatSamples[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(i * 2, int16, true);
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const byteLength = binary.length;
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(byteLength / 2);
  const floats = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    floats[i] = view.getInt16(i * 2, true) / 32768;
  }
  return floats;
}

function createAudioContextSafe(preferredRate: number): AudioContext {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  try {
    return new AudioCtx({ sampleRate: preferredRate });
  } catch {
    return new AudioCtx();
  }
}

export class LiveVoiceSessionClient {
  private ws: WebSocket | null = null;
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private activePlaybackNodes = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  private muted = false;
  private disposed = false;
  private hasError = false;
  private inputLevel = 0;
  private levelRafId: number | null = null;
  private callbacks: LiveSessionCallbacks;

  constructor(callbacks: LiveSessionCallbacks) {
    this.callbacks = callbacks;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      this.inputLevel = 0;
    }
  }

  public sendVideoFrame(base64Jpeg: string): void {
    if (this.disposed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ type: 'video', data: base64Jpeg }));
    } catch {
      // Ignore send errors on closing WebSocket
    }
  }

  public async start(
    voice: LiveVoiceName,
    view: AppView = 'chat',
    guestMemories?: MemoryItem[]
  ): Promise<void> {
    this.disposed = false;
    this.hasError = false;
    this.callbacks.onStateChange('connecting');

    if (!navigator.mediaDevices?.getUserMedia) {
      this.callbacks.onError('Microphone capture is not supported in this browser.');
      this.callbacks.onStateChange('error');
      this.stop();
      return;
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow microphone access to talk with Hazel live.'
          : 'Could not access your microphone.';
      this.callbacks.onError(msg);
      this.callbacks.onStateChange('error');
      this.stop();
      return;
    }

    if (this.disposed) {
      this.stop();
      return;
    }

    try {
      this.inputCtx = createAudioContextSafe(16000);
      this.outputCtx = createAudioContextSafe(24000);
      if (this.inputCtx.state === 'suspended') await this.inputCtx.resume();
      if (this.outputCtx.state === 'suspended') await this.outputCtx.resume();

      this.outputAnalyser = this.outputCtx.createAnalyser();
      this.outputAnalyser.fftSize = 128;
      this.outputAnalyser.connect(this.outputCtx.destination);
      this.nextStartTime = this.outputCtx.currentTime;
    } catch {
      this.callbacks.onError('Could not initialize audio playback for Live mode.');
      this.callbacks.onStateChange('error');
      this.stop();
      return;
    }

    const ticket = await fetchLiveTicket(guestMemories);
    if (this.disposed) {
      this.stop();
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const tzOffset = new Date().getTimezoneOffset();
    const ticketParam = ticket ? `&ticket=${encodeURIComponent(ticket)}` : '';
    const wsUrl = `${protocol}//${window.location.host}/api/live?voice=${encodeURIComponent(voice)}&view=${encodeURIComponent(view)}&tzOffset=${encodeURIComponent(String(tzOffset))}${ticketParam}`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      if (this.disposed) return;
      this.setupMicCapture(ws);
      this.startMeterLoop();
    };

    ws.onmessage = (event) => {
      if (this.disposed) return;
      let msg: {
        type?: string;
        data?: string;
        text?: string;
        message?: string;
        timer?: TimerWidgetData;
        action?: 'saved' | 'forgotten';
        memory?: MemoryItem;
        removedIds?: string[];
      };
      try {
        msg = JSON.parse(event.data as string) as typeof msg;
      } catch {
        return;
      }

      if (msg.type === 'ready') {
        this.callbacks.onStateChange('listening');
      } else if (msg.type === 'audio' && typeof msg.data === 'string') {
        this.callbacks.onStateChange('speaking');
        this.enqueueOutputAudio(msg.data);
      } else if (msg.type === 'inputTranscript' && typeof msg.text === 'string') {
        this.callbacks.onInputTranscript(msg.text);
      } else if (msg.type === 'outputTranscript' && typeof msg.text === 'string') {
        this.callbacks.onOutputTranscript(msg.text);
      } else if (msg.type === 'timer' && msg.timer && msg.timer.kind === 'timer') {
        this.callbacks.onTimer?.(msg.timer);
      } else if (
        msg.type === 'memory' &&
        (msg.action === 'saved' || msg.action === 'forgotten')
      ) {
        this.callbacks.onMemoryEvent?.({
          action: msg.action,
          memory: msg.memory,
          removedIds: Array.isArray(msg.removedIds) ? msg.removedIds : undefined,
        });
      } else if (msg.type === 'interrupted') {
        this.clearPlaybackQueue();
        this.callbacks.onStateChange('listening');
      } else if (msg.type === 'turnComplete') {
        this.callbacks.onTurnComplete();
        if (this.activePlaybackNodes.size === 0) {
          this.callbacks.onStateChange('listening');
        }
      } else if (msg.type === 'error' && typeof msg.message === 'string') {
        this.hasError = true;
        this.callbacks.onError(msg.message);
        this.callbacks.onStateChange('error');
      } else if (msg.type === 'closed') {
        if (!this.hasError) {
          this.callbacks.onStateChange('closed');
        }
      }
    };

    ws.onerror = () => {
      if (this.disposed) return;
      this.hasError = true;
      this.callbacks.onError('Live voice WebSocket connection failed.');
      this.callbacks.onStateChange('error');
    };

    ws.onclose = () => {
      if (!this.disposed && !this.hasError) {
        this.callbacks.onStateChange('closed');
      }
    };
  }

  private setupMicCapture(ws: WebSocket): void {
    if (!this.inputCtx || !this.mediaStream) return;
    const source = this.inputCtx.createMediaStreamSource(this.mediaStream);
    // Use silent gain node so script processor runs without audio feedback
    const silentGain = this.inputCtx.createGain();
    silentGain.gain.value = 0;

    const processor = this.inputCtx.createScriptProcessor(4096, 1, 1);
    const actualSampleRate = this.inputCtx.sampleRate;

    processor.onaudioprocess = (event) => {
      if (this.disposed || ws.readyState !== WebSocket.OPEN) return;
      const raw = event.inputBuffer.getChannelData(0);

      if (this.muted) {
        this.inputLevel = 0;
        return;
      }

      // Compute RMS for reactive UI orb
      let sumSq = 0;
      for (let i = 0; i < raw.length; i++) {
        sumSq += raw[i] * raw[i];
      }
      this.inputLevel = Math.min(1, Math.sqrt(sumSq / raw.length) * 4.5);

      const resampled = downsampleTo16k(raw, actualSampleRate);
      const base64 = float32PcmToBase64(resampled);
      try {
        ws.send(JSON.stringify({ type: 'audio', data: base64 }));
      } catch {
        // Ignore send errors if socket closed mid-frame
      }
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(this.inputCtx.destination);

    this.sourceNode = source;
    this.processorNode = processor;
  }

  private enqueueOutputAudio(base64Pcm: string): void {
    if (!this.outputCtx || !this.outputAnalyser) return;
    if (this.outputCtx.state === 'suspended') {
      void this.outputCtx.resume().catch(() => {});
    }
    let floats: Float32Array;
    try {
      floats = base64PcmToFloat32(base64Pcm);
    } catch {
      return;
    }
    if (floats.length === 0) return;

    const buffer = this.outputCtx.createBuffer(1, floats.length, 24000);
    buffer.getChannelData(0).set(floats);

    const node = this.outputCtx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.outputAnalyser);

    const startAt = Math.max(this.outputCtx.currentTime, this.nextStartTime);
    node.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    this.activePlaybackNodes.add(node);
    node.onended = () => {
      this.activePlaybackNodes.delete(node);
      if (this.activePlaybackNodes.size === 0 && !this.disposed) {
        this.callbacks.onStateChange('listening');
      }
    };
  }

  private clearPlaybackQueue(): void {
    for (const node of this.activePlaybackNodes) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // Ignore already-stopped nodes
      }
    }
    this.activePlaybackNodes.clear();
    if (this.outputCtx) {
      this.nextStartTime = this.outputCtx.currentTime;
    }
  }

  private startMeterLoop(): void {
    const freqBins = new Uint8Array(this.outputAnalyser?.frequencyBinCount ?? 32);
    const tick = () => {
      if (this.disposed) return;
      let outputLevel = 0;
      if (this.outputAnalyser && this.activePlaybackNodes.size > 0) {
        this.outputAnalyser.getByteFrequencyData(freqBins);
        let sum = 0;
        for (let i = 0; i < freqBins.length; i++) sum += freqBins[i];
        outputLevel = Math.min(1, sum / (freqBins.length * 140));
      }
      this.callbacks.onAudioLevel({
        input: this.inputLevel,
        output: outputLevel,
      });
      this.levelRafId = requestAnimationFrame(tick);
    };
    this.levelRafId = requestAnimationFrame(tick);
  }

  public stop(): void {
    this.disposed = true;
    if (this.levelRafId !== null) {
      cancelAnimationFrame(this.levelRafId);
      this.levelRafId = null;
    }
    this.clearPlaybackQueue();

    try {
      this.processorNode?.disconnect();
      this.sourceNode?.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    this.processorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {
        // Ignore
      }
      this.ws = null;
    }

    if (this.inputCtx) {
      void this.inputCtx.close().catch(() => {});
      this.inputCtx = null;
    }
    if (this.outputCtx) {
      void this.outputCtx.close().catch(() => {});
      this.outputCtx = null;
    }
    this.outputAnalyser = null;
  }
}
