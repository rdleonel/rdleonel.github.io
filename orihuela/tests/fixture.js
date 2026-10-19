// Dados congelados para os testes: os testes não devem depender do data.json real, que
// muda todo dia (robô de cotações) e a cada cliente novo. É uma cópia de 09/10/2026.
const path = require('path');
const FIXTURE = path.join(__dirname, 'fixture-data.json');
const DATA = require(FIXTURE);
// Serve a cópia no lugar de orihuela/data.json. O service worker fica bloqueado para que
// toda requisição passe por aqui (o teste de atualização do app não usa isto).
async function useFixture(ctx) {
  await ctx.route('**/orihuela/data.json*', route => route.fulfill({ path: FIXTURE, contentType: 'application/json' }));
}
module.exports = { FIXTURE, DATA, useFixture, contextOptions: { serviceWorkers: 'block' } };
