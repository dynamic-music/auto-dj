import * as _ from 'lodash';

export type JsonTree<T> = Leaf<T> | Split<T>;

export interface Node {
  mes?: string
}

export interface Split<T> extends Node {
  col: number,
  val: number,
  left: JsonTree<T>,
  right: JsonTree<T>
}

export interface Leaf<T> extends Node {
  classes: T[]
}

export class DecisionTree<T> {

  constructor(private tree: JsonTree<T>) {}

  classify(features: number[]): T {
    return this.recursiveClassify(features, this.tree);
  }

  private recursiveClassify(features: number[], node: JsonTree<T>): T {
    if (node.mes) console.log(node.mes);
    if ("col" in node) { // it's a split
      if (features[node.col] < node.val) {
        return this.recursiveClassify(features, node.left);
      }
      return this.recursiveClassify(features, node.right);
    }
    return _.sample(node.classes);
  }

}