import {
  OneShotExtractionClient,
  OneShotExtractionRequest as Request,
  OneShotExtractionResponse as Response,
  OneShotExtractionScheme
} from 'piper-js/one-shot';
//import { FeatureList } from 'piper-js/core';
import { toSeconds } from 'piper-js/time';
import createQmWorker from '@extractors/qm';
import { FeatureService, Beat, Feature } from './types';
import { AudioBank } from 'schedulo';

// this spawns a web worker, which we only want to do once
// so we instantiate
const qmWorker = createQmWorker();

export interface QmExtractor {
  key: string,
  outputId: string
}

interface AudioData {
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
}

function bufferToAudioData(buffer: AudioBuffer): AudioData {
  const nChannels = buffer.numberOfChannels;
  const channels = new Array<Float32Array>(nChannels);
  for (let i = 0; i < nChannels; ++i) {
    channels[i] = buffer.getChannelData(i);
  }
  return {
    channels,
    sampleRate: buffer.sampleRate,
    duration: buffer.duration
  };
}

export class FeatureExtractor implements FeatureService {
  private client: OneShotExtractionClient;

  constructor(private audioBank: AudioBank) {
    this.client = new OneShotExtractionClient(
      qmWorker,
      OneShotExtractionScheme.REMOTE
    );
  }

  extract(request: Request): Promise<Response> {
    return this.client.collect(request);
  }

  async getBeats(audioUri: string): Promise<Beat[]> {
    const beats = await this.getFeature(audioUri,
      'qm-vamp-plugins:qm-barbeattracker', 'beats');
    return beats.map(feature => ({
      time: {value: toSeconds(feature.timestamp)},
      label: {value: feature.label}
    }));
  }

  async getKeys(audioUri: string): Promise<Feature[]> {
    return this.getFrameBasedFeature(audioUri,
      'qm-vamp-plugins:qm-keydetector', 'tonic');
  }

  async getLoudnesses(audioUri: string): Promise<Feature[]> {
    return this.getFrameBasedFeature(audioUri,
      'vamp-libextract:loudness', 'loudness');
  }

  private async getFrameBasedFeature(audioUri: string, key: string, outputId: string): Promise<Feature[]> {
    const feature = await this.getFeature(audioUri, key, outputId);
    return feature.map(feature => ({
      time: {value: toSeconds(feature.timestamp)},
      value: feature.featureValues[0]
    }));
  }

  private async getFeature(audioUri: string, key: string, outputId: string) {
    const buffer = await this.audioBank.getAudioBuffer(audioUri);
    return this.extractQmFeature(buffer, {
      key: key,
      outputId: outputId
    });
  }

  private extractQmFeature(buffer: AudioBuffer, feature: QmExtractor): Promise<any> {
    const {channels, sampleRate} = bufferToAudioData(buffer);
    return this.extract({
      audioData: channels,
      audioFormat: {
        sampleRate,
        channelCount: channels.length
      },
      key: feature.key,
      outputId: feature.outputId
    }).then(response => response.features.collected);
  }

}