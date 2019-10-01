import * as _ from 'lodash';
import { DymoPlayer } from 'dymo-player';
import { DymoGenerator, ExpressionGenerator, SuperDymoStore, uris, ValueObserver } from 'dymo-core';
import { Transition, TransitionType } from './types';
import { TransitionObserver } from './transition-observer';

export const AVAILABLE_TRANSITIONS = _.values(TransitionType);

interface MixState {
  removedOldTrackBars: string[],
  newTrackBars: string[]
}

export interface TransitionOptions {
  trackUri: string,
  cueOffset?: number, //at what bar to start new track
  numBars?: number, //how many bars to add to mix
  duration?: number, //how many bars the transition should last
  position?: number //at what bar to add to mix, -1 for at end, undefined for asap
}

const TRANSITION_OFFSET = 1; //number of bars from current position an asap transition starts

export class MixGenerator {

  private mixDymoUri: string;
  private tracks: string[];
  private store: SuperDymoStore;
  private expressionGen: ExpressionGenerator;
  private transitionConstraints: string[][] = []; //ARRAYS OF CONSTRAINT URIS FOR NOW

  constructor(private generator: DymoGenerator, private player: DymoPlayer,
      private transitionObserverFunction: () => any) {
    this.store = generator.getStore();
    this.expressionGen = new ExpressionGenerator(this.store);
    this.init();
  }

  async init() {
    this.tracks = [];
    this.mixDymoUri = await this.generator.addDymo();
  }

  getMixDymo(): string {
    return this.mixDymoUri;
  }

  async startMixWithFadeIn(options: TransitionOptions): Promise<Transition> {
    const numBars = options.duration ? options.duration : 2;
    const newTrackBars = await this.registerTrackAndGetBars(options);
    const [duration, uris] = await this.applyFadeIn(newTrackBars.slice(0, numBars));
    return this.endTransition(newTrackBars, TransitionType.FadeIn, duration, uris);
  }

  async slam(options: TransitionOptions): Promise<Transition> {
    const state = await this.initTransition(options);
    await this.addControlTrigger(await this.store.addControl("test", uris.AUTO_CONTROL)); //trigger transition observer but no control
    return this.endTransition(state.newTrackBars, TransitionType.Slam, 0);
  }

  async beatRepeat(options: TransitionOptions, times = 3): Promise<Transition> {
    const state = await this.initTransition(options);
    //add reverb to last bar
    let lastBar = await this.findLastBar();
    let lastBeat = await this.store.findPartAt(lastBar, 3);
    await this.store.setParameter(lastBeat, uris.DELAY, 0.5);
    //add silence for first part of bar
    let lastBarDuration = await this.store.findFeatureValue(state.removedOldTrackBars[0], uris.DURATION_FEATURE);
    await this.addSilence(lastBarDuration/2);
    //beat repeat
    let firstBarBeats = await this.store.findParts(state.newTrackBars[0]);
    await this.addPartsToMix(_.fill(Array(times), firstBarBeats[0]));
    return this.endTransition(state.newTrackBars, TransitionType.BeatRepeat, 2); //duration just an estimate for now
  }

  async echoFreeze(options: TransitionOptions): Promise<Transition> {
    const numBarsBreak = options.duration ? options.duration : 2;
    const state = await this.initTransition(options);
    //delay out last bar
    let lastBar = await this.findLastBar();
    await this.store.setParameter(lastBar, uris.DELAY, 1);
    //add silence for n bars
    const lastBarDuration = await this.store.findFeatureValue(lastBar, uris.DURATION_FEATURE);
    const silenceDuration = lastBarDuration*numBarsBreak;
    await this.addSilence(silenceDuration);
    return this.endTransition(state.newTrackBars, TransitionType.EchoFreeze, lastBarDuration+silenceDuration);
  }

  async effects(options: TransitionOptions): Promise<Transition> {
    const numBars = options.duration ? options.duration : 2;
    const state = await this.initTransition(options);
    //add effects to a few bars
    const effectBars = state.removedOldTrackBars.slice(0, numBars);
    const duration = await this.getTotalDuration(effectBars);
    const effectsRamp = await this.addRampWithTrigger(duration);
    const reverb = await this.makeRampConstraint(effectsRamp, effectBars, 'Reverb(d) == r/3');
    await this.addPartsToMix(effectBars);
    return this.endTransition(state.newTrackBars, TransitionType.Effects, duration, [effectsRamp, reverb]);
  }

  async powerDown(options: TransitionOptions): Promise<Transition> {
    const numBars = options.duration ? options.duration : 2;
    const numBarsBreak = 0;
    const state = await this.initTransition(options);
    //add power down to a few bars
    const powerBars = state.removedOldTrackBars.slice(0, numBars);
    //avg duration with linear ramp power down
    const duration = 2 * (await this.getTotalDuration(powerBars));
    const powerRamp = await this.addRampWithTrigger(duration);
    const powerDown = await this.makeRampConstraint(powerRamp, powerBars, 'PlaybackRate(d) == 1-r');
    await this.addPartsToMix(powerBars);
    //add silence for n bars
    const silenceDuration = (duration/2/numBars)*numBarsBreak;
    await this.addSilence(silenceDuration);
    //add new track
    return this.endTransition(state.newTrackBars, TransitionType.PowerDown,
      duration + silenceDuration, [powerRamp, powerDown]);
  }

  async crossfade(options: TransitionOptions): Promise<Transition> {
    const numBars = options.duration ? options.duration : 3;
    const state = await this.initTransition(options);
    const newTrackTrans = state.newTrackBars.slice(0, numBars);
    const duration = await this.getTotalDuration(newTrackTrans);
    const oldTrackTrans = await this.getInitialBars(state.removedOldTrackBars, duration);
    let uris = await this.applyCrossfade(oldTrackTrans, newTrackTrans, duration);
    await this.addAligned(oldTrackTrans, newTrackTrans);
    return this.endTransition(state.newTrackBars.slice(numBars), TransitionType.Crossfade, duration, uris);
  }

  async beatmatchCrossfade(options: TransitionOptions): Promise<Transition> {
    const numBars = options.duration ? options.duration : 3;
    const state = await this.initTransition(options);
    const newTrackTrans = state.newTrackBars.slice(0, numBars);
    const oldTrackTrans = state.removedOldTrackBars.slice(0, numBars);
    const duration = (await this.getTotalDuration(oldTrackTrans.concat(newTrackTrans)))/2 - 0.5;//minus schedule ahead time for more tempo smoothness!
    //add constraints, controls, and triggers
    let uris = await this.applyCrossfade(oldTrackTrans, newTrackTrans, duration);
    //only beatmatch if same number of bars
    if (newTrackTrans.length == oldTrackTrans.length) {
      uris = uris.concat(await this.applyBeatmatch(oldTrackTrans, newTrackTrans, uris[0]));
    }
    //add transition part
    await this.addZipped(oldTrackTrans, newTrackTrans);
    return this.endTransition(state.newTrackBars.slice(numBars), TransitionType.Beatmatch, duration, uris);
  }

  private async addPartsToMix(parts: string[]) {
    return Promise.all(parts.map(p => this.store.addPart(this.mixDymoUri, p)));
  }

  private async addSilence(duration: number) {
    if (duration > 0) {
      let silence = await this.generator.addDymo();
      await this.store.setFeature(silence, uris.DURATION_FEATURE, duration);
      await this.addPartsToMix([silence]);
    }
  }

  private async addAligned(bars1: string[], bars2: string[]): Promise<string> {
    let bars1Seq = await this.generator.addDymo(null, null, uris.SEQUENCE);
    await Promise.all(bars1.map(p => this.store.addPart(bars1Seq, p)));
    let bars2Seq = await this.generator.addDymo(null, null, uris.SEQUENCE);
    await Promise.all(bars2.map(p => this.store.addPart(bars2Seq, p)));
    return await this.generator.addConjunction(this.mixDymoUri, [bars1Seq, bars2Seq]);
  }

  private async addZipped(bars1: string[], bars2: string[]) {
    Promise.all(_.zip(bars1, bars2).map(bp =>
      this.generator.addConjunction(this.mixDymoUri, bp)));
  }

  private async applyBeatmatch(oldTrackBars: string[], newTrackBars: string[], rampUri: string) {
    //create tempo transition
    let tempoParam = await this.generator.addCustomParameter(uris.CONTEXT_URI+"Tempo");
    let newTempo = await this.getTempoFromBars(newTrackBars);
    let oldTempo = await this.getTempoFromBars(oldTrackBars);
    let tempoTransition = await this.makeSetsConstraint(
      [['t',[tempoParam]], ['r',[rampUri]]], 't == r*'+newTempo+'+(1-r)*'+oldTempo);
    //create beatmatch
    let beats = _.flatten(await Promise.all(oldTrackBars.concat(newTrackBars).map(p => this.store.findParts(p))));
    let beatMatch = await this.makeSetsConstraint(
      [['d',beats], ['t',[tempoParam]]], 'TimeStretchRatio(d) == t/60*DurationFeature(d)');
    console.log("beatmatched between tempos", oldTempo, newTempo);
    return [tempoTransition, beatMatch];
  }

  private async applyFadeIn(newTrackBarsParts: string[]): Promise<[number, string[]]> {
    let fadeDuration = await this.getTotalDuration(newTrackBarsParts);
    let fadeRamp = await this.addRampWithTrigger(fadeDuration);
    let fadeIn = await this.makeRampConstraint(fadeRamp, newTrackBarsParts, 'Amplitude(d) == r');
    console.log("fading in for", newTrackBarsParts.length, "bars ("+fadeDuration+" seconds)")
    return [fadeDuration, [fadeRamp, fadeIn]]
  }

  private async applyCrossfade(oldTrackParts: string[], newTrackParts: string[], duration: number): Promise<string[]> {
    let fadeRamp = await this.addRampWithTrigger(duration);
    let fadeIn = await this.makeRampConstraint(fadeRamp, newTrackParts, 'Amplitude(d) == r');
    let fadeOut = await this.makeRampConstraint(fadeRamp, oldTrackParts, 'Amplitude(d) == 1-r');
    console.log("crossfading for", newTrackParts.length, "bars ("+duration+" seconds)");
    return [fadeRamp, fadeIn, fadeOut];
  }

  //TODO dymo-core throws the occasional error due to list editing concurrency problem
  private async addRandomBeatToLoop(trackUri: string, loopDuration = 2): Promise<any> {
    let currentBeats = await this.store.findParts(this.mixDymoUri);
    //find a random beat in the track
    let bars = await this.registerTrackAndGetBars({trackUri: trackUri});
    let randomBar = bars[_.random(bars.length)];
    let randomBeat = (await this.store.findParts(randomBar))[_.random(4)];
    if (currentBeats.length == 0) {
      //add silence at beginning and end of loop to ensure constant length :/
      let silenceUri = await this.generator.addDymo(this.mixDymoUri);
      await this.store.setParameter(silenceUri, uris.ONSET, 0);
      silenceUri = await this.generator.addDymo(this.mixDymoUri);
      await this.store.setParameter(silenceUri, uris.ONSET, loopDuration);
      currentBeats = await this.store.findParts(this.mixDymoUri);
    }
    //set a random onset and add the beat to the loop at correct position
    let currentOnsets = await Promise.all(currentBeats.map(b => this.store.findParameterValue(b, uris.ONSET)));
    let randomOnset = _.random(loopDuration, true);
    await this.store.setParameter(randomBeat, uris.ONSET, randomOnset);
    let beatPosition = currentOnsets.filter(o => o < randomOnset).length;
    return this.store.insertPartAt(this.mixDymoUri, randomBeat, beatPosition);
  }

  async transitionImmediatelyToRandomBars(trackUri: string, numBars = 2): Promise<any> {
    let bars = await this.registerTrackAndGetBars({trackUri: trackUri});
    let randomBar = _.random(bars.length-numBars);
    return Promise.all(bars.slice(randomBar, randomBar+numBars).map(p =>
      this.store.addPart(this.mixDymoUri, p)));
  }

  /**removes old track until current position + offset, registers new track and gets bars*/
  private async initTransition(options: TransitionOptions): Promise<MixState> {
    const newTrackBars = await this.registerTrackAndGetBars(options);
    const length = (await this.store.findParts(this.mixDymoUri)).length;
    let position: number;
    if (!options.position) {
      const currentPos = await this.player.getPosition(this.mixDymoUri);
      position = currentPos + TRANSITION_OFFSET;
    } else if (options.position < 0) {
      position = length - options.duration;
    } else {
      position = options.position;
    }
    const oldTrackBars = position < length ?
      await this.store.removeParts(this.mixDymoUri, position) : [];
    return {removedOldTrackBars: oldTrackBars, newTrackBars: newTrackBars};
  }

  /**adds new track bars, loads constraints and controls, and returns transition object*/
  private async endTransition(newTrackBars: string[], type: TransitionType, duration: number, transitionUris?: string[]): Promise<Transition> {
    if (transitionUris) {
      const loaded = await this.player.getDymoManager().loadFromStore(...transitionUris);
      //TODO NOW ADD CONSTRAINT TRIGGERS (ACTUALLY)
      await this.addConstraintTriggers(loaded.constraintUris);
      this.transitionConstraints.push(loaded.constraintUris);
    }
    await this.addPartsToMix(newTrackBars);
    return this.getTransitionObject(type, duration);
  }

  private async registerTrackAndGetBars(options: TransitionOptions): Promise<string[]> {
    this.tracks.push(options.trackUri);
    let bars = await this.store.findParts(options.trackUri);
    const offset = options.cueOffset ? options.cueOffset : 0;
    const numBars = options.numBars ? offset+options.numBars : undefined;
    return bars.slice(offset, numBars);
  }

  private async addRampWithTrigger(duration: number) {
    const rampUri = await this.generator.addRampControl(0, duration, 100);
    await this.addControlTrigger(rampUri);
    return rampUri;
  }

  /** adds a trigger to init the the transition, calls an optional function when
    triggered */
  private async addControlTrigger(controlUri: string) {
    const triggerParamUri = await this.store
      .setControlParam(controlUri, uris.AUTO_CONTROL_TRIGGER, 0);
    new TransitionObserver(this.store, triggerParamUri, this.transitionObserverFunction);
    await this.generator.addEvent(this.mixDymoUri, triggerParamUri, 1);
  }

  private async addConstraintTriggers(newUris: string[]) {
    if (this.transitionConstraints.length > 1) {
      const previousConstraints = _.last(this.transitionConstraints);
      /*TODO ADD EVENT TO DEACTIVATE PREVIOUS CONSTRAINTS AND ACTIVATE NEW ONES
      this.store.deactivateConstraints(previousConstraints);*/
    }
  }

  private async makeCrossfade(rampUri: string, oldTrackUris: string[], newTrackUris: string[]): Promise<string[]> {
    var fadeOut = await this.makeRampConstraint(rampUri, oldTrackUris, 'Amplitude(d) == 1-r');
    var fadeIn = await this.makeRampConstraint(rampUri, newTrackUris, 'Amplitude(d) == r');
    /*var fadeOut2 = await this.makeRampConstraint(rampUri, oldTrackUris, 'DurationRatio(d) == 1/(1-r)');
    var fadeIn2 = await this.makeRampConstraint(rampUri, newTrackUris, 'DurationRatio(d) == 1/r');*/
    return [fadeOut, fadeIn].filter(c => c); //remove undefined
  }

  private makeRampConstraint(rampUri: string, dymoUris: string[], expression: string): Promise<string> {
    if (dymoUris.length > 0) {
      return this.makeSetsConstraint([['d',dymoUris], ['r',[rampUri]]], expression);
    }
  }

  private makeSetsConstraint(sets: [string,string[]][], expression: string): Promise<string> {
    let vars = sets.map(s => '∀ '+s[0]+' in '+JSON.stringify(s[1])+' => ').join('');
    return this.expressionGen.addConstraint(this.mixDymoUri, vars+expression, true);
  }

  private async getTempoFromBars(barUris: string[]): Promise<number> {
    let avgDuration = _.mean(await this.getFeature(barUris, uris.DURATION_FEATURE));
    return 60/(avgDuration/4);
  }

  //returns an initial segment of bars with at most the given duration
  private async getInitialBars(bars: string[], duration: number): Promise<string[]> {
    let currentDuration = 0;
    return _.takeWhile(bars, async (b,i) => {
      currentDuration += await this.store.findFeatureValue(b, uris.DURATION_FEATURE);
      return currentDuration < duration;
    });
  }

  /**returns the last bars*/
  private async findLastBar() {
    //return (await this.store.findParts(this.mixDymoUri)).slice(-n);
    return _.last(await this.store.findParts(this.mixDymoUri));
  }

  private async getTotalDuration(dymoUris: string[]): Promise<number> {
    return _.sum(await this.getFeature(dymoUris, uris.DURATION_FEATURE));
  }

  private async getFeature(dymoUris: string[], featureUri: string): Promise<number[]> {
    return Promise.all(dymoUris.map(d => this.store.findFeatureValue(d, featureUri)));
  }

  private getTransitionObject(type: TransitionType, duration: number): Transition {
    return {
      date: new Date(Date.now()),
      user: null,
      rating: null,
      names: null,
      features: null,
      decision: null,
      type: type,
      parameters: null,
      duration: duration
    }
  }

}