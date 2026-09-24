// Local stand-in for the Tesla Fleet API. Point your app's base URL at
// http://localhost:4000 while developing, then swap in the real regional
// endpoint (e.g. https://fleet-api.prd.na.vn.cloud.tesla.com) once you have
// access to a car.

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { SimulatedVehicle, SUPPORTED_COMMANDS } from './vehicle.js';

const TICK_MS = 2000;

export function createMockServer({ vehicles = [new SimulatedVehicle()], tickMs = TICK_MS } = {}) {
  const findVehicle = (idOrVin) =>
    vehicles.find((v) => String(v.id) === idOrVin || v.vin === idOrVin);

  const server = http.createServer(async (req, res) => {
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (!/^Bearer \S+/.test(req.headers.authorization ?? '')) {
      return send(401, { error: 'invalid bearer token' });
    }

    const { pathname } = new URL(req.url, 'http://localhost');
    const parts = pathname.split('/').filter(Boolean); // ['api', '1', 'vehicles', ...]
    if (parts[0] !== 'api' || parts[1] !== '1' || parts[2] !== 'vehicles') {
      return send(404, { error: 'not found' });
    }

    if (parts.length === 3 && req.method === 'GET') {
      return send(200, { response: vehicles.map((v) => v.summary()), count: vehicles.length });
    }

    const vehicle = findVehicle(parts[3]);
    if (!vehicle) return send(404, { error: 'vehicle not found' });
    const action = parts.slice(4);

    if (action.length === 0 && req.method === 'GET') {
      return send(200, { response: vehicle.summary() });
    }
    if (action[0] === 'vehicle_data' && req.method === 'GET') {
      if (!vehicle.isOnline()) {
        return send(408, { error: 'vehicle unavailable: vehicle is offline or asleep' });
      }
      return send(200, { response: vehicle.data() });
    }
    if (action[0] === 'wake_up' && req.method === 'POST') {
      return send(200, { response: vehicle.wake() });
    }
    if (action[0] === 'command' && action[1] && req.method === 'POST') {
      if (!vehicle.isOnline()) {
        return send(408, { error: 'vehicle unavailable: vehicle is offline or asleep' });
      }
      let body = {};
      try {
        body = await readJson(req);
      } catch {
        return send(400, { error: 'invalid JSON body' });
      }
      return send(200, { response: vehicle.command(action[1], body) });
    }

    // Dev-only helper to put the car back to sleep so you can test wake flows.
    if (action[0] === 'mock_sleep' && req.method === 'POST') {
      vehicle.sleep();
      return send(200, { response: vehicle.summary() });
    }

    return send(404, { error: 'not found' });
  });

  const ticker = setInterval(() => vehicles.forEach((v) => v.tick()), tickMs);
  ticker.unref();
  server.on('close', () => clearInterval(ticker));

  return server;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4000);
  createMockServer().listen(port, () => {
    console.log(`Mock Tesla Fleet API listening on http://localhost:${port}`);
    console.log(`Supported commands: ${SUPPORTED_COMMANDS.join(', ')}`);
  });
}
