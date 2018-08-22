import { Observable } from 'rxjs/Observable';
import * as _ from 'lodash';
import { DymoPlayer } from 'dymo-player';
import { DymoGenerator, DymoTemplates, SuperDymoStore, globals } from 'dymo-core';
import { MixGenerator } from './mix-generator';
import { FeatureExtractor, Transition, TransitionType, DecisionType } from './types';
import { Analyzer } from './analyzer';

export class AutoDj {

  private store: SuperDymoStore;
  private analyzer: Analyzer;
  private dymoGen: DymoGenerator;
  private mixGen: MixGenerator;
  private player: DymoPlayer;
  private previousPlayingDymos = [];
  private previousSongs = [];

  //TODO AT SOME POINT IN THE FUTURE WE MAY HAVE AN API WITH SOME FEATURES
  constructor(private featureApi: string, private featureExtractor: FeatureExtractor) {
    this.player = new DymoPlayer(true, false, 0.5, 2)//, undefined, undefined, true);
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
    let buffer = await (await this.player.getAudioBank()).getAudioBuffer(audioUri);
    let beats = await this.featureExtractor.extractBeats(buffer);
    //drop initial and final incomplete bars
    beats = _.dropWhile(beats, b => b.label.value !== "1");
    beats = _.dropRightWhile(beats, b => b.label.value !== "4");
    let newSong = await DymoTemplates.createAnnotatedBarAndBeatDymo2(this.dymoGen, audioUri, beats);
    let oldSong = this.previousSongs.length ? _.last(this.previousSongs) : undefined;
    let keys = await this.featureExtractor.extractKey(buffer);
    this.dymoGen.setSummarizingMode(globals.SUMMARY.MODE);
    await this.dymoGen.addFeature("key", keys, newSong);
    let transition = await this.internalTransition(newSong);
    if (oldSong) {
      transition.features = await this.analyzer.getAllFeatures(oldSong, newSong);
    }
    return transition;
  }

  private async internalTransition(newSong: string): Promise<Transition> {
    //stopped playing, reset
    if (this.previousSongs.length > 0 && !this.player.isPlaying(this.mixGen.getMixDymo())) {
      this.previousSongs = [];
      await this.mixGen.init();
    }
    await this.player.getDymoManager().loadFromStore(newSong);
    const transition = await this.defaultTransition(newSong);
    /*if (Math.random() > 0.5) {
      transition = await this.randomTransition(newSong);
    } else {*/
      //transition = await this.startWhicheverTransitionIsBest(newSong);
    //}
    this.previousSongs.push(newSong);
    this.player.playUri(this.mixGen.getMixDymo());
    return transition;
  }

  private async defaultTransition(newSong: string): Promise<Transition> {
    let transition: Transition;
    if (this.previousSongs.length > 0) {
      //transition = await this.startWhicheverTransitionIsBest(newSong);
      //transition = await this.randomTransition(newSong);
      transition = await this.mixGen.beatmatchCrossfade(newSong);
    } else {
      transition = await this.mixGen.startMixWithFadeIn(newSong);
    }
    transition.decision = DecisionType.Default;
    return transition;
  }

  private async randomTransition(newSong: string): Promise<Transition> {
    console.log("random")
    let transition: Transition;
    if (this.previousSongs.length > 0) {
      transition = await this.getRandomTransition()(newSong);
    } else {
      transition = await this.mixGen.startMixWithFadeIn(newSong);
    }
    transition.decision = DecisionType.Random;
    return transition;
  }

  private async startWhicheverTransitionIsBest(newSong: string): Promise<Transition> {
    console.log("tree")
    let transition: Transition;
    const previousSong = _.last(this.previousSongs);

    if (this.previousSongs.length == 0) {
      transition = await this.mixGen.startMixWithFadeIn(newSong);
    } else {
      //const songBoundaries = this.analyzer.getMainSongBody(newSong);
      if (await this.analyzer.hasRegularBeats(newSong) && await this.analyzer.hasRegularBeats(previousSong)) {
        console.log("both regular")
        if (await this.analyzer.tempoSimilar(newSong, previousSong)) {
          console.log("tempo similar")
          //transition using beatmatching and tempo interpolation
          transition = await this.mixGen.beatmatchCrossfade(newSong);
        }/* else if (await analyzer.tempoCloseToMultiple(newSong, previousSong)) {
          console.log("tempo multiple")
          //TODO this.mixGen.transitionImmediatelyByCrossfadeAndBeatmatchToMultiple(newSong, oldDymo);
          this.mixGen.transitionImmediatelyByCrossfadeAndBeatmatch(newSong);
        }*/ else if (await this.analyzer.getKeyDistance(newSong, previousSong) <= 2) {
          console.log("key similar")
          if (Math.random() > 0.5) {
            transition = await this.mixGen.effects(newSong);
          } else {
            transition = await this.mixGen.echoFreeze(newSong);
          }
        } else {
          console.log("give up")
          if (Math.random() > 0.5) {
            transition = await this.mixGen.beatRepeat(newSong);
          } else {
            transition = await this.mixGen.powerDown(newSong);
          }
        }
      } else if (await this.analyzer.getKeyDistance(newSong, previousSong) <= 2) {
        console.log("key similar")
        transition = await this.mixGen.echoFreeze(newSong);
      } else {
        console.log("give up")
        if (Math.random() > 0.5) {
          transition = await this.mixGen.beatRepeat(newSong);
        } else {
          transition = await this.mixGen.powerDown(newSong);
        }
      }
    }
    transition.decision = DecisionType.DecisionTree;
    return transition;
  }

  private getRandomTransition(): (string) => Promise<Transition> {
    const transitions: ((string) => Promise<Transition>)[] = [
      (newDymo: string) => this.mixGen.beatmatchCrossfade(newDymo),
      (newDymo: string) => this.mixGen.echoFreeze(newDymo),
      (newDymo: string) => this.mixGen.slam(newDymo),
      (newDymo: string) => this.mixGen.beatRepeat(newDymo),
      (newDymo: string) => this.mixGen.crossfade(newDymo),
      (newDymo: string) => this.mixGen.powerDown(newDymo),
      (newDymo: string) => this.mixGen.effects(newDymo)
    ];
    return transitions[_.random(transitions.length)];
  }

}