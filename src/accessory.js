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
    this.isOn = false;

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

    // Update Accessory Information
    this.accessory.getService(this.platform.api.hap.Service.AccessoryInformation)
      .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, "Guangzhou You'an Information Technology Co., Ltd.")
      .setCharacteristic(this.platform.api.hap.Characteristic.Model, this.config.model || 'Smart Diffuser')
      .setCharacteristic(this.platform.api.hap.Characteristic.SerialNumber, this.config.hsn || this.config.nid)
      .setCharacteristic(this.platform.api.hap.Characteristic.FirmwareRevision, this.config.oilName ? `Scent: ${this.config.oilName}` : "")
      .setCharacteristic(this.platform.api.hap.Characteristic.Name, this.config.name);

    // Services Setup
    this.service = this.accessory.getService(this.platform.api.hap.Service.Fan) ||
      this.accessory.addService(this.platform.api.hap.Service.Fan);




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

    // Poll status periodically to maintain synchronization with physical device state.
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
    this.log.info(`Setting Lock to: ${value} (via Cloud API)`);

    try {
      if (value) {
        // Lock: /admin/amos/deviceLock.do
        await this._callApi('/admin/amos/deviceLock.do');
      } else {
        // Unlock: /admin/amos/deviceUnlock.do?days=0&name=
        await this._callApi('/admin/amos/deviceUnlock.do', { days: 0, name: '' });
      }

      // Optimistically update cache or poll
      setTimeout(() => this.pollStatus(), 1000);
    } catch (error) {
      this.log.error('Failed to set Lock:', error.message);
      this.log.warn('Reverting Lock usage due to API failure.');
      setTimeout(() => {
        this.service.updateCharacteristic(this.platform.api.hap.Characteristic.LockPhysicalControls, !value ? 1 : 0);
      }, 500);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
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

      // Determine full path: if path starts with /admin, treat as root-relative. 
      // Otherwise prepend basePath (/amosFragrance).
      const resourcePath = path.startsWith('/admin') ? path : `${this.basePath}${path}`;

      const options = {
        hostname: this.hostname,
        port: 80,
        path: `${resourcePath}?${queryParams}`,
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
                  this.log.warn('Auth token expired. Refreshing session...');
                  try {
                    const creds = await this.platform.refreshSession();
                    this.token = creds.token;
                    this.uid = creds.uid;
                    this.sessionId = creds.sessionId;
                    
                    return resolve(this._callApi(path, params, retryCount + 1));
                  } catch (err) {
                    this.log.error('Session refresh failed:', err.message);
                    reject(err);
                  }
                } else {
                  reject(new Error('Authentication failed after retry'));
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

  async getOilLevel() {
    return this.oilLevel || 0;
  }

  async resetFilter(value) {
    this.log.info(`Request to Reset Filter (Setting Liquid Level to 100% via Cloud API)`);
    try {
      // Endpoint confirmed by user: /amosFragrance/resetLiquidLevel.do?liquidLevel=100
      await this._callApi('/resetLiquidLevel.do', { liquidLevel: 100 });

      // Update local cache immediately
      this.oilLevel = 100;
      this.filterService.updateCharacteristic(this.platform.api.hap.Characteristic.FilterLifeLevel, 100);
      this.filterService.updateCharacteristic(this.platform.api.hap.Characteristic.FilterChangeIndication, this.platform.api.hap.Characteristic.FilterChangeIndication.FILTER_OK);

      this.log.info('Filter Reset Successful');
    } catch (error) {
      this.log.error('Failed to Reset Filter:', error.message);
      // Revert the "Reset" switch if possible, though it's stateless.
      // We should probably just log.
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async pollStatus() {
    this.log.debug('Polling device status...');
    try {
      const response = await this._callApi('/amosFragrance.do', { checkPermissions: 0 });
      if (response && response.data) {
        const data = response.data;

        // update cached values
        this.isOn = data.status === true;
        this.oilLevel = data.liquidLevel || 0;

        this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, this.isOn);
        this.filterService.updateCharacteristic(this.platform.api.hap.Characteristic.FilterLifeLevel, this.oilLevel);

        // Lock State
        const lockState = data.lockMark
          ? this.platform.api.hap.Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED
          : this.platform.api.hap.Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED;
        this.service.updateCharacteristic(this.platform.api.hap.Characteristic.LockPhysicalControls, lockState);

        // Rotation Speed (Run Time)
        // 300s = 100%, so divide by 3
        const speed = Math.min(100, Math.round((data.run || 0) / 3));
        this.service.updateCharacteristic(this.platform.api.hap.Characteristic.RotationSpeed, speed);

        this.log.debug('Poll success:', JSON.stringify(data));
      }
    } catch (e) {
      this.log.debug('Poll failed:', e.message);
    }
  }
}

module.exports = DiffuserAccessory;
