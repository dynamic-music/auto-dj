import { Features } from './analyzer';
import { JsonTree } from './decision-tree';
import { TransitionType } from './types';

const KEY_TREE: JsonTree<TransitionType> = {
  col: Features.KeyDistance,
  val: 3,
  left: {
    mes: "key similar",
    classes: [TransitionType.Effects, TransitionType.EchoFreeze]
  },
  right: {
    mes: "give up",
    classes: [TransitionType.PowerDown, TransitionType.BeatRepeat]
  }
}

export const STANDARD_TREE: JsonTree<TransitionType> = {
  col: Features.RegularityProduct,
  val: .015,
  left: {
    mes: "both regular",
    col: Features.TempoRatio,
    val: .85,
    right: {
      mes: "tempo similar",
      classes: [TransitionType.Beatmatch]
    },
    left: {
      mes: "tempo not similar",
      col: Features.TempoMultiplicity,
      val: .85,
      right: {
        mes: "tempo multiple",
        classes: [TransitionType.BeatmatchMultiple]
      },
      left: KEY_TREE
    }
  },
  right: KEY_TREE
};