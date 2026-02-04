const DiffuserAccessory = require('./accessory');
const AuthClient = require("./auth");

const PLUGIN_NAME = 'homebridge-smart-diffuser-lbslm';
const PLATFORM_NAME = 'SmartDiffuserLBSLM';

class DiffuserPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessories = [];

    this.api.on('didFinishLaunching', () => {
      // Strict Auto-Discovery
      if (this.config.email && this.config.password) {
        this.log.info("Starting auto-discovery...");
        this.autoDiscover();
      } else {
        this.log.error('Please provide Email and Password in config.json');
      }
    });
  }

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }

  async autoDiscover() {
    const auth = new AuthClient(this.log, this.config.region);
    try {
      const creds = await auth.getCredentials(this.config.email, this.config.password);
      if (creds) {
        this.log.info(`Auto-discovery successful! Found Device NID: ${creds.nid}`);
        this.log.info(`Token: ${creds.token.substring(0, 10)}...`);

        // Proceed to device registration with discovered devices.
        this.discoverDevices(creds.devices, {
          token: creds.token,
          uid: creds.uid,
          sessionId: creds.sessionId
        });
      }
    } catch (error) {
      this.log.error("Auto-discovery failed: " + error.message);
    }
  }

  async refreshSession() {
    // Deduplicate refresh requests
    if (this._refreshPromise) {
      return this._refreshPromise;
    }

    this._refreshPromise = this._executeRefresh().finally(() => {
      this._refreshPromise = null;
    });

    return this._refreshPromise;
  }

  async _executeRefresh() {
    this.log.info("Session expired. Refreshing credentials...");
    if (!this.config.email || !this.config.password) {
      throw new Error("Cannot refresh session: No Email/Password configured.");
    }

    const auth = new AuthClient(this.log, this.config.region);
    try {
      const creds = await auth.getCredentials(this.config.email, this.config.password);
      this.log.info("Session refreshed successfully.");
      return {
        token: creds.token,
        uid: creds.uid,
        sessionId: creds.sessionId
      };
    } catch (error) {
      this.log.error("Failed to refresh session:", error.message);
      throw error;
    }
  }

  discoverDevices(devices, sessionCreds) {
    // If we have a list of devices from auto-discovery, use them.
    if (devices && devices.length > 0) {
      devices.forEach(device => {
        const deviceConfig = {
          name: device.nickname || device.deviceAlias || device.hsn || 'Smart Diffuser',
          nid: device.nid.toString(),
          token: sessionCreds.token,
          username: this.config.email,
          appid: this.config.appid || '19987617',
          uid: sessionCreds.uid,
          sessionId: sessionCreds.sessionId,
          oilName: device.oilName,
          model: (device.deviceType && device.deviceType.typeCode) ? device.deviceType.typeCode : 'Smart Diffuser'
        };
        this.addAccessory(deviceConfig);
      });
    } else {
      // Should not happen with strict auto-discovery, but safety check.
      this.log.error("No devices found to register.");
    }
  }

  addAccessory(deviceConfig) {

    if (!deviceConfig.token || !deviceConfig.nid) {
      this.log.error('Cannot register accessory: Missing token or NID from Auto-Discovery.');
      return;
    }
    const uuid = this.api.hap.uuid.generate(deviceConfig.nid);
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      if (existingAccessory.displayName !== deviceConfig.name) {
        this.log.info(`Updating Accessory Name: ${existingAccessory.displayName} -> ${deviceConfig.name}`);
        existingAccessory.displayName = deviceConfig.name;
        this.api.updatePlatformAccessories([existingAccessory]);
      }
      new DiffuserAccessory(this, existingAccessory, deviceConfig);
    } else {
      this.log.info('Adding new accessory:', deviceConfig.name);
      const accessory = new this.api.platformAccessory(deviceConfig.name, uuid);
      new DiffuserAccessory(this, accessory, deviceConfig);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }
}

module.exports = DiffuserPlatform;
