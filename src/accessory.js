const http = require('http');

class DiffuserAccessory {
  constructor(platform, accessory, config) {
    this.platform = platform;
    this.accessory = accessory;
    this.config = config;
    this.log = platform.log;

    // Cloud Config
    this.nid = config.nid;
    this.token = config.token;
    this.username = config.username;
    // Generic App ID verified from LBSLM cloud traffic analysis.
    this.appid = config.appid || '19987617';
    this.uid = config.uid;
    this.sessionId = config.sessionId;

    if (!this.token || !this.nid || !this.sessionId) {
      this.log.error('Initialization failed: Cloud credentials missing. Auto-Discovery may have returned incomplete data.');
    }

    // Base URL components
    this.hostname = 'amos.us.lbslm.com';
    this.basePath = '/amosFragrance';

    // Headers setup
    this.headers = {
      'Host': 'amos.us.lbslm.com',
      'Accept': '*/*',
      'User-Agent': 'UPerfume/2.1.5 (iPhone; iOS 26.3; Scale/3.00)',
      'Accept-Language': 'en-US;q=1',
      'Connection': 'keep-alive',
      'Cookie': `appid=${this.appid};uid=${this.uid};token=${this.token};SESSIONID=${this.sessionId};username=${this.username}`
    };

    // Child Lock
    if (!this.service.testCharacteristic(this.platform.api.hap.Characteristic.LockPhysicalControls)) {
      this.service.addCharacteristic(this.platform.api.hap.Characteristic.LockPhysicalControls);
    }

    this.service.getCharacteristic(this.platform.api.hap.Characteristic.LockPhysicalControls)
      .onSet(this.setLock.bind(this));

    this.lockService = this.service; // Alias for consistency

    // Filter Service (Oil Level)
    this.filterService = this.accessory.getService(this.platform.api.hap.Service.FilterMaintenance) ||
      this.accessory.addService(this.platform.api.hap.Service.FilterMaintenance);

    this.filterService.getCharacteristic(this.platform.api.hap.Characteristic.FilterChangeIndication)
      .onGet(async () => {
        const level = await this.getOilLevel();
        return level < 10 ? this.platform.api.hap.Characteristic.FilterChangeIndication.CHANGE_FILTER
          : this.platform.api.hap.Characteristic.FilterChangeIndication.FILTER_OK;
      });

    this.filterService.getCharacteristic(this.platform.api.hap.Characteristic.FilterLifeLevel)
      .onGet(this.getOilLevel.bind(this));

    this.filterService.getCharacteristic(this.platform.api.hap.Characteristic.ResetFilterIndication)
      .onSet(this.resetFilter.bind(this));

    this.oilLevel = 100; // Cache

    this.service = this.accessory.getService(this.platform.api.hap.Service.Fan) ||
      this.accessory.addService(this.platform.api.hap.Service.Fan);

    this.service.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    this.service.getCharacteristic(this.platform.api.hap.Characteristic.RotationSpeed)
      .onSet(this.setRotationSpeed.bind(this))
      .onGet(this.getRotationSpeed.bind(this));

    // Optional: Mist Level (RotationSpeed) if we find the command later
    // this.service.getCharacteristic(this.platform.api.hap.Characteristic.RotationSpeed) ...

    // Poll status periodically to maintain synchronization with physical device state.
    this.oilLevel = 100;
    this.timerCache = null;
    this.pollStatus();
    setInterval(() => this.pollStatus(), 30000);
  }

  async setRotationSpeed(value) {
    if (value === 0) {
      // If 0, maybe just turn off? Or do nothing?
      // Usually HomeKit handles 0 as Off. Use setOn(false) if desired.
      return;
    }

    // Map 0-100% HomeKit RotationSpeed to 5-300s Run time.
    // Device minimum run time is 5s.
    let runTime = Math.max(5, Math.round(value * 3));

    this.log.info(`Setting Intensity (Run Time) to: ${runTime}s (${value}%)`);
    try {
      await this.updateTimerIntensity(runTime);
    } catch (e) {
      this.log.error('Failed to set intensity:', e.message);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getRotationSpeed() {
    if (this.timerCache) {
      const run = this.timerCache.run || 0;
      return Math.min(100, Math.round(run / 3));
    }
    return 50; // Default
  }

  async updateTimerIntensity(newRunTime) {
    // 1. Get current timer (or use cache if fresh)
    // 1. Get current timer (or use cache if fresh)
    let listJson;
    try {
      listJson = await this._callApi('/timerList.do', { isBluetooth: 0 });
    } catch (error) {
      this.log.warn("Failed to fetch timer list, cannot set intensity: " + error.message);
      throw error;
    }
    if (!listJson || !listJson.data || !listJson.data.length) {
      throw new Error('No timers found to update intensity');
    }

    const timer = listJson.data[0];
    this.timerCache = timer; // Update cache

    // 2. Update it
    // Preserve existing suspend time to respect user configuration.

    const params = {
      timerId: timer.timerId,
      uid: timer.uid,
      name: timer.name,
      start: timer.start,
      stop: timer.stop,
      mode: timer.mode,
      run: newRunTime,
      suspend: timer.suspend // Keep existing suspend
    };

    await this._callApi('/updateTimer.do', params);
  }
  async setLock(value) {
    // value: 1 = LOCKED, 0 = UNLOCKED
    const isLocked = value === this.platform.api.hap.Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED;
    // Lock control endpoint has not been identified in current API analysis.
    // Logging warning and handling as read-only status.
    this.log.warn('Lock control not yet implemented/captured. Only status is reported.');

    // Revert UI to match actual state (polled later)
    setTimeout(() => {
      this.pollStatus();
    }, 1000);
  }

  async setOn(value) {
    this.log.info(`Setting state to: ${value ? 'ON' : 'OFF'}`);
    const endpoint = value ? '/openFragrance.do' : '/closeFragrance.do';

    try {
      await this._callApi(endpoint);
      this.isOn = value;
    } catch (error) {
      this.log.error('Failed to set state:', error.message);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getOn() {
    return this.isOn;
  }

  async _callApi(path, params = {}, retryCount = 0) {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now() / 1000;
      // Merge params with default query params
      const queryParams = new URLSearchParams({
        nid: this.nid,
        timestamp: timestamp,
        ...params
      }).toString();

      const options = {
        hostname: this.hostname,
        port: 80,
        path: `${this.basePath}${path}?${queryParams}`,
        method: 'GET',
        headers: {
          ...this.headers,
          'Cookie': `appid=${this.appid};uid=${this.uid};token=${this.token};SESSIONID=${this.sessionId};username=${this.username}`
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', async () => {
          if (res.statusCode === 200) {
            try {
              const json = JSON.parse(data);

              if (json.status === 'AuthenticationException' || json.status === '401') {
                if (retryCount < 1) {
                  this.log.debug(`Refeshing session for ${path}`);
                  try {
                    const newCreds = await this.platform.refreshSession();
                    this.token = newCreds.token;
                    this.uid = newCreds.uid;
                    this.sessionId = newCreds.sessionId;
                    
                    const result = await this._callApi(path, params, retryCount + 1);
                    resolve(result);
                    return;
                  } catch (refreshErr) {
                    reject(new Error("Session refresh failed: " + refreshErr.message));
                    return;
                  }
                } else {
                  reject(new Error("Authentication failed even after refresh."));
                  return;
                }
              }

              if (json.status === '200') {
                this.log.debug(`API Success: ${path}`);
                resolve(json);
              } else {
                reject(new Error(`API returned status ${json.status}: ${JSON.stringify(json)}`));
              }
            } catch (e) {
              // Handle non-JSON responses (e.g., HTML error pages)
              reject(new Error(`Invalid API response: ${data.substring(0, 50)}...`));
            }
          } else {
            reject(new Error(`API HTTP Error ${res.statusCode}`));
          }
        });
      });

      req.on('error', (e) => {
        this.log.error(`API Error calling ${path}:`, e.message);
        reject(e);
      });

      req.end();
    });
  }
}

module.exports = DiffuserAccessory;
