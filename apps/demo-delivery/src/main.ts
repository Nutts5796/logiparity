import { startDemo } from './start.js';
await startDemo({ allBugs: process.argv.includes('--bugs') });
