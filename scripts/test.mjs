import coreSuite from "../packages/core/tests/core.test.mjs";
import aiSuite from "../apps/web/tests/ai.test.mjs";
import evaluationSuite from "../apps/web/tests/evaluation.test.mjs";
import learnedSuite from "../apps/web/tests/learned.test.mjs";
import workerSuite from "../apps/web/tests/worker.test.mjs";
import trainingSuite from "../training/training.test.mjs";
import { runSuites } from "../tests/testHarness.mjs";

await runSuites([coreSuite, evaluationSuite, aiSuite, learnedSuite, workerSuite, trainingSuite]);
