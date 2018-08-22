export interface Value<T> {
  value: T;
}

export interface Beat {
  time: Value<number>;
  label: Value<string>;
}

export interface Key {
  time: Value<number>;
  value: number;
}

export interface FeatureExtractor {
  extractBeats(buffer: AudioBuffer): Promise<Beat[]>;
  extractKey(buffer: AudioBuffer): Promise<Key[]>;
}

export enum DecisionType {
  Default,
  Random,
  DecisionTree
}

export enum TransitionType {
  FadeIn,
  Slam,
  BeatRepeat,
  Crossfade,
  Beatmatch,
  BeatmatchMultiple,
  EchoFreeze,
  PowerDown,
  Effects
}

export interface Transition {
  type: TransitionType,
  duration: number,
  date: Date,
  user: string,
  rating: number,
  names: string[],
  features: number[],
  decision: DecisionType,
  parameters: number[]
}