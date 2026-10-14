import { config } from './config.js';
import { createApp } from './app.js';

const server = createApp();

server.listen(config.port, config.host, () => {
  const { port } = server.address();
  console.log(`Trading Journal running at http://${config.host}:${port}`);
  console.log(`Data: ${config.dataDir}`);
  if (config.host === '0.0.0.0' || config.host === '::') {
    console.log('Note: the server is reachable from the whole network and has no login.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
