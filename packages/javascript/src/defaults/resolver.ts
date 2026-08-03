import { createRequire } from 'node:module';
import type { Resolver } from '../types.js';

export const defaultResolver = (from: string | URL): Resolver =>
  createRequire(from).resolve;
