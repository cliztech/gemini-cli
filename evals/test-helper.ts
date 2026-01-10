/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from 'vitest';
import fs from 'node:fs';
import { TestRig } from '@google/gemini-cli-test-utils';

export * from '@google/gemini-cli-test-utils';

export const conditionalDescribe = process.env.RUN_EVALS
  ? describe
  : describe.skip;

export interface EvalCase {
  name: string;
  params?: Record<string, any>;
  prompt: string;
  assert: (rig: TestRig, result: string) => Promise<void>;
  log?: boolean;
}

export async function runEval(evalCase: EvalCase) {
  const rig = new TestRig();
  try {
    await rig.setup(evalCase.name, evalCase.params);
    const result = await rig.run({ args: evalCase.prompt });
    await evalCase.assert(rig, result);
  } finally {
    if (evalCase.log) {
      await logToFile(evalCase.name, JSON.stringify(rig.readToolLogs(), null, 2));
    }
    await rig.cleanup();
  }
}

async function logToFile(name: string, content: string) {
  const logDir = 'evals/logs';
  await fs.promises.mkdir(logDir, { recursive: true });
  const sanitizedName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const logFile = `${logDir}/${sanitizedName}.log`;
  await fs.promises.writeFile(logFile, content);
}
