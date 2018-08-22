import { Observable } from 'rxjs/Observable';
import * as _ from 'lodash';
import { DymoPlayer } from 'dymo-player';
import { DymoGenerator, DymoTemplates, SuperDymoStore, globals } from 'dymo-core';
import { MixGenerator, AVAILABLE_TRANSITIONS } from './mix-generator';
import { FeatureExtractor, Transition, TransitionType, DecisionType } from './types';
import { Analyzer } from './analyzer';
import { DecisionTree } from './decision-tree';
import { STANDARD_TREE } from './standard-tree';

export class AutoDj {

  private store: SuperDymoStore;
  private analyzer: Analyzer;
  private dymoGen: DymoGenerator;
  private mixGen: MixGenerator;
  private player: DymoPlayer;
  private previousPlayingDymos = [];
  private previousSongs = [];
  private decisionTree: DecisionTree<TransitionType>;

  //TODO AT SOME POINT IN THE FUTURE WE MAY HAVE AN API WITH SOME FEATURES
  constructor(private featureApi: string, private featureExtractor: FeatureExtractor,
      private decisionType?: DecisionType, decisionTree = STANDARD_TREE) {
    this.player = new DymoPlayer(true, false, 0.5, 2)//, undefined, undefined, true);
    this.decisionTree = new DecisionTree<TransitionType>(decisionTree);
  }

  init(): Promise<any> {
    return this.player.init('https://raw.githubusercontent.com/dynamic-music/dymo-core/master/ontologies/')//'https://dynamic-music.github.io/dymo-core/ontologies/')
      .then(() => {
        this.store = this.player.getDymoManager().getStore();
        this.dymoGen = new DymoGenerator(false, this.store);
        this.mixGen = new MixGenerator(this.dymoGen, this.player);
        this.analyzer = new Analyzer(this.store);
      });
  }

  getBeatObservable(): Observable<any> {
    return (this.player.getPlayingDymoUris())
      .filter(playingDymos => {
        // TODO identify which track is playing, and associate with a specific colour
       const nChanged = _.difference(playingDymos, this.previousPlayingDymos).length;
       this.previousPlayingDymos = playingDymos;
       return nChanged > 0;
      });
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
    if (this.previousSongs.length > 0) {
      const oldSong = _.last(this.previousSongs);
      return this.analyzer.getAllFeatures(oldSong, newSong);
    }
  }

  private async extractFeaturesAndAddDymo(audioUri: string): Promise<string> {
    const buffer = await (await this.player.getAudioBank()).getAudioBuffer(audioUri);
    let beats = await this.featureExtractor.extractBeats(buffer);
    //drop initial and final incomplete bars
    beats = _.dropWhile(beats, b => b.label.value !== "1");
    beats = _.dropRightWhile(beats, b => b.label.value !== "4");
    const newSong = await DymoTemplates.createAnnotatedBarAndBeatDymo2(this.dymoGen, audioUri, beats);
    const keys = await this.featureExtractor.extractKey(buffer);
    this.dymoGen.setSummarizingMode(globals.SUMMARY.MODE);
    await this.dymoGen.addFeature("key", keys, newSong);
    await this.player.getDymoManager().loadFromStore(newSong);
    return newSong;
  }

  private async transitionBasedOnDecisionType(newSong: string, features: number[]): Promise<Transition> {
    let transition: Transition;
    if (this.previousSongs.length == 0) {
      transition = await this.mixGen.startMixWithFadeIn(newSong);
    } else if (this.decisionType == DecisionType.Default) {
      transition = await this.mixGen.beatmatchCrossfade(newSong);
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