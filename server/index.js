import { config } from './config.js';
import { createApp } from './app.js';

const server = createApp();

server.listen(config.port, config.host, () => {
  const { port } = server.address();
  console.log(`Trading Journal läuft auf http://${config.host}:${port}`);
  console.log(`Daten: ${config.dataDir}`);
  if (config.host === '0.0.0.0' || config.host === '::') {
    console.log('Hinweis: Der Server ist im gesamten Netzwerk erreichbar und hat keinen Login.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
