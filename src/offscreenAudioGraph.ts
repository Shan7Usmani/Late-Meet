export const OFFSCREEN_ANALYSER_FFT_SIZE = 1024;

export const MICROPHONE_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export interface OffscreenAudioGraph {
  recorderDestination: MediaStreamAudioDestinationNode;
  analyser: AnalyserNode;
  tabSource: MediaStreamAudioSourceNode;
  noiseGateGain: GainNode;
}

/**
 * Connects a media stream to the shared recorder and analyser nodes.
 *
 * The recorder path is routed through the noise gate gain node so the
 * adaptive noise gate can attenuate silent passages before they reach
 * the MediaRecorder.  The analyser and playback destinations always
 * receive the raw (ungated) signal so VAD and waveform rendering are
 * unaffected by the gate state.
 */
function connectCaptureSource(
  context: AudioContext,
  stream: MediaStream,
  recorderDestination: MediaStreamAudioDestinationNode,
  analyser: AnalyserNode,
  noiseGateGain: GainNode,
  playbackDestination?: AudioDestinationNode,
): MediaStreamAudioSourceNode {
  const source = context.createMediaStreamSource(stream);

  // Gated path → recorder (noise gate can mute silent passages)
  source.connect(noiseGateGain);
  noiseGateGain.connect(recorderDestination);

  // Ungated path → analyser (VAD & waveform need raw signal)
  source.connect(analyser);

  if (playbackDestination) {
    source.connect(playbackDestination);
  }

  return source;
}

/**
 * Creates the base offscreen Web Audio graph for tab audio capture.
 */
export function createOffscreenAudioGraph(
  context: AudioContext,
  tabStream: MediaStream,
): OffscreenAudioGraph {
  const recorderDestination = context.createMediaStreamDestination();
  const analyser = context.createAnalyser();
  const noiseGateGain = context.createGain();

  analyser.fftSize = OFFSCREEN_ANALYSER_FFT_SIZE;
  noiseGateGain.gain.value = 1; // start with gate fully open

  const tabSource = connectCaptureSource(
    context,
    tabStream,
    recorderDestination,
    analyser,
    noiseGateGain,
    context.destination,
  );

  return {
    recorderDestination,
    analyser,
    tabSource,
    noiseGateGain,
  };
}

/**
 * Adds an optional microphone stream to the existing offscreen audio graph.
 *
 * The microphone is recorded and analysed but intentionally not played
 * through the local output destination.
 */
export function connectMicrophoneToOffscreenAudioGraph(
  context: AudioContext,
  microphoneStream: MediaStream,
  graph: Pick<OffscreenAudioGraph, "recorderDestination" | "analyser" | "noiseGateGain">,
): MediaStreamAudioSourceNode {
  return connectCaptureSource(
    context,
    microphoneStream,
    graph.recorderDestination,
    graph.analyser,
    graph.noiseGateGain,
  );
}
