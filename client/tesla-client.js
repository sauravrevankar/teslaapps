// Minimal Tesla Fleet API client. The same code runs against the local mock
// server and the real API; only baseUrl and accessToken change.
//
// Note: on most current vehicles, real /command/* calls must be signed with the
// Vehicle Command Protocol. Route them through Tesla's tesla-http-proxy
// (github.com/teslamotors/vehicle-command) by setting baseUrl to the proxy.

export class TeslaApiError extends Error {
  constructor(status, body) {
    super(`Tesla API ${status}: ${body?.error ?? JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

export class TeslaClient {
  constructor({ baseUrl, accessToken, fetchImpl = globalThis.fetch }) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!accessToken) throw new Error('accessToken is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.accessToken = accessToken;
    this.fetch = fetchImpl;
  }

  async request(method, path, body) {
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new TeslaApiError(res.status, payload);
    return payload.response;
  }

  listVehicles() {
    return this.request('GET', '/api/1/vehicles');
  }

  getVehicle(vehicleTag) {
    return this.request('GET', `/api/1/vehicles/${vehicleTag}`);
  }

  vehicleData(vehicleTag) {
    return this.request('GET', `/api/1/vehicles/${vehicleTag}/vehicle_data`);
  }

  wakeUp(vehicleTag) {
    return this.request('POST', `/api/1/vehicles/${vehicleTag}/wake_up`);
  }

  command(vehicleTag, name, body = {}) {
    return this.request('POST', `/api/1/vehicles/${vehicleTag}/command/${name}`, body);
  }

  // Wakes the car and polls until it reports online. Real cars can take
  // 10-30 seconds; keep wake-ups rare since they cost battery and API credit.
  async waitUntilOnline(vehicleTag, { timeoutMs = 30000, pollMs = 2000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    await this.wakeUp(vehicleTag);
    while (Date.now() < deadline) {
      const vehicle = await this.getVehicle(vehicleTag);
      if (vehicle.state === 'online') return vehicle;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(`vehicle ${vehicleTag} did not wake within ${timeoutMs}ms`);
  }
}
