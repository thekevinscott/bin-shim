import { spawn } from 'node:child_process';
import type { Spawner } from '../types.js';
import { ensureExecutable } from './ensureExecutable.js';

export const defaultSpawner: Spawner = (cmd, args) =>
  new Promise((resolve, reject) => {
    ensureExecutable(cmd);
    const child = spawn(cmd, [...args], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
