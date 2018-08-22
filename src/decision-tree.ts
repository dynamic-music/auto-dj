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

/*export class DecisionTree<T> {

  constructor(private rootNode: DecisionTreeNode<T>, private elseT: T) {}

  getRootNode(): DecisionTreeNode<T> {
    return this.rootNode;
  }

  classify(features: number[]): T {
    const result = this.rootNode.classify(features);
    return result ? result : this.elseT;
  }

}


abstract class DecisionTreeNode<T> {

  constructor(protected messages?: string[]) {}

  abstract classify(features: number[]): T;

}

class SplitNode<T> extends DecisionTreeNode<T> {

  private leftChild: DecisionTreeNode<T>;
  private rightChild: DecisionTreeNode<T>;

  constructor(private splitColumn: number, private splitValue: number, messages?: string[]) {
    super(messages);
  }

  addSplitNode(splitColumn: number, splitValue: number, messages?: string[]): SplitNode<T> {
    return <SplitNode<T>>this.addChild(new SplitNode<T>(splitColumn, splitValue, messages));
  }

  addLeafNode(leafClasses: T[], message?: string): LeafNode<T> {
    return <LeafNode<T>>this.addChild(new LeafNode<T>(leafClasses, message));
  }

  private addChild(node: DecisionTreeNode<T>): DecisionTreeNode<T> {
    if (!this.leftChild) {
      this.leftChild = node;
    } else if (!this.rightChild) {
      this.rightChild = node;
    }
    return node;
  }

  classify(features: number[]): T {
    if (features[this.splitColumn] < this.splitValue) {
      if (this.messages && this.messages[0]) console.log(this.messages[0]);
      return this.leftChild.classify(features);
    }
    if (this.messages && this.messages[1]) console.log(this.messages[1]);
    return this.rightChild.classify(features);
  }

}

class LeafNode<T> extends DecisionTreeNode<T> {

  constructor(private leafClasses: T[], private message?: string) {
    super();
  }

  classify(_features: number[]): T {
    if (this.message) console.log(this.message);
    return _.sample(this.leafClasses);
  }

}*/