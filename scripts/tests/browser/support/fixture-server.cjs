const http = require('node:http');
const {handleRequest, fixtureScenarios} = require('../../dashboard-preview.cjs');
let scenario = 'live';
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://fixture.invalid');
    if (url.pathname === '/__test/scenario') {
      const selected = url.searchParams.get('name');
      if (!fixtureScenarios.includes(selected)) {
        response.writeHead(400); response.end('Unknown fixture scenario'); return;
      }
      scenario = selected;
      response.end('Scenario selected'); return;
    }
    url.searchParams.set('fixture', scenario);
    request.url = url.pathname + url.search;
    await handleRequest(request, response);
  } catch (error) {
    response.writeHead(500); response.end('Fixture request failed');
    console.error(error);
  }
});
server.listen(0, '127.0.0.1', () => process.send?.({port: server.address().port}));
process.on('SIGTERM', () => {server.closeAllConnections(); server.close(() => process.exit(0));});
