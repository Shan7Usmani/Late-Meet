import assert from "node:assert/strict";
import test from "node:test";

import {
  connectMicrophoneToOffscreenAudioGraph,
  createOffscreenAudioGraph,
  MICROPHONE_AUDIO_CONSTRAINTS,
  OFFSCREEN_ANALYSER_FFT_SIZE,
} from "../src/offscreenAudioGraph.ts";

class MockAudioNode {
  readonly connections: MockAudioNode[] = [];

  connect(destination: MockAudioNode): MockAudioNode {
    this.connections.push(destination);
    return destination;
  }
}

class MockSourceNode extends MockAudioNode {
  constructor(readonly stream: MediaStream) {
    super();
  }
}

class MockAnalyserNode extends MockAudioNode {
  fftSize = 2048;
}

class MockGainNode extends MockAudioNode {
  gain = { value: 1 };
  channelCount = 2;
  channelCountMode: ChannelCountMode = "max";
  channelInterpretation: ChannelInterpretation = "speakers";
}

class MockMediaStreamDestinationNode extends MockAudioNode {
  readonly stream = createMockStream("recorder-output");
}

class MockAudioContext {
  readonly destination = new MockAudioNode();
  readonly analysers: MockAnalyserNode[] = [];
  readonly recorderDestinations: MockMediaStreamDestinationNode[] = [];
  readonly sources: MockSourceNode[] = [];
  readonly gainNodes: MockGainNode[] = [];

  createMediaStreamDestination(): MediaStreamAudioDestinationNode {
    const destination = new MockMediaStreamDestinationNode();
    this.recorderDestinations.push(destination);

    return destination as unknown as MediaStreamAudioDestinationNode;
  }

  createAnalyser(): AnalyserNode {
    const analyser = new MockAnalyserNode();
    this.analysers.push(analyser);

    return analyser as unknown as AnalyserNode;
  }

  createGain(): GainNode {
    const gain = new MockGainNode();
    this.gainNodes.push(gain);
    return gain as unknown as GainNode;
  }

  createMediaStreamSource(stream: MediaStream): MediaStreamAudioSourceNode {
    const source = new MockSourceNode(stream);
    this.sources.push(source);

    return source as unknown as MediaStreamAudioSourceNode;
  }
}

function createMockStream(id: string): MediaStream {
  return { id } as unknown as MediaStream;
}

function asAudioContext(context: MockAudioContext): AudioContext {
  return context as unknown as AudioContext;
}

test("creates exactly one recorder destination and one analyser for tab capture", () => {
  const context = new MockAudioContext();
  const tabStream = createMockStream("tab");

  const graph = createOffscreenAudioGraph(asAudioContext(context), tabStream);

  assert.equal(context.recorderDestinations.length, 1);
  assert.equal(context.analysers.length, 1);
  assert.equal(context.sources.length, 1);

  assert.equal(graph.recorderDestination, context.recorderDestinations[0]);

  assert.equal(graph.analyser, context.analysers[0]);
  assert.equal(graph.tabSource, context.sources[0]);
});

test("configures the analyser with the offscreen FFT size", () => {
  const context = new MockAudioContext();

  createOffscreenAudioGraph(asAudioContext(context), createMockStream("tab"));

  assert.equal(context.analysers[0].fftSize, OFFSCREEN_ANALYSER_FFT_SIZE);

  assert.equal(context.analysers[0].fftSize, 1024);
});

test("routes tab audio to downmix node, analyser, and playback output", () => {
  const context = new MockAudioContext();

  createOffscreenAudioGraph(asAudioContext(context), createMockStream("tab"));

  // Tab source → downmixNode (mono recorder path), analyser (raw VAD), and destination (playback)
  assert.equal(context.sources[0].connections.length, 3);
  assert.equal(context.sources[0].connections[0], context.gainNodes[0]);
  assert.equal(context.sources[0].connections[1], context.analysers[0]);
  assert.equal(context.sources[0].connections[2], context.destination);

  // Downmix node → recorder destination with mono configuration
  assert.equal(context.gainNodes[0].connections.length, 1);
  assert.equal(context.gainNodes[0].connections[0], context.recorderDestinations[0]);
  assert.equal(context.gainNodes[0].channelCount, 1);
  assert.equal(context.gainNodes[0].channelCountMode, "explicit");
  assert.equal(context.gainNodes[0].channelInterpretation, "speakers");
});

test("routes microphone audio through downmix node and to analyser", () => {
  const context = new MockAudioContext();

  const graph = createOffscreenAudioGraph(asAudioContext(context), createMockStream("tab"));

  const microphoneSource = connectMicrophoneToOffscreenAudioGraph(
    asAudioContext(context),
    createMockStream("microphone"),
    graph,
  );

  assert.equal(microphoneSource, context.sources[1]);

  // Mic source → downmixNode (mono recorder path) and analyser (raw VAD)
  assert.equal(context.sources[1].connections.length, 2);
  assert.equal(context.sources[1].connections[0], context.gainNodes[0]);
  assert.equal(context.sources[1].connections[1], context.analysers[0]);
});

test("does not route microphone audio to local playback", () => {
  const context = new MockAudioContext();

  const graph = createOffscreenAudioGraph(asAudioContext(context), createMockStream("tab"));

  connectMicrophoneToOffscreenAudioGraph(
    asAudioContext(context),
    createMockStream("microphone"),
    graph,
  );

  assert.equal(
    context.sources[1].connections.includes(context.destination),
    false,
    "microphone playback would create local monitoring or feedback",
  );
});

test("keeps tab and microphone source nodes independent", () => {
  const context = new MockAudioContext();
  const tabStream = createMockStream("tab");
  const microphoneStream = createMockStream("microphone");

  const graph = createOffscreenAudioGraph(asAudioContext(context), tabStream);

  connectMicrophoneToOffscreenAudioGraph(asAudioContext(context), microphoneStream, graph);

  assert.notEqual(context.sources[0], context.sources[1]);
  assert.equal(context.sources[0].stream, tabStream);
  assert.equal(context.sources[1].stream, microphoneStream);

  assert.equal(context.sources[0].connections.length, 3);
  assert.equal(context.sources[1].connections.length, 2);
});

test("enables microphone processing and automatic gain control", () => {
  assert.deepEqual(MICROPHONE_AUDIO_CONSTRAINTS, {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });
});
