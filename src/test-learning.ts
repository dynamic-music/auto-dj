import irisDataset from 'ml-dataset-iris';
import {DecisionTreeClassifier as DTClassifier} from 'ml-cart';

var trainingSet = irisDataset.getNumbers();
var predictions = irisDataset.getClasses().map(
    (elem) => irisDataset.getDistinctClasses().indexOf(elem)
);
console.log(trainingSet, predictions)

//trainingSet = []

var options = {
    gainFunction: 'gini',
    maxDepth: 10,
    minNumSamples: 3
};

var classifier = new DTClassifier(options);
classifier.train(trainingSet, predictions);
var result = classifier.predict(trainingSet);
console.log(classifier.predict(trainingSet));
console.log(classifier)

/*
import * as classifi from 'classifi';
//import * as data_util from 'learningjs/data_util';
const data_util = classifi.data_util;

const D = `
outlook, temp, humidity, wind, label
text, real, text, text, feature_type
'Sunny',80,'High', 'Weak', 'No'
'Sunny',82,'High', 'Strong', 'No'
'Overcast',73,'High', 'Weak', 'Yes'
`
//const url = URL.createObjectURL(data);
const D2 = {
  data: [['Sunny',80,'High', 'Weak'],
    ['Sunny',82,'High', 'Strong'],
    ['Overcast',73,'High', 'Weak'],
    ['Sunny',74,'Low', 'Weak'],
    ['Rainy',50,'Low', 'Weak']],
  targets: ['No', 'No', 'Yes', 'Yes', 'Yes'],
  l_featuresIndex: [0,1,2,3],
  feature_name2id: {'outlook': 0, 'temp': 1, 'humidity': 2, 'wind': 3},
  featureNames: ['outlook', 'temp', 'humidity', 'wind'],
  featuresType: ['text', 'real', 'text', 'text']
}

new classifi.learning.tree().train(D2, function(model, err){
  if(err) {
    console.log(err);
  } else {
    console.log(model)
    console.log(model.classify(['Overcast',90,'High', 'Strong']))
    /*model.calcAccuracy(D2.data, D2.targets, function(acc, correct, total){
      console.log( 'training: got '+correct +' correct out of '+total+' examples. accuracy:'+(acc*100.0).toFixed(2)+'%');
    });*
  }
});*/