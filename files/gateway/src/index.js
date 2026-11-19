import { createApp } from './app.js';
import { readConfig } from './config.js';

const { port, ...options } = readConfig(process.env);

createApp(options).listen(port, () => console.log(`gateway listening on ${port}`));
