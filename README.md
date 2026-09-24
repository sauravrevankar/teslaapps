# teslaapps

Build Tesla apps **without owning a Tesla**. Write and test against a local mock
of the Tesla Fleet API, then point the same code at a real car only for final
testing.

```bash
npm run mock    # terminal 1: fake Fleet API on http://localhost:4000
npm run demo    # terminal 2: list car → wake → read state → send commands
npm test
```

No dependencies. Needs Node 20 or newer.

---

## The three ways an app can talk to a Tesla

| Path | What it's for | Needs a car? |
|---|---|---|
| **Fleet API** (cloud, HTTPS) | Remote apps: read battery/climate/location, lock/unlock, charging, climate, and so on | Only for real testing. You can build everything against a mock. |
| **Bluetooth LE** (Vehicle Command Protocol) | Phone-as-key style apps that work offline, near the car | Yes, for pairing. You need to tap a key card in the car to add your key. |
| **In-car browser** | Web apps shown on the car's touchscreen | No. It's a Chromium-based browser, so you can build a normal responsive web app. |

Tesla doesn't let third-party native apps run on the car's screen. Also, the
car's Bluetooth isn't open as a general-purpose device. Apart from phone and
audio, the only Bluetooth interface is the signed key/command protocol below.

## 1. Fleet API (the main path)

How it works for real:
1. Sign up at **developer.tesla.com** and create an application. You need a
   domain you control.
2. Generate an EC key pair (prime256v1) and host the public key at
   `https://<your-domain>/.well-known/appspecific/com.tesla.3p.public-key.pem`.
3. Get a partner token (OAuth `client_credentials`) and call
   `POST /api/1/partner_accounts` once per region to register your domain.
4. The car owner signs in through Tesla OAuth (`auth.tesla.com`) and approves
   your scopes (`vehicle_device_data`, `vehicle_cmds`, `vehicle_charging_cmds`, …).
   Your app gets an access token for their cars.
5. The owner also installs your **virtual key** on the car by opening
   `https://tesla.com/_ak/<your-domain>` on their phone. Without it, signed
   commands are rejected.
6. Call the regional base URL, e.g. `https://fleet-api.prd.na.vn.cloud.tesla.com`
   or `https://fleet-api.prd.eu.vn.cloud.tesla.com`.
7. On current vehicles, commands must be signed. Run Tesla's
   [`tesla-http-proxy`](https://github.com/teslamotors/vehicle-command) and
   send commands through it. Reads (`vehicle_data`) can go directly to the API.

Steps 1–3 need **no car**, so you can do them now. Only steps 4–5 need a
vehicle owner.

Fleet API use is billed per request, and Tesla gives developer accounts a
monthly credit. Check the current pricing on developer.tesla.com. Avoid
unnecessary `wake_up` calls and polling. Use
[Fleet Telemetry](https://github.com/teslamotors/fleet-telemetry) for streaming
data.

### Developing without a car: this repo

- `mock-server/`: a local Fleet API stand-in. It supports `GET /api/1/vehicles`,
  `/vehicles/{id}`, `/vehicles/{id}/vehicle_data`, `POST /wake_up` and
  `POST /command/{name}`. Its behavior is realistic: a sleeping car returns
  **408** until it's woken, waking takes a few seconds, charging raises the
  battery level over time, and the cabin temperature moves toward the setpoint.
  Use `POST /api/1/vehicles/{id}/mock_sleep` to put it back to sleep.
- `client/tesla-client.js`: a client that runs unchanged against the mock, the
  real API, or `tesla-http-proxy`. Only `baseUrl` and `accessToken` change.
- `examples/demo.js`: a full example flow.

```bash
# Later, against a real car (via tesla-http-proxy on :4443):
TESLA_BASE_URL=https://localhost:4443 TESLA_ACCESS_TOKEN=<token> npm run demo
```

The mock covers a subset of fields and commands. Treat real-car responses as
the source of truth. When you get access to a car, save a few real
`vehicle_data` responses and update the mock to match them.

## 2. Bluetooth LE

The car's BLE interface uses the same Vehicle Command Protocol (protobuf,
signed with your key) as the Fleet API proxy. Tesla's reference implementation
is the `tesla-control` CLI in
[teslamotors/vehicle-command](https://github.com/teslamotors/vehicle-command).
Use it as your protocol reference. Don't reverse-engineer the protocol from
scratch.

What you can do without a car:
- Read the Go source for message formats, session handshake and signing.
- Put the transport behind an interface (`send(bytes) → bytes`), with BLE in
  one implementation and a fake in another. Write your app logic and UI against
  the fake.
- Build the phone-side BLE scanning and connection code. Test it against a
  simulated peripheral, such as a second phone running a BLE peripheral
  simulator app (e.g. nRF Connect), that advertises the same service UUID.

What needs a car: adding your key requires someone to tap an authorized key
card on the center console. After that, you can test real BLE commands.

## 3. Getting real-car time cheaply

- **A friend or family member who owns a Tesla**: they sign in to *your*
  app through Tesla OAuth and approve your virtual key. You never need their
  password. They can revoke access at any time.
- **Rent one** (Turo, Hertz, and similar) for a day of end-to-end testing
  after the app works against the mock.
- **Tesla owner communities and clubs** often have owners who want to beta test.

## Suggested plan

1. Build the app and UI against `npm run mock` now.
2. Register on developer.tesla.com, host your public key, and register the
   partner account. None of this needs a car.
3. Get a real car for a short session. Do the OAuth flow, pair the virtual key,
   record real responses, and fix any differences.
4. For BLE, add a transport interface and a fake, and use a borrowed car only to
   pair a key and do the final checks.
