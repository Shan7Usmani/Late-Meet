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
  downmixNode: GainNode;
}

/**
 * Connects a media stream to the shared recorder and analyser nodes.
 *
 * The recorder path is routed through a stereo-to-mono downmix node so the
 * MediaRecorder produces mono audio (sufficient for STT, saves ~50%
 * bandwidth/storage).  The analyser and playback destinations always receive
 * the raw (stereo) signal so VAD/waveform are unaffected.
 *
 * Only the tab stream receives a playback destination. The microphone must
 * never be routed to AudioContext.destination because that would create local
 * monitoring and potentially audible feedback.
 */
function connectCaptureSource(
  context: AudioContext,
  stream: MediaStream,
  downmixNode: GainNode,
  analyser: AnalyserNode,
  playbackDestination?: AudioDestinationNode,
): MediaStreamAudioSourceNode {
  const source = context.createMediaStreamSource(stream);

  // Downmix path → recorder (stereo → mono)
  source.connect(downmixNode);

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
  const downmixNode = context.createGain();

  analyser.fftSize = OFFSCREEN_ANALYSER_FFT_SIZE;
  downmixNode.channelCount = 1;
  downmixNode.channelCountMode = "explicit";
  downmixNode.channelInterpretation = "speakers";
  downmixNode.connect(recorderDestination);

  const tabSource = connectCaptureSource(
    context,
    tabStream,
    downmixNode,
    analyser,
    context.destination,
  );

  return {
    recorderDestination,
    analyser,
    tabSource,
    downmixNode,
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
  graph: Pick<OffscreenAudioGraph, "analyser" | "downmixNode">,
): MediaStreamAudioSourceNode {
  return connectCaptureSource(context, microphoneStream, graph.downmixNode, graph.analyser);
}
