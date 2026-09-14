import config from './config.js';

const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredLevel = levels[config.logLevel] ?? levels.info;

function write(level, message, fields = {}) {
  if ((levels[level] ?? 100) < configuredLevel) return;
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    service: 'lineoa-complaint-api',
    environment: config.nodeEnv,
    message,
    ...fields,
  };
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(payload)}\n`);
}

export const logger = {
  debug: (message, fields) => write('debug', message, fields),
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields),
};
