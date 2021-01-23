/* eslint-disable no-param-reassign */
if (!codeceptjs) {
  global.codeceptjs = require('codeceptjs');
}
const { event, recorder, codecept } = global.codeceptjs;
const chalk = require('chalk');
const TestomatClient = require('../client');
const { FAILED } = require('../constants');
const TRConstants = require('../constants');
const Output = require('../output');

let currentMetaStep = [];
let stepShift = 0;
const output = new Output({
  filterFn: (stack) => {
    return !stack.includes('codeceptjs/lib/output') // output from codeceptjs
  }
});
let stepStart = new Date();

const MAJOR_VERSION = parseInt(codecept.version().match(/\d/)[0]);

if (MAJOR_VERSION < 3) {
  console.log('🔴 This reporter works with CodeceptJS 3+, please update your tests')
}

const parseTest = tags => {
  for (const tag of tags) {
    if (tag.startsWith('@T')) {
      return tag.substring(2, tag.length);
    }
  }

  return null;
};

const getTestAndMessage = title => {
  const testObj = { message: '' };
  const testArr = title.split(/\s(\|\s\{.*?\})/);
  testObj.title = testArr[0];

  return testObj;
};

module.exports = (config) => {
  let failedTests = [];
  const testTimeMap = {};
  const { apiKey } = config;

  const getDuration = test => {
    if (testTimeMap[test.id]) {
      return Date.now() - testTimeMap[test.id];
    }

    return 0;
  };

  if (apiKey === '' || apiKey === undefined) {
    console.error('Testomatio API key is not set, reporting disabled');
    return;
  }
  const client = new TestomatClient({ apiKey });

  recorder.startUnlessRunning();

  // Listening to events
  event.dispatcher.on(event.all.before, () => {
    recorder.add('Creating new run', () => client.createRun());
  });

  event.dispatcher.on(event.test.before, () => {
    currentMetaStep = [];
  });

  event.dispatcher.on(event.test.started, (test) => {
    testTimeMap[test.id] = Date.now();
    output.reset();
    output.start();
  });

  event.dispatcher.on(event.all.result, () => {
    const status = failedTests.length === 0 ? TRConstants.PASSED : TRConstants.FAILED;
    client.updateRunStatus(status);
  });

  event.dispatcher.on(event.test.passed, (test) => {
    const { id, tags, title } = test;
    if (id && failedTests.includes(id)) {
      failedTests = failedTests.filter(failed => id !== failed);
    }
    const testId = parseTest(tags);
    const testObj = getTestAndMessage(title);
    client.addTestRun(testId, TRConstants.PASSED, {
      ...stripExampleFromTitle(title),
      message: testObj.message,
      time: getDuration(test),
      steps: output.text(),
    });
    output.stop();
  });

  event.dispatcher.on(event.test.after, (test) => {
    if (test.state && test.state !== FAILED) return;
    const {
      id, tags, title, err, artifacts,
    } = test;
    failedTests.push(id || title);
    const testId = parseTest(tags);
    const testObj = getTestAndMessage(title);
    client.addTestRun(testId, TRConstants.FAILED, {
      ...stripExampleFromTitle(title),
      error: err,
      message: testObj.message,
      time: getDuration(test),
      files: artifacts.screenshot ? [artifacts.screenshot] : [],
      steps: output.text(),
    });
    output.stop();
  });

  event.dispatcher.on(event.test.skipped, (test) => {
    const { tags, title } = test;
    const testId = parseTest(tags);
    const testObj = getTestAndMessage(title);
    client.addTestRun(testId, TRConstants.SKIPPED, {
      ...stripExampleFromTitle(title),
      message: testObj.message,
      time: getDuration(test),
    });
    output.stop();
  });

  event.dispatcher.on(event.step.started, (step) => {
    stepShift = 0;
    stepStart = new Date();
  });

  event.dispatcher.on(event.step.finished, (step) => {
    const printMetaStep = (metaStep) => {
      if (!metaStep) return currentMetaStep.shift();
      if (currentMetaStep.indexOf(metaStep.toString()) >= 0) return; // step is the same
      if (metaStep.metaStep) {
        printMetaStep(metaStep.metaStep);
      }
      currentMetaStep.unshift(metaStep.toString());
      output.push(repeat(stepShift) + metaStep.toString());
    };
    printMetaStep(step.metaStep);
    if (step.metaStep) {
      stepShift += 2;
    }
    let duration = (new Date()) - stepStart;
    if (duration) {
      duration = repeat(1) + chalk.grey(`(${duration}ms)`);
    }
    if (step.status === TRConstants.FAILED) {
      output.push(repeat(stepShift) + chalk.red(step.toString()) + duration);
    } else {
      output.push(repeat(stepShift) + chalk.green(step.toString()) + duration);
    }
  });

  event.dispatcher.on(event.step.comment, (step) => {
    output.push(chalk.cyan.bold(step.toString()));
  });
};

const DATA_REGEXP = /[|\s]+?(\{\".*\}|\[.*\])/;

function stripExampleFromTitle(title) {
  const res = title.match(DATA_REGEXP);
  if (!res) return { title, example: null };

  const example = JSON.parse(res[1]);
  title = title.replace(DATA_REGEXP, '').trim();

  return { title, example };
}

function repeat(num) {
  return ''.padStart(num, ' ');
}
