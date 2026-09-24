import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMockServer } from '../mock-server/server.js';
import { SimulatedVehicle } from '../mock-server/vehicle.js';
import { TeslaClient, TeslaApiError } from '../client/tesla-client.js';

let server;
let client;
let vehicle;

before(async () => {
  vehicle = new SimulatedVehicle({ wakeMs: 50 });
  server = createMockServer({ vehicles: [vehicle], tickMs: 20 });
  await new Promise((r) => server.listen(0, r));
  client = new TeslaClient({
    baseUrl: `http://localhost:${server.address().port}`,
    accessToken: 'test-token',
  });
});

after(() => server.close());

test('rejects requests without a bearer token', async () => {
  const res = await fetch(`http://localhost:${server.address().port}/api/1/vehicles`);
  assert.equal(res.status, 401);
});

test('asleep car returns 408 until woken', async () => {
  vehicle.sleep();
  await assert.rejects(client.vehicleData(vehicle.id), (err) => err instanceof TeslaApiError && err.status === 408);
  const woke = await client.waitUntilOnline(vehicle.id, { pollMs: 20 });
  assert.equal(woke.state, 'online');
  const data = await client.vehicleData(vehicle.vin);
  assert.equal(data.vin, vehicle.vin);
});

test('commands change vehicle state', async () => {
  await client.waitUntilOnline(vehicle.id, { pollMs: 20 });
  assert.deepEqual(await client.command(vehicle.id, 'door_unlock'), { result: true, reason: '' });
  assert.equal((await client.vehicleData(vehicle.id)).vehicle_state.locked, false);

  const bad = await client.command(vehicle.id, 'set_charge_limit', { percent: 20 });
  assert.equal(bad.result, false);
  const unknown = await client.command(vehicle.id, 'launch_rocket');
  assert.equal(unknown.result, false);
});

test('charging raises battery level up to the limit', async () => {
  await client.waitUntilOnline(vehicle.id, { pollMs: 20 });
  await client.command(vehicle.id, 'set_charge_limit', { percent: 65 });
  await client.command(vehicle.id, 'charge_start');
  await new Promise((r) => setTimeout(r, 200));
  const { charge_state } = await client.vehicleData(vehicle.id);
  assert.equal(charge_state.battery_level, 65);
  assert.equal(charge_state.charging_state, 'Complete');
});
