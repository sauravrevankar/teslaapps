// A simulated Tesla vehicle. State shapes follow the Fleet API's vehicle_data
// response closely enough to build UIs and logic against, but only a subset of
// fields is modeled. Always verify against a real car before shipping.

const CHARGE_PERCENT_PER_TICK = 1;
const DEFAULT_WAKE_MS = 3000;

export class SimulatedVehicle {
  constructor({
    id = 1000000000000001,
    vin = '5YJ3E1EA0PF000001',
    displayName = 'Mock Model 3',
    asleep = true,
    wakeMs = DEFAULT_WAKE_MS,
  } = {}) {
    this.id = id;
    this.vehicleId = id + 1;
    this.vin = vin;
    this.displayName = displayName;
    this.wakeMs = wakeMs;
    this.state = asleep ? 'asleep' : 'online';
    this.wakeTimer = null;

    this.charge = {
      battery_level: 62,
      battery_range: 180.5,
      charge_limit_soc: 80,
      charging_state: 'Disconnected',
      charge_port_door_open: false,
      charger_power: 0,
      minutes_to_full_charge: 0,
    };
    this.climate = {
      inside_temp: 24.5,
      outside_temp: 19.0,
      driver_temp_setting: 21.0,
      passenger_temp_setting: 21.0,
      is_climate_on: false,
    };
    this.vehicle = {
      locked: true,
      odometer: 12345.6,
      car_version: '2026.32.1 mock',
      sentry_mode: false,
    };
    this.drive = {
      latitude: 37.4925,
      longitude: -121.9447,
      heading: 90,
      speed: null,
      shift_state: null,
    };
  }

  isOnline() {
    return this.state === 'online';
  }

  summary() {
    return {
      id: this.id,
      vehicle_id: this.vehicleId,
      vin: this.vin,
      display_name: this.displayName,
      state: this.state,
      in_service: false,
    };
  }

  data() {
    return {
      ...this.summary(),
      charge_state: { ...this.charge },
      climate_state: { ...this.climate },
      vehicle_state: { ...this.vehicle },
      drive_state: { ...this.drive },
    };
  }

  wake() {
    if (this.state === 'asleep' && !this.wakeTimer) {
      this.wakeTimer = setTimeout(() => {
        this.state = 'online';
        this.wakeTimer = null;
      }, this.wakeMs);
      this.wakeTimer.unref?.();
    }
    return this.summary();
  }

  sleep() {
    clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    this.state = 'asleep';
  }

  // Advances simulated time: charging adds battery, climate drifts toward target.
  tick() {
    if (this.charge.charging_state === 'Charging') {
      const next = Math.min(this.charge.battery_level + CHARGE_PERCENT_PER_TICK, this.charge.charge_limit_soc);
      this.charge.battery_level = next;
      this.charge.battery_range = Math.round(next * 2.9 * 10) / 10;
      if (next >= this.charge.charge_limit_soc) {
        this.charge.charging_state = 'Complete';
        this.charge.charger_power = 0;
      }
    }
    if (this.climate.is_climate_on) {
      const target = this.climate.driver_temp_setting;
      const delta = target - this.climate.inside_temp;
      this.climate.inside_temp = Math.round((this.climate.inside_temp + Math.sign(delta) * Math.min(Math.abs(delta), 0.5)) * 10) / 10;
    }
  }

  // Returns { result, reason } like the Fleet API command endpoints.
  command(name, body = {}) {
    const handler = COMMANDS[name];
    if (!handler) return { result: false, reason: `unknown command: ${name}` };
    return handler(this, body) ?? { result: true, reason: '' };
  }
}

const COMMANDS = {
  door_lock: (v) => { v.vehicle.locked = true; },
  door_unlock: (v) => { v.vehicle.locked = false; },
  honk_horn: () => {},
  flash_lights: () => {},
  auto_conditioning_start: (v) => { v.climate.is_climate_on = true; },
  auto_conditioning_stop: (v) => { v.climate.is_climate_on = false; },
  set_temps: (v, { driver_temp, passenger_temp }) => {
    if (typeof driver_temp !== 'number') return { result: false, reason: 'driver_temp is required' };
    v.climate.driver_temp_setting = driver_temp;
    v.climate.passenger_temp_setting = passenger_temp ?? driver_temp;
  },
  set_sentry_mode: (v, { on }) => { v.vehicle.sentry_mode = Boolean(on); },
  charge_port_door_open: (v) => { v.charge.charge_port_door_open = true; },
  charge_port_door_close: (v) => { v.charge.charge_port_door_open = false; },
  charge_start: (v) => {
    if (v.charge.battery_level >= v.charge.charge_limit_soc) return { result: false, reason: 'complete' };
    if (v.charge.charging_state === 'Charging') return { result: false, reason: 'is_charging' };
    v.charge.charging_state = 'Charging';
    v.charge.charge_port_door_open = true;
    v.charge.charger_power = 11;
  },
  charge_stop: (v) => {
    if (v.charge.charging_state !== 'Charging') return { result: false, reason: 'not_charging' };
    v.charge.charging_state = 'Stopped';
    v.charge.charger_power = 0;
  },
  set_charge_limit: (v, { percent }) => {
    if (typeof percent !== 'number' || percent < 50 || percent > 100) {
      return { result: false, reason: 'percent must be between 50 and 100' };
    }
    v.charge.charge_limit_soc = percent;
  },
};

export const SUPPORTED_COMMANDS = Object.keys(COMMANDS);
