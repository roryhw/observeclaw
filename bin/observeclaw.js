#!/usr/bin/env node

// ObserveClaw — system observability dashboard for OpenClaw
// https://github.com/roryhw/observeclaw

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from cwd if present (user's working directory)
const dotenvPath = path.join(process.cwd(), '.env');
try {
  const { config } = await import('dotenv');
  config({ path: dotenvPath });
} catch {
  // dotenv loaded by server.ts anyway
}

// Start the server
await import(path.join(__dirname, '..', 'dist', 'server.js'));
