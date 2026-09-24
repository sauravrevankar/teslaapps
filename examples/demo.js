// Walks through a typical app flow: find the car, wake it, read state, send
// commands. Run `npm run mock` in another terminal first, then `npm run demo`.
//
// To target the real API later:
//   TESLA_BASE_URL=https://localhost:4443 TESLA_ACCESS_TOKEN=<oauth token> npm run demo
// (with tesla-http-proxy running on 4443 so commands get signed).

import { TeslaClient } from '../client/tesla-client.js';

const client = new TeslaClient({
  baseUrl: process.env.TESLA_BASE_URL ?? 'http://localhost:4000',
  accessToken: process.env.TESLA_ACCESS_TOKEN ?? 'mock-token',
});

const [car] = await client.listVehicles();
console.log(`Found ${car.display_name} (${car.vin}), state: ${car.state}`);

if (car.state !== 'online') {
  console.log('Waking up...');
  await client.waitUntilOnline(car.id, { pollMs: 1000 });
}

const before = await client.vehicleData(car.id);
console.log(`Battery ${before.charge_state.battery_level}%, locked: ${before.vehicle_state.locked}, inside ${before.climate_state.inside_temp}°C`);

console.log('set_charge_limit 90 ->', await client.command(car.id, 'set_charge_limit', { percent: 90 }));
console.log('charge_start       ->', await client.command(car.id, 'charge_start'));
console.log('auto_conditioning  ->', await client.command(car.id, 'auto_conditioning_start'));
console.log('door_unlock        ->', await client.command(car.id, 'door_unlock'));

const after = await client.vehicleData(car.id);
console.log(`Now: charging=${after.charge_state.charging_state}, limit=${after.charge_state.charge_limit_soc}%, climate on=${after.climate_state.is_climate_on}, locked=${after.vehicle_state.locked}`);
