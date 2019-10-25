import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import * as _ from 'lodash';
import { DymoPlayer } from 'dymo-player';
import { DymoGenerator, DymoTemplates, SuperDymoStore, SUMMARY } from 'dymo-core';
import { MixGenerator, AVAILABLE_TRANSITIONS, TransitionOptions } from './mix-generator';
import { FeatureService, Transition, TransitionType, DecisionType, Feature } from './types';
import { Analyzer } from './analyzer';
import { FeatureExtractor } from './feature-extractor';
import { DecisionTree, JsonTree } from './decision-tree';
import { STANDARD_TREE } from './standard-tree';

export interface AutoDjOptions {
  featureService?: FeatureService,
  decisionType?: DecisionType,
  decisionTree?: JsonTree<TransitionType>,
  defaultTransitionType?:  TransitionType,
  scheduleAheadTime?: number,
  loadAheadTime?: number
}

export class AutoDj {

  private ready: Promise<any>;
  private store: SuperDymoStore;
  private analyzer: Analyzer;
  private dymoGen: DymoGenerator;
  private mixGen: MixGenerator;
  private player: DymoPlayer;
  private featureService: FeatureService;
  private decisionType: DecisionType;
  private defaultTransitionType: TransitionType;
  private previousPlayingDymos = [];
  private beatsPlayed = 0;
  private previousTracks = [];
  private decisionTree: DecisionTree<TransitionType>;
  private scheduledTransitions: Transition[] = [];
  private transitionsObservable: Subject<Transition> = new Subject();
  private transitionsObserved = 0;

  constructor(options: AutoDjOptions) {
    this.ready = this.init(options);
  }

  private async init(options: AutoDjOptions) {
    this.featureService = options.featureService;
    this.decisionType = options.decisionType;
    this.defaultTransitionType =
      options.defaultTransitionType || TransitionType.Beatmatch;
    this.decisionTree = new DecisionTree(options.decisionTree || STANDARD_TREE);
    this.player = new DymoPlayer({
      useWorkers: true,
      scheduleAheadTime: options.scheduleAheadTime || 2,
      loadAheadTime: options.loadAheadTime || 4,
      useTone: true,
      fadeLength: 0.03
    });
    await this.player.init('https://raw.githubusercontent.com/dynamic-music/dymo-core/master/ontologies/')//'https://dynamic-music.github.io/dymo-core/ontologies/')
    this.store = this.player.getDymoManager().getStore();
    this.dymoGen = new DymoGenerator(false, this.store);
    this.mixGen = new MixGenerator(this.dymoGen, this.player, this.updateTransitionObservable.bind(this));
    this.analyzer = new Analyzer(this.store);
    if (!this.featureService) {
      this.featureService = new FeatureExtractor(await this.player.getAudioBank());
    }
  }

  isReady(): Promise<void> {
    return this.ready;
  }
  
  setFeatureService(service: FeatureService) {
    this.featureService = service;
  }

  getBeatObservable(): Observable<number> {
    return (this.player.getPlayingDymoUris())
      .pipe(filter(playingDymos => {
        //simple way to check wether there are new dymos playing, thus a new beat
        const nChanged = _.difference(playingDymos, this.previousPlayingDymos).length;
        this.previousPlayingDymos = playingDymos;
        return nChanged > 0;
      }))
      .pipe(map(() => this.beatsPlayed++));
  }

  getTransitionObservable(): Observable<Transition> {
    return this.transitionsObservable.asObservable();
  }

  private updateTransitionObservable() {
    this.transitionsObservable.next(this.scheduledTransitions[this.transitionsObserved]);
    this.transitionsObserved++;
  }

  async transitionToTrack(audioUri: string): Promise<Transition> {
    await this.ready;
    await this.resetIfStopped();
    //make sure audio is loaded before attempting transition
    await this.player.getAudioBank().preloadBuffers([audioUri]);
    const newTrack = await this.extractFeaturesAndAddDymo(audioUri);
    return this.internalTransition(audioUri, {trackUri: newTrack});
  }

  async playDjSet(audioUris: string[], numBars?: number, autoCue?: boolean, duration = 4) {
    await this.ready;
    this.mapSeries(audioUris,
      async (a,i) => {
        console.log("buffering", a)
        await this.player.getAudioBank().preloadBuffers([a]);
        console.log("preloaded")
        await this.addTrackToMix(a, -1, numBars, autoCue, duration);
        console.log("added, length now", (await this.store.findParts(this.mixGen.getMixDymo())).length)
      });
  }
  
  async stop() {
    const uri = this.mixGen.getMixDymo();
    this.reset();
    await this.player.stopUri(uri);
  }

  private async addTrackToMix(audioUri: string, position: number, numBars?: number, autoCue?: boolean, duration?: number) {
    const newTrack = await this.extractFeaturesAndAddDymo(audioUri);
    console.log("extracted")
    const options: TransitionOptions = {trackUri: newTrack};
    if (autoCue) {
      options.cueOffset = await this.analyzer.findCuePoint(newTrack);
    }
    options.numBars = numBars;
    options.duration = duration;
    options.position = position;
    await this.internalTransition(audioUri, options);
  }

  private async internalTransition(audioUri: string, options?: TransitionOptions): Promise<Transition> {
    const features = await this.getTransitionFeatures(options.trackUri);
    const transition = await this.transitionBasedOnDecisionType(options, features);
    transition.features = features;
    this.previousTracks.push(options.trackUri);
    this.scheduledTransitions.push(transition);
    transition.names = [audioUri];
    return transition;
  }

  private resetIfStopped() {
    if (this.previousTracks.length > 0 && !this.player.isPlaying(this.mixGen.getMixDymo())) {
      return this.reset();
    }
  }
  
  private reset() {
    this.previousTracks = [];
    return this.mixGen.init();
  }

  private async getTransitionFeatures(newTrack: string): Promise<number[]> {
    //await this.analyzer.findCuePoint(newTrack);
    if (this.previousTracks.length > 0) {
      const oldTrack = _.last(this.previousTracks);
      return this.analyzer.getAllFeatures(oldTrack, newTrack);
    }
  }

  private async extractFeaturesAndAddDymo(audioUri: string): Promise<string> {
    let beats = await this.featureService.getBeats(audioUri);
    //drop initial and final incomplete bars
    beats = _.dropWhile(beats, b => b.label.value !== "1");
    beats = _.dropRightWhile(beats, b => b.label.value !== "4");
    const segments = beats.map(b => ({time: b.time.value, value: b.label.value}));
    const newTrack = await DymoTemplates.createAnnotatedBarAndBeatDymo2(this.dymoGen, audioUri, segments);
    const keys = await this.featureService.getKeys(audioUri);
    if (keys) {
      await this.addFeature("key", keys, newTrack, SUMMARY.MODE);
    }
    const loudnesses = await this.featureService.getLoudnesses(audioUri);
    if (loudnesses) {
      await this.addFeature("loudness", loudnesses, newTrack, SUMMARY.MEAN);
    }
    await this.player.getDymoManager().loadFromStore(newTrack);
    return newTrack;
  }

  private async addFeature(name: string, values: Feature[], dymoUri: string, summaryMode: string) {
    if (values) {
      this.dymoGen.setSummarizingMode(summaryMode);
      const data = values.map(f => ({time: f.time.value, value: f.value}));
      await this.dymoGen.addFeature(name, data, dymoUri);
    }
  }

  private async transitionBasedOnDecisionType(options: TransitionOptions, features: number[]): Promise<Transition> {
    let transition: Transition;
    if (this.previousTracks.length == 0) {
      transition = await this.mixGen.startMixWithFadeIn(options);
    } else if (this.decisionType == DecisionType.Default) {
      transition = await this.mixGen[this.defaultTransitionType](options);
    } else if (this.decisionType == DecisionType.Random) {
      transition = await this.randomTransition(options);
    } else if (this.decisionType == DecisionType.FiftyFifty) {
      //fiftyfifty random and decision tree
      transition = Math.random() > 0.5 ? await this.randomTransition(options)
        : await this.decisionTreeTransition(options, features);
    } else {
      transition = await this.decisionTreeTransition(options, features);
    }
    if (this.decisionType != DecisionType.FiftyFifty) {
      transition.decision = this.decisionType;
    }
    this.player.playUri(this.mixGen.getMixDymo());
    return transition;
  }

  private async randomTransition(options: TransitionOptions): Promise<Transition> {
    const randomTransition = _.sample(AVAILABLE_TRANSITIONS);
    const transition = await this.mixGen[randomTransition](options);
    transition.decision = DecisionType.Random;
    return transition;
  }

  private async decisionTreeTransition(options: TransitionOptions, features: number[]): Promise<Transition> {
    console.log("asking tree")
    const transitionType = this.decisionTree.classify(features);
    const transition = await this.mixGen[transitionType](options);
    transition.decision = DecisionType.DecisionTree;
    console.log(transitionType)
    return transition;
  }

  private async mapSeries<T,S>(array: T[], func: (arg: T, i: number) => Promise<S>): Promise<S[]> {
    let result = [];
    for (let i = 0; i < array.length; i++) {
      result.push(await func(array[i], i));
    }
    return result;
  }

}