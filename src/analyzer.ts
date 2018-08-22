import * as _ from 'lodash';
import * as math from 'mathjs';
import { SuperDymoStore, uris } from 'dymo-core';

export interface Pair<T> {
  first: T,
  second: T
}

/* {[0]: 0, [7,5]: 1, [2,10]: 2, [9,3]: 3, [4,8]: 4, [11,1]: 5, [6]: 6} */
const TONAL_DISTANCES = {
  0: 0,
  1: 5,
  2: 2,
  3: 3,
  4: 4,
  5: 1,
  6: 6,
  7: 1,
  8: 4,
  9: 3,
  10: 2,
  11: 5
}

export class Analyzer {

  private beatsCache: Map<string, number[]> = new Map<string, number[]>();
  private keysCache: Map<string, number> = new Map<string, number>();
  private tempoCache: Map<string, number> = new Map<string, number>();

  constructor(private store: SuperDymoStore) {}

  async getAllFeatures(song1: string, song2: string): Promise<number[]> {
    return [
      await this.getTempo(song1),
      await this.getTempo(song2),
      await this.getTempoRatio(song1, song2),
      await this.getTempoRatio(song2, song1),
      await this.getTempoMultiple(song1, song2),
      await this.getTempoMultiple(song2, song1),
      await this.getRegularity(song1),
      await this.getRegularity(song2),
      await this.getKey(song1),
      await this.getKey(song2),
      await this.getKeyDistance(song1, song2)
    ]
  }

  getMainSongBody(songUri: string): Pair<number> {
    return {first:0,second:1};
  }

  async getKeyDistance(song1Uri: string, song2Uri: string): Promise<number> {
    let dist = Math.abs(await this.getKey(song1Uri) - await this.getKey(song2Uri));
    return TONAL_DISTANCES[dist];
  }

  async getKey(songUri: string): Promise<number> {
    if (!this.keysCache.has(songUri)) {
      let key = await this.store.findFeatureValue(songUri, uris.CONTEXT_URI+"key");
      this.keysCache.set(songUri, key.length ? key[0] : key);
    }
    return this.keysCache.get(songUri);
  }

  async getTempo(songUri: string): Promise<number> {
    if (!this.tempoCache.has(songUri)) {
      const durations = await this.getBeatDurations(songUri);
      this.tempoCache.set(songUri, 60/math.mean(durations));
    }
    return this.tempoCache.get(songUri);
  }

  async getTempoMultiple(song1Uri: string, song2Uri: string): Promise<number> {
    const tempoRatio = await this.getTempoRatio(song1Uri, song2Uri);
    return tempoRatio % 1;
  }

  async getTempoRatio(song1Uri: string, song2Uri: string): Promise<number> {
    const tempoRatio = await this.getTempo(song1Uri) / await this.getTempo(song2Uri);
    //console.log("tempo ratio", tempoRatio);
    return tempoRatio;
  }

  async hasRegularBeats(songUri: string): Promise<boolean> {
    return await this.getRegularity(songUri) < .1;
  }

  async getRegularity(songUri: string): Promise<number> {
    const durations = await this.getBeatDurations(songUri);
    return math.std(durations);
  }

  async tempoSimilar(song1Uri: string, song2Uri: string): Promise<boolean> {
    const ratio = await this.getTempoRatio(song1Uri, song2Uri);
    return this.isSimilar(1, ratio);
  }

  private isSimilar(n1: number, n2: number): boolean {
    //TODO MAKE POWER-BASED DISTANCE
    return Math.abs(n1 - n2) < .1;
  }

  private async getBeatDurations(songUri: string): Promise<number[]> {
    if (!this.beatsCache.has(songUri)) {
      const bars = await this.store.findParts(songUri);
      const beats = _.flatten(await Promise.all(bars.map(p => this.store.findParts(p))));
      const durations = await Promise.all<number>(beats.map(b => this.findDuration(b)));
      this.beatsCache.set(songUri, durations);
    }
    return this.beatsCache.get(songUri);
  }

  private async findDuration(dymo: string): Promise<number> {
    return <number>(await this.store.findFeatureValue(dymo, uris.DURATION_FEATURE));
  }

}