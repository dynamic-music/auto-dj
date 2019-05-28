import * as _ from 'lodash';
import * as math from 'mathjs';
import { SuperDymoStore, uris } from 'dymo-core';

export enum Features {
  TempoA,
  TempoB,
  TempoRatio,
  TempoMultiplicity,
  RegularityA,
  RegularityB,
  RegularityProduct,
  KeyA,
  KeyB,
  KeyDistance
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

  async getAllFeatures(track1: string, track2: string): Promise<number[]> {
    return [
      await this.getTempo(track1),
      await this.getTempo(track2),
      await this.getTempoRatio(track1, track2),
      await this.getTempoMultiple(track1, track2),
      await this.getRegularity(track1),
      await this.getRegularity(track2),
      await this.getRegularityProduct(track1, track2),
      await this.getKey(track1),
      await this.getKey(track2),
      await this.getKeyDistance(track1, track2)
    ]
    /*USED FOR EARLY EXPERIMENTS
      return [
      await this.getTempo(track1),
      await this.getTempo(track2),
      await this.getTempoRatio(track1, track2),
      await this.getTempoRatio(track2, track1),
      await this.getTempoMultiple(track1, track2),
      await this.getTempoMultiple(track2, track1),
      await this.getRegularity(track1),
      await this.getRegularity(track2), //TODO ADD REGULARITY PRODUCT OR RATIO
      await this.getKey(track1),
      await this.getKey(track2),
      await this.getKeyDistance(track1, track2)
    ]*/
  }

  async findCuePoint(trackUri: string): Promise<number> {
    const loudnesses = await this.getBarLoudnesses(trackUri);
    const indexOfLastIncrease = loudnesses.findIndex((l,i) => loudnesses[i+1] < l);
    const initialEighth = loudnesses.slice(0, loudnesses.length/8);
    const indexOfInitialMax = loudnesses.indexOf(_.max(initialEighth));
    const localMaxSquared = this.findLocalMaxes(this.findLocalMaxes(loudnesses));
    const indexOfLocalMaxSquared = loudnesses.indexOf(localMaxSquared[0]);
    console.log(indexOfLastIncrease, indexOfInitialMax, indexOfLocalMaxSquared);
    return indexOfLocalMaxSquared;
  }

  private findLocalMaxes(values: number[]): number[] {
    return values.filter((v, i) => v > values[i-1] && v > values[i+1]);
  }

  private async getKeyDistance(track1Uri: string, track2Uri: string): Promise<number> {
    let dist = Math.abs(await this.getKey(track1Uri) - await this.getKey(track2Uri));
    return TONAL_DISTANCES[dist];
  }

  private async getKey(trackUri: string): Promise<number> {
    if (!this.keysCache.has(trackUri)) {
      const key = await this.store.findFeatureValue(trackUri, uris.CONTEXT_URI+"key");
      if (key) {
        this.keysCache.set(trackUri, key.length ? key[0] : key);
      }
    }
    return this.keysCache.get(trackUri);
  }

  private async getTempo(trackUri: string): Promise<number> {
    if (!this.tempoCache.has(trackUri)) {
      const durations = await this.getBeatDurations(trackUri);
      if (durations && durations.length) {
        this.tempoCache.set(trackUri, 60/math.mean(durations));
      }
    }
    return this.tempoCache.get(trackUri);
  }

  //a symmetrical ratio < 1
  private async getTempoMultiple(track1Uri: string, track2Uri: string): Promise<number> {
    let tempoRatio = await this.getTempo(track1Uri) / await this.getTempo(track2Uri);
    //make it larger than 1
    tempoRatio = tempoRatio < 1 ? 1 / tempoRatio : tempoRatio;
    let tempoMultiple = tempoRatio % 1;
    //back to [0,1]
    return tempoMultiple > 1 ? 1 / tempoMultiple : tempoMultiple;
  }

  //a symmetrical ratio < 1
  private async getTempoRatio(track1Uri: string, track2Uri: string): Promise<number> {
    const tempoRatio = await this.getTempo(track1Uri) / await this.getTempo(track2Uri);
    return tempoRatio > 1 ? 1 / tempoRatio : tempoRatio;
  }

  private async hasRegularBeats(trackUri: string): Promise<boolean> {
    return await this.getRegularity(trackUri) < .1;
  }

  private async getRegularityProduct(track1Uri: string, track2Uri: string): Promise<number> {
    return (await this.getRegularity(track1Uri)) * (await this.getRegularity(track2Uri));
  }

  private async getRegularity(trackUri: string): Promise<number> {
    const durations = await this.getBeatDurations(trackUri);
    if (durations && durations.length) {
      return math.std(durations);
    }
  }

  private async tempoSimilar(track1Uri: string, track2Uri: string): Promise<boolean> {
    const ratio = await this.getTempoRatio(track1Uri, track2Uri);
    return this.isSimilar(1, ratio);
  }

  private isSimilar(n1: number, n2: number): boolean {
    //TODO MAKE POWER-BASED DISTANCE
    return Math.abs(n1 - n2) < .1;
  }

  private async getBarLoudnesses(trackUri: string): Promise<number[]> {
    const bars = await this.store.findParts(trackUri);
    return await this.findFeatureSeries(bars, uris.CONTEXT_URI+"loudness");
  }

  private async getBeatDurations(trackUri: string): Promise<number[]> {
    if (!this.beatsCache.has(trackUri)) {
      const bars = await this.store.findParts(trackUri);
      const beats = _.flatten(await Promise.all(bars.map(p => this.store.findParts(p))));
      const durations = await this.findFeatureSeries(beats, uris.DURATION_FEATURE);
      this.beatsCache.set(trackUri, durations);
    }
    return this.beatsCache.get(trackUri);
  }

  private async findFeatureSeries(dymos: string[], featureUri: string): Promise<number[]> {
    return await Promise.all<number>(dymos.map(b =>
      this.findFeature(b, featureUri)));
  }

  private async findFeature(dymo: string, featureUri: string): Promise<number> {
    return <number>(await this.store.findFeatureValue(dymo, featureUri));
  }

}