import { Observable } from 'rxjs/Observable';
import * as _ from 'lodash';
import { DymoPlayer } from 'dymo-player';
import { DymoGenerator, DymoTemplates, SuperDymoStore, globals } from 'dymo-core';
import { MixGenerator, AVAILABLE_TRANSITIONS } from './mix-generator';
import { FeatureService, Transition, TransitionType, DecisionType, Feature } from './types';
import { Analyzer } from './analyzer';
import { FeatureExtractor } from './feature-extractor';
import { DecisionTree, JsonTree } from './decision-tree';
import { STANDARD_TREE } from './standard-tree';

export class AutoDj {

  private ready: Promise<any>;
  private store: SuperDymoStore;
  private analyzer: Analyzer;
  private dymoGen: DymoGenerator;
  private mixGen: MixGenerator;
  private player: DymoPlayer;
  private previousPlayingDymos = [];
  private beatsPlayed = 0;
  private previousSongs = [];
  private decisionTree: DecisionTree<TransitionType>;

  constructor(private featureService?: FeatureService,
      private decisionType?: DecisionType,
      decisionTree: JsonTree<TransitionType> = STANDARD_TREE,
      private defaultTransitionType = TransitionType.Beatmatch) {
    this.ready = this.init(decisionTree);
  }

  private async init(decisionTree: JsonTree<TransitionType>) {
    this.decisionTree = new DecisionTree<TransitionType>(decisionTree);
    this.player = new DymoPlayer({
      useWorkers: true,
      scheduleAheadTime: 0.5,
      loadAheadTime: 2
    });
    await this.player.init('https://raw.githubusercontent.com/dynamic-music/dymo-core/master/ontologies/')//'https://dynamic-music.github.io/dymo-core/ontologies/')
    this.store = this.player.getDymoManager().getStore();
    this.dymoGen = new DymoGenerator(false, this.store);
    this.mixGen = new MixGenerator(this.dymoGen, this.player);
    this.analyzer = new Analyzer(this.store);
    if (!this.featureService) {
      this.featureService = new FeatureExtractor(await this.player.getAudioBank());
    }
  }

  isReady(): Promise<void> {
    return this.ready;
  }

  getBeatObservable(): Observable<number> {
    return (this.player.getPlayingDymoUris())
      .filter(playingDymos => {
        //simple way to check wether there are new dymos playing, thus a new beat
        const nChanged = _.difference(playingDymos, this.previousPlayingDymos).length;
        this.previousPlayingDymos = playingDymos;
        return nChanged > 0;
      })
      .map(() => this.beatsPlayed++);
  }

  async transitionToSong(audioUri: string): Promise<Transition> {
    await this.resetIfStopped();
    const newSong = await this.extractFeaturesAndAddDymo(audioUri);
    const features = await this.getTransitionFeatures(newSong);
    const transition = await this.transitionBasedOnDecisionType(newSong, features);
    transition.features = features;
    this.previousSongs.push(newSong);
    return transition;
  }

  private async resetIfStopped() {
    if (this.previousSongs.length > 0 && !this.player.isPlaying(this.mixGen.getMixDymo())) {
      this.previousSongs = [];
      await this.mixGen.init();
    }
  }

  private async getTransitionFeatures(newSong: string): Promise<number[]> {
    await this.analyzer.findCuePoint(newSong);
    if (this.previousSongs.length > 0) {
      const oldSong = _.last(this.previousSongs);
      return this.analyzer.getAllFeatures(oldSong, newSong);
    }
  }

  private async extractFeaturesAndAddDymo(audioUri: string): Promise<string> {
    let beats = await this.featureService.getBeats(audioUri);
    //drop initial and final incomplete bars
    beats = _.dropWhile(beats, b => b.label.value !== "1");
    beats = _.dropRightWhile(beats, b => b.label.value !== "4");
    const newSong = await DymoTemplates.createAnnotatedBarAndBeatDymo2(this.dymoGen, audioUri, beats);
    const keys = await this.featureService.getKeys(audioUri);
    this.addFeature("key", keys, newSong, globals.SUMMARY.MODE);
    const loudnesses = await this.featureService.getLoudnesses(audioUri);
    this.addFeature("loudness", loudnesses, newSong, globals.SUMMARY.MEAN);
    await this.player.getDymoManager().loadFromStore(newSong);
    return newSong;
  }

  private async addFeature(name: string, values: Feature[], dymoUri: string, summaryMode: string) {
    this.dymoGen.setSummarizingMode(summaryMode);
    await this.dymoGen.addFeature(name, values, dymoUri);
  }

  private async transitionBasedOnDecisionType(newSong: string, features: number[]): Promise<Transition> {
    let transition: Transition;
    if (this.previousSongs.length == 0) {
      transition = await this.mixGen.startMixWithFadeIn(newSong);
    } else if (this.decisionType == DecisionType.Default) {
      transition = await this.mixGen[this.defaultTransitionType](newSong);
    } else if (this.decisionType == DecisionType.Random) {
      transition = await this.randomTransition(newSong);
    } else if (this.decisionType == DecisionType.FiftyFifty) {
      //fiftyfifty random and decision tree
      transition = Math.random() > 0.5 ? await this.randomTransition(newSong)
        : await this.decisionTreeTransition(newSong, features);
    } else {
      transition = await this.decisionTreeTransition(newSong, features);
    }
    if (this.decisionType != DecisionType.FiftyFifty) {
      transition.decision = this.decisionType;
    }
    this.player.playUri(this.mixGen.getMixDymo());
    return transition;
  }

  private async randomTransition(newSong: string): Promise<Transition> {
    console.log("random")
    const randomTransition = _.sample(AVAILABLE_TRANSITIONS);
    const transition = await this.mixGen[randomTransition](newSong);
    transition.decision = DecisionType.Random;
    return transition;
  }

  private async decisionTreeTransition(newSong: string, features: number[]): Promise<Transition> {
    console.log("asking tree")
    //const songBoundaries = this.analyzer.getMainSongBody(newSong);
    const transitionType = this.decisionTree.classify(features);
    const transition = await this.mixGen[transitionType](newSong);
    transition.decision = DecisionType.DecisionTree;
    return transition;
  }

}