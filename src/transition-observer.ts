import { SuperDymoStore, ValueObserver, uris } from 'dymo-core';

export class TransitionObserver implements ValueObserver {

  constructor(store: SuperDymoStore, private uri: string, private func: Function) {
    store.addValueObserver(uri, uris.VALUE, this);
  }

  observedValueChanged(uri: string): void {
    if (uri == this.uri) {
      this.func();
    }
  }

}