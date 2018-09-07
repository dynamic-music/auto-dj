# auto-dj
Automatic DJing node module for the browser.
Uses decision processes based on automatic audio analysis to make nice transitions between songs.

Install using
```bash
$ npm install auto-dj
```

Initialize using
```typescript
const dj = new AutoDJ();
await dj.isReady();
```

Transition to a song using
```typescript
dj.transitionToTrack('https://path-to-audio');
```

Synchronize anything to the beat with
```typescript
const beats = dj.getBeatObservable();
```

The constructor of ``AutoDj`` can be given a custom ``FeatureService``, a decision type in (``Default``, ``Random``, ``DecisionTree``, ``FiftyFifty``), a custom decision tree of type ``JsonTree``, and a default transition type in ``TransitionType``.