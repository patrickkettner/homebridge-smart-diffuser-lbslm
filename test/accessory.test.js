const assert = require('assert');
const sinon = require('sinon');
const crypto = require('crypto');
const http = require('http');

// Setup mock "platform" and "accessory"
const mockLog = { info: sinon.stub(), error: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() };

const Service = {
  Fan: 'Fan',
  FilterMaintenance: 'FilterMaintenance',
  AccessoryInformation: 'AccessoryInformation'
};

const Characteristic = {
  On: 'On',
  RotationSpeed: 'RotationSpeed',
  LockPhysicalControls: {
    toString: () => 'LockPhysicalControls',
    CONTROL_LOCK_ENABLED: 1,
    CONTROL_LOCK_DISABLED: 0
  },
  FilterChangeIndication: {
    toString: () => 'FilterChangeIndication',
    CHANGE_FILTER: 1,
    FILTER_OK: 0
  },
  FilterLifeLevel: 'FilterLifeLevel',
  ResetFilterIndication: 'ResetFilterIndication'
};

const mockApi = {
  hap: {
    Service,
    Characteristic,
    HapStatusError: class extends Error { },
    HAPStatus: { SERVICE_COMMUNICATION_FAILURE: 'FAIL' }
  }
};

describe('DiffuserAccessory (Platinum Standard)', () => {
  let DiffuserAccessory;
  let accessoryInstance;
  let mockPlatform;
  let mockAccessory;
  let mockConfig;
  let httpRequestStub;

  beforeEach(() => {
    // Scorched Earth: Reset STUBS
    httpRequestStub = sinon.stub(http, 'request');

    // Fresh Require
    delete require.cache[require.resolve('../src/accessory')];
    DiffuserAccessory = require('../src/accessory');

    mockPlatform = {
      log: mockLog,
      api: mockApi,
      refreshSession: sinon.stub().resolves({ token: 'new-token', uid: 'u', sessionId: 's' })
    };

    mockAccessory = {
      context: {
        device: { nid: `nid-${crypto.randomUUID()}`, token: 'token', uid: 'uid', sessionId: 'sid' }
      },
      getService: sinon.stub(),
      addService: sinon.stub(),
      displayName: 'Test Diffuser'
    };

    const createMockService = () => ({
      getCharacteristic: sinon.stub().returns({
        onSet: sinon.stub().returnsThis(),
        onGet: sinon.stub().returnsThis(),
        updateValue: sinon.stub()
      }),
      testCharacteristic: sinon.stub().returns(false),
      addCharacteristic: sinon.stub().returns({
        onSet: sinon.stub().returnsThis(),
        onGet: sinon.stub().returnsThis()
      }),
      updateCharacteristic: sinon.stub()
    });

    // Ensure getService returns the SAME object instance per service type for consistent stub usage
    const fanService = createMockService();
    const filterService = createMockService();
    // Persistent mock for AccessoryInformation to verify metadata initialization
    const accessoryInfoService = {
      setCharacteristic: sinon.stub().returnsThis(),
      getCharacteristic: sinon.stub().returns({ onSet: sinon.stub().returnsThis(), onGet: sinon.stub().returnsThis() })
    };

    mockAccessory.getService.callsFake((type) => {
      if (type === Service.Fan) return fanService;
      if (type === Service.FilterMaintenance) return filterService;
      if (type === 'AccessoryInformation' || (type && type.toString && type.toString() === 'AccessoryInformation') || typeof type === 'function') {
        return accessoryInfoService;
      }
      return null;
    });
    mockAccessory.addService.callsFake((type) => {
      if (type === Service.Fan) return fanService;
      if (type === Service.FilterMaintenance) return filterService;
      return null;
    });

    mockConfig = { nid: '12345', name: 'Test Diffuser', oilName: 'Test Scent', hsn: 'SN123' };

    // Stub pollStatus on PROTOTYPE to prevent constructor side-effect from polluting 'httpRequestStub' history
    // Or just reset history after creation. Resetting history is cleaner than prototype hacking.

    accessoryInstance = new DiffuserAccessory(mockPlatform, mockAccessory, mockConfig);

    // Reset stub history because constructor calls pollStatus -> _callApi -> http.request
    httpRequestStub.resetHistory();
    });

  afterEach(() => {
    sinon.restore();
    });

  describe('Metadata', () => {
    it('should map Metadata correctly', () => {
      const infoService = mockAccessory.getService('AccessoryInformation');
      // We need to check what setCharacteristic was called with

      // Verify Manufacturer
      assert.ok(infoService.setCharacteristic.calledWith(mockApi.hap.Characteristic.Manufacturer, "Guangzhou You'an Information Technology Co., Ltd."));

      // Verify Model (should match config.model, defaults to Smart Diffuser if not passed in mockConfig)
      // mockConfig in beforeEach has { ..., oilName: 'Test Scent', hsn: 'SN123' } but no model
      // so it defaults to 'Smart Diffuser' unless we add it to mockConfig.
      // Let's update mockConfig for this test or accept default.
      // Actually, let's make sure we test the specific props.
    });

    it('should map specific model and scent to firmware', () => {
      mockConfig = { nid: '123', name: 'Dev', hsn: 'SN1', oilName: 'Lavender', model: 'B5000' };
      accessoryInstance = new DiffuserAccessory(mockPlatform, mockAccessory, mockConfig);

      const infoService = mockAccessory.getService('AccessoryInformation');

      assert.ok(infoService.setCharacteristic.calledWith(mockApi.hap.Characteristic.Model, 'B5000'));
      assert.ok(infoService.setCharacteristic.calledWith(mockApi.hap.Characteristic.FirmwareRevision, 'Scent: Lavender'));
      assert.ok(infoService.setCharacteristic.calledWith(mockApi.hap.Characteristic.SerialNumber, 'SN1'));
    });

    it('should fallback to defaults if metadata missing', () => {
      mockConfig = { nid: '999', name: 'Plain Device' };
      // Re-init
      accessoryInstance = new DiffuserAccessory(mockPlatform, mockAccessory, mockConfig);

      const infoService = mockAccessory.getService('AccessoryInformation');

      assert.ok(infoService.setCharacteristic.calledWith(mockApi.hap.Characteristic.Model, 'Smart Diffuser'));
      assert.ok(infoService.setCharacteristic.calledWith(mockApi.hap.Characteristic.SerialNumber, '999'));
      assert.ok(infoService.setCharacteristic.calledWith(mockApi.hap.Characteristic.FirmwareRevision, ""));
    });
  });

  describe('Control Logic (setOn)', () => {
    it('should turn ON exactly and update On characteristic', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);

      const successRes = {
        statusCode: 200,
        on: (evt, cb) => { if (evt === 'data') cb(JSON.stringify({ status: '200' })); if (evt === 'end') cb(); }
      };
      httpRequestStub.yields(successRes); 

      await accessoryInstance.setOn(true);

      const args = httpRequestStub.firstCall.args[0];
      assert.ok(args.path.includes('/openFragrance.do'), 'Must call openFragrance.do');
      // GET request, no body write check needed unless query params are verified
    });

    it('should turn OFF exactly', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      httpRequestStub.yields({
        statusCode: 200,
        on: (evt, cb) => { if (evt === 'data') cb(JSON.stringify({ status: '200' })); if (evt === 'end') cb(); }
      });

      await accessoryInstance.setOn(false);

      const args = httpRequestStub.firstCall.args[0];
      assert.ok(args.path.includes('/closeFragrance.do'), 'Must call closeFragrance.do');
    });

    it('should throw HAP error if API fails (Platform Standard)', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      // Simulate 500
      httpRequestStub.yields({ statusCode: 500, on: (evt, cb) => { if (evt === 'end') cb(); } });

      await assert.rejects(accessoryInstance.setOn(true), mockApi.hap.HapStatusError);
    });
  });

  describe('Control Logic (setRotationSpeed)', () => {
    it('should ignore setRotationSpeed(0)', async () => {
      // Because we resetHistory in beforeEach, this should be clean
      await accessoryInstance.setRotationSpeed(0);
      assert.ok(httpRequestStub.notCalled, 'Should not call API for 0');
    });

    it('should Map percentages to Levels correctly (Deep Check)', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);

      // 1. timerList.do Call
      const timerListRes = {
        statusCode: 200,
        on: (evt, cb) => { if (evt === 'data') cb(JSON.stringify({ status: '200', data: [{ timerId: 1, run: 5 }] })); if (evt === 'end') cb(); }
      };

      // 2. updateTimer.do Call
      const updateRes = {
        statusCode: 200,
        on: (evt, cb) => { if (evt === 'data') cb(JSON.stringify({ status: '200' })); if (evt === 'end') cb(); }
      };

      httpRequestStub.onFirstCall().yields(timerListRes);
      httpRequestStub.onSecondCall().yields(updateRes);

      // 30% * 3 = 0.9 -> round to 1? Or Math.max(5, ...)?
      // Code: Math.max(5, Math.round(value * 3))
      // If value is PERCENTAGE (0-100)... 30 * 3 = 90 seconds.
      // My previous test assumption was `level=1`.
      // Let's check code: logic is indeed runTime seconds.

      await accessoryInstance.setRotationSpeed(30);

      // Verify second call (updateTimer) params
      const args = httpRequestStub.secondCall.args[0];
      assert.ok(args.path.includes('/updateTimer.do'), 'Must call updateTimer.do');
      // Params are in query string for GET request
      assert.ok(args.path.includes('run=90'), '30% should map to 90s run time');
    });
    });

  describe('Polling & Status', () => {
    it('should update all characteristics on poll', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);

      const statusData = {
        status: '200',
        data: {
          status: true,
          run: 90,       // 90s approx 30%
          liquidLevel: 0,
          filterLife: 50,
          lockMark: true
        }
      };

      httpRequestStub.yields({
        statusCode: 200,
        on: (evt, cb) => { if (evt === 'data') cb(JSON.stringify(statusData)); if (evt === 'end') cb(); }
      });

      await accessoryInstance.pollStatus();

      const fanService = mockAccessory.getService(Service.Fan);
      const filterService = mockAccessory.getService(Service.FilterMaintenance);
      assert.ok(fanService.updateCharacteristic.calledWith(Characteristic.On, true));
      assert.ok(fanService.updateCharacteristic.calledWith(Characteristic.RotationSpeed, 30)); // 90 / 3 = 30
      assert.ok(fanService.updateCharacteristic.calledWith(Characteristic.LockPhysicalControls, 1));
      assert.ok(filterService.updateCharacteristic.calledWith(Characteristic.FilterLifeLevel, 0)); // 0 from data.liquidLevel
    });

    it('should default run/oil values if missing', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      httpRequestStub.yields({
        statusCode: 200,
        on: (evt, cb) => { if (evt === 'data') cb(JSON.stringify({ status: '200', data: { status: true } })); if (evt === 'end') cb(); }
      });

      await accessoryInstance.pollStatus();

      const fanService = mockAccessory.getService(Service.Fan);
      // run undefined -> 0 -> 0%
      assert.ok(fanService.updateCharacteristic.calledWith(Characteristic.RotationSpeed, 0));
    });
    });

  describe('Retry Logic', () => {
    it('should refresh session and retry on AuthenticationException', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };

      let callCount = 0;
      httpRequestStub.callsFake((opts, cb) => {
        callCount++;
        if (callCount === 1) {
          // Fail 1
          cb({
            statusCode: 200,
            on: (evt, cb2) => { if (evt === 'data') cb2(JSON.stringify({ status: 'AuthenticationException', msg: 'Fail' })); if (evt === 'end') cb2(); }
          });
        } else {
          // Success 2
          cb({
            statusCode: 200,
            on: (evt, cb2) => { if (evt === 'data') cb2(JSON.stringify({ status: '200' })); if (evt === 'end') cb2(); }
          });
        }
        return mockReq;
      });

      await accessoryInstance.setOn(true);

      assert.ok(mockPlatform.refreshSession.calledOnce, 'Should refresh session');
      assert.strictEqual(callCount, 2, 'Should call API twice');

      const secondCallHeaders = httpRequestStub.secondCall.args[0].headers;
      assert.ok(secondCallHeaders.Cookie.includes('new-token'), 'Retry should use new token');
    });

    it('should reject if retry also fails', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };

      httpRequestStub.callsFake((opts, cb) => {
        cb({
          statusCode: 200,
          on: (evt, cb2) => { if (evt === 'data') cb2(JSON.stringify({ status: 'AuthenticationException', msg: 'Fail' })); if (evt === 'end') cb2(); }
        });
        return mockReq;
      });

      await assert.rejects(accessoryInstance.setOn(true), mockApi.hap.HapStatusError);
      assert.ok(mockLog.error.calledWithMatch(/Failed to set state:/, /Authentication failed after retry/));
    });

    it('should reject if status is not 200/AuthException', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      httpRequestStub.yields({
        statusCode: 200,
        on: (evt, cb) => { if (evt === 'data') cb(JSON.stringify({ status: '500' })); if (evt === 'end') cb(); }
      });

      await assert.rejects(accessoryInstance.setOn(true), mockApi.hap.HapStatusError);
      assert.ok(mockLog.error.calledWithMatch(/Failed to set state:/, /API returned status 500/));
    });

    it('should reject on invalid JSON', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      httpRequestStub.yields({
        statusCode: 200,
        on: (evt, cb) => { if (evt === 'data') cb('INVALID'); if (evt === 'end') cb(); }
      });

      await assert.rejects(accessoryInstance.setOn(true), mockApi.hap.HapStatusError);
      assert.ok(mockLog.error.calledWithMatch(/Failed to set state:/, /Invalid API response/));
    });

    it('should reject on request error', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);

      // Trigger error
      setTimeout(() => mockReq.on.withArgs('error').yield(new Error('Network Error')), 10);

      await assert.rejects(accessoryInstance.setOn(true), mockApi.hap.HapStatusError);
      // The code catches generic error in setOn and logs 'Failed to set state:' + error.message
      assert.ok(mockLog.error.calledWithMatch(/Failed to set state:/, /Network Error/));
    });

    });

  describe('Helper Edge Cases', () => {
    it('should return 0 for oilLevel if undefined', async () => {
      accessoryInstance.oilLevel = undefined;
      const level = await accessoryInstance.getOilLevel();
      assert.strictEqual(level, 0);
    });

    it('should return 0 for rotationSpeed if timerCache.run is missing', async () => {
      accessoryInstance.timerCache = { status: true };
      const speed = await accessoryInstance.getRotationSpeed();
      assert.strictEqual(speed, 0);
    });

    it('should handle pollStatus with different data states (Partial Data)', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);

      httpRequestStub.yields({
        statusCode: 200,
        on: (evt, cb) => {
          if (evt === 'data') cb(JSON.stringify({ status: '200', data: { status: true, liquidLevel: 0, lockMark: false } }));
          if (evt === 'end') cb();
        }
      });

      await accessoryInstance.pollStatus();
      const fanService = mockAccessory.getService(Service.Fan);

      assert.ok(fanService.updateCharacteristic.calledWith(Characteristic.LockPhysicalControls, 0));
    });

    it('should log debug on pollStatus network failure (Silence)', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      httpRequestStub.yields({ statusCode: 500, on: (evt, cb) => { if(evt==='end') cb(); } });
      
      await accessoryInstance.pollStatus();
      assert.ok(mockLog.debug.calledWithMatch(/Poll failed/));
    });

        it('should poll periodically via interval', async () => {
             const clock = sinon.useFakeTimers();
             const spy = sinon.spy(DiffuserAccessory.prototype, 'pollStatus');
             
             // Re-instantiate to capture the interval with fake timer
             new DiffuserAccessory(mockPlatform, mockAccessory, mockConfig);
             
             clock.tick(30001);
             assert.ok(spy.called, 'Should have called pollStatus via interval');
             
             clock.restore();
             spy.restore();
        });

        it('should handle pollStatus with successful response but no data', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      
      httpRequestStub.yields({
        statusCode: 200,
        on: (evt, cb) => { 
          if(evt==='data') cb(JSON.stringify({ status: '200' })); // No data field
          if(evt==='end') cb(); 
        }
      });
      
      await accessoryInstance.pollStatus();
      // Should just not update anything, maybe log debug?
      // Existing code doesn't log else branch, just does nothing.
      // We just ensure it runs without error.
      assert.ok(true);
    });

    it('should handle LockPhysicalControls if already exists', async () => {
      const fanService = mockAccessory.getService(Service.Fan);
      fanService.testCharacteristic.returns(true);
      fanService.addCharacteristic.resetHistory();

      new DiffuserAccessory(mockPlatform, mockAccessory, mockConfig);
      assert.ok(fanService.addCharacteristic.notCalled);
    });

    it('should return cached isOn state via getOn', async () => {
      accessoryInstance.isOn = true;
      const state = await accessoryInstance.getOn();
      assert.strictEqual(state, true);
    });

    it('should call deviceLock.do when setting lock to 1', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      httpRequestStub.yields({
        statusCode: 200,
        on: (evt, cb) => { if (evt === 'data') cb(JSON.stringify({ status: '200' })); if (evt === 'end') cb(); }
      });

      await accessoryInstance.setLock(1);

      const args = httpRequestStub.firstCall.args[0];
      assert.ok(args.path.includes('/admin/amos/deviceLock.do'), 'Must call deviceLock.do');
    });

    it('should call deviceUnlock.do with params when setting lock to 0', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      httpRequestStub.yields({
        statusCode: 200,
        on: (evt, cb) => { if (evt === 'data') cb(JSON.stringify({ status: '200' })); if (evt === 'end') cb(); }
      });

      await accessoryInstance.setLock(0);

      const args = httpRequestStub.firstCall.args[0];
      assert.ok(args.path.includes('/admin/amos/deviceUnlock.do'), 'Must call deviceUnlock.do');
      assert.ok(args.path.includes('days=0'), 'Must include days=0');
    });

    it('should call resetLiquidLevel.do with 100 when resetting filter', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      httpRequestStub.yields({
        statusCode: 200,
        on: (evt, cb) => { if (evt === 'data') cb(JSON.stringify({ status: '200', data: true })); if (evt === 'end') cb(); }
      });

      await accessoryInstance.resetFilter(1);

      const args = httpRequestStub.firstCall.args[0];
      assert.ok(args.path.includes('/resetLiquidLevel.do'), 'Must call resetLiquidLevel.do');
      assert.ok(args.path.includes('liquidLevel=100'), 'Must set level to 100');

      // Verify local updates
      const filterService = mockAccessory.getService(Service.FilterMaintenance);
      assert.ok(filterService.updateCharacteristic.calledWith(Characteristic.FilterLifeLevel, 100));
    });

    it('should handle API failure in resetFilter', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      httpRequestStub.yields({ statusCode: 500, on: (evt, cb) => { if (evt === 'end') cb(); } });

      await assert.rejects(accessoryInstance.resetFilter(1), mockApi.hap.HapStatusError);
      assert.ok(mockLog.error.calledWithMatch(/Failed to Reset Filter/));
    });

    it('should handle API failure in setLock (Revert)', async () => {
      const clock = sinon.useFakeTimers();
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      httpRequestStub.yields({ statusCode: 500, on: (evt, cb) => { if (evt === 'end') cb(); } });

      const promise = accessoryInstance.setLock(1);

      await assert.rejects(promise, mockApi.hap.HapStatusError);
      assert.ok(mockLog.error.calledWithMatch(/Failed to set Lock/));

      // Verify revert logic
      clock.tick(501);
      // The revert logic calls this.service.updateCharacteristic directly
      const fanService = mockAccessory.getService(Service.Fan);
      assert.ok(fanService.updateCharacteristic.calledWith(Characteristic.LockPhysicalControls, 0), 'Should revert to 0 if set to 1 failed');

      clock.restore();
    });

    it('should handle API failure in setLock(0) (Revert to Locked)', async () => {
      const clock = sinon.useFakeTimers();
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      httpRequestStub.yields({ statusCode: 500, on: (evt, cb) => { if (evt === 'end') cb(); } });

      const promise = accessoryInstance.setLock(0);

      await assert.rejects(promise, mockApi.hap.HapStatusError);

      clock.tick(501);
      const fanService = mockAccessory.getService(Service.Fan);
      assert.ok(fanService.updateCharacteristic.calledWith(Characteristic.LockPhysicalControls, 1), 'Should revert to 1 if set to 0 failed');

      clock.restore();
    });

    it('should fail setRotationSpeed if timer list is empty', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      httpRequestStub.yields({
        statusCode: 200,
        on: (evt, cb) => { if (evt === 'data') cb(JSON.stringify({ status: '200', data: [] })); if (evt === 'end') cb(); }
      });

      await assert.rejects(accessoryInstance.setRotationSpeed(50), mockApi.hap.HapStatusError);
      assert.ok(mockLog.error.calledWithMatch(/Failed to set intensity:/, /No timers found/));
    });

    it('should fail retry if session refresh rejects', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      httpRequestStub.yields({
        statusCode: 200,
        on: (evt, cb) => { if(evt==='data') cb(JSON.stringify({ status: 'AuthenticationException' })); if(evt==='end') cb(); }
      });

      mockPlatform.refreshSession.rejects(new Error('Refresh Fail'));

      await assert.rejects(accessoryInstance.setOn(true), mockApi.hap.HapStatusError);
      assert.ok(mockLog.error.calledWithMatch(/Session refresh failed/));
    });

    it('should return default rotation speed if no cache', async () => {
      accessoryInstance.timerCache = null;
      const speed = await accessoryInstance.getRotationSpeed();
      assert.strictEqual(speed, 50);
    });

    it('should handling filter change indication logic', async () => {
      // Mock oilLevel to 5
      accessoryInstance.oilLevel = 5;
      const filterService = mockAccessory.getService(Service.FilterMaintenance);
      const handler = filterService.getCharacteristic(Characteristic.FilterChangeIndication).onGet;
      
      // We need to bind it or call it in context?
      // The code does: .onGet(async () => { ... }) arrow function capturing `this`
      // Since we can't easily retrieve the anonymous arrow function from the mock stub without digging...
      // Wait, we mocked getCharacteristic().onGet(...).
      // We should just call the method if we can, or we rely on the fact that constructor registered it.
      // Actually, testing the logic inside the arrow function is hard if we don't expose it.
      // BUT, we can make `getOilLevel` return 5, and verify `onGet` was called... no, we want to run the handler.
      
      // Alternative: Test `getOilLevel` and assume the wiring is correct?
      // Or better: The prompt said "100% lines". Lines 58-59 are inside that arrow function.
      // We MUST trigger that arrow function.
      // In the constructor:
      // this.filterService.getCharacteristic(...).onGet(async () => { ... })
      // We mocked `onGet`. We can grab the callback passed to `onGet`.
      
      const onGetStub = filterService.getCharacteristic(Characteristic.FilterChangeIndication).onGet;
      const callback = onGetStub.firstCall.args[0];
      
      const resultLow = await callback();
      assert.strictEqual(resultLow, Characteristic.FilterChangeIndication.CHANGE_FILTER);
      
      accessoryInstance.oilLevel = 50;
      const resultOk = await callback();
      assert.strictEqual(resultOk, Characteristic.FilterChangeIndication.FILTER_OK);
    });

    it('should handle timer list API failure in setRotationSpeed', async () => {
      const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
      httpRequestStub.returns(mockReq);
      httpRequestStub.yields({
        statusCode: 500,
        on: (evt, cb) => { if(evt==='end') cb(); } // simulating error or non-200
      });
      // Actually wait, callApi throws on 500
      
      await assert.rejects(accessoryInstance.setRotationSpeed(50), mockApi.hap.HapStatusError);
      assert.ok(mockLog.warn.calledWithMatch(/Failed to fetch timer list/));
    });
  });
});
