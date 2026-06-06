import { performance } from "node:perf_hooks";

export function createSuite(name) {
  const tests = [];

  return {
    name,
    test(testName, run) {
      tests.push({ name: testName, run });
    },
    async run() {
      const startedAt = performance.now();
      const results = [];

      for (const test of tests) {
        const testStartedAt = performance.now();
        try {
          await test.run();
          results.push({
            name: test.name,
            ok: true,
            durationMs: Math.round(performance.now() - testStartedAt),
          });
        } catch (error) {
          results.push({
            name: test.name,
            ok: false,
            durationMs: Math.round(performance.now() - testStartedAt),
            error,
          });
        }
      }

      return {
        name,
        durationMs: Math.round(performance.now() - startedAt),
        results,
      };
    },
  };
}

export async function runSuites(suites) {
  const reports = [];

  for (const suite of suites) {
    reports.push(await suite.run());
  }

  let failures = 0;
  for (const report of reports) {
    console.log(`\n[Suite] ${report.name} (${report.durationMs} ms)`);
    for (const result of report.results) {
      if (result.ok) {
        console.log(`  [PASS] ${result.name} (${result.durationMs} ms)`);
      } else {
        failures += 1;
        console.error(`  [FAIL] ${result.name} (${result.durationMs} ms)`);
        console.error(`         ${result.error?.stack || result.error}`);
      }
    }
  }

  if (failures > 0) {
    throw new Error(`${failures} test(s) failed.`);
  }

  console.log(`\nAll ${reports.reduce((sum, report) => sum + report.results.length, 0)} tests passed.`);
}
