const assert = require('assert');
const sinon = require('sinon');
const crypto = require('crypto');
const DiffuserPlatform = require('../src/platform');
const AuthClient = require('../src/auth');

describe('DiffuserPlatform (Platinum Standard)', () => {
    let platform;
    let mockLog, mockConfig, mockApi;

    // "Scorched Earth" Policy
    beforeEach(() => {
        mockLog = { info: sinon.stub(), error: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() };
        mockConfig = { email: `test-${crypto.randomUUID()}@example.com`, password: 'password', region: 'CN' };
        mockApi = {
            on: sinon.stub(),
            hap: {
                uuid: { generate: sinon.stub().callsFake((val) => `uuid-${val}`) },
                Service: { Fan: 'Fan', FilterMaintenance: 'Filter' },
                Characteristic: {
                    On: 'On',
                    RotationSpeed: 'Speed',
                    LockPhysicalControls: 'Lock',
                    FilterChangeIndication: 'FilterChange',
                    FilterLifeLevel: 'FilterLive',
                    ResetFilterIndication: 'ResetFilter'
                },
                HapStatusError: class extends Error { },
                HAPStatus: { SERVICE_COMMUNICATION_FAILURE: 'FAIL' }
            },
            platformAccessory: class {
                constructor(name, uuid) {
                    this.UUID = uuid;
                    this.displayName = name;
                    this.context = {};
                }
                getService() { return null; }
                addService() {
                    return {
                        getCharacteristic: sinon.stub().returns({
                            onSet: sinon.stub().returnsThis(),
                            onGet: sinon.stub().returnsThis()
                        }),
                        testCharacteristic: sinon.stub().returns(false),
                        addCharacteristic: sinon.stub()
                    };
                }
            },
            registerPlatformAccessories: sinon.stub()
        };
        platform = new DiffuserPlatform(mockLog, mockConfig, mockApi);
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('Startup & Auto-Discovery', () => {
        it('should correctly register the "didFinishLaunching" handler', () => {
            // Assert
            assert.ok(mockApi.on.calledOnceWith('didFinishLaunching'));
        });

        it('should trigger Auto-Discovery when didFinishLaunching fires', () => {
            // Arrange
            const discoverStub = sinon.stub(platform, 'autoDiscover');
            const handler = mockApi.on.firstCall.args[1];

            // Act
            handler();

            // Assert
            assert.ok(discoverStub.calledOnce);
        });

        it('should log error if credentials are missing on startup', () => {
            // Arrange
            platform.config = {}; // No email/pass
            const handler = mockApi.on.firstCall.args[1];

            // Act
            handler();

            // Assert
            assert.ok(mockLog.error.calledWithMatch(/Please provide Email/));
        });

        it('should log error if password is missing but email is present on startup', () => {
            // Arrange
            platform.config = { email: 'test@example.com' };
            const handler = mockApi.on.firstCall.args[1];

            // Act
            handler();

            // Assert
            assert.ok(mockLog.error.calledWithMatch(/Please provide Email/));
        });
    });

    describe('autoDiscover()', () => {
        it('should fetch credentials and register devices on success', async () => {
            // Arrange
            const uniqueToken = crypto.randomUUID();
            const uniqueNid = `nid-${crypto.randomUUID()}`;

            const getCredsStub = sinon.stub(AuthClient.prototype, 'getCredentials')
                .resolves({
                    token: uniqueToken,
                    uid: 'u',
                    sessionId: 's',
                    nid: uniqueNid,
                    devices: [{ nid: uniqueNid, deviceAlias: 'Test Device' }]
                });
            const addAccessoryStub = sinon.stub(platform, 'addAccessory');

            // Act
            await platform.autoDiscover();

            // Assert
            assert.ok(getCredsStub.calledWith(mockConfig.email, mockConfig.password), 'Should call getCredentials with config');
            assert.ok(addAccessoryStub.calledOnce, 'Should attempt to add 1 accessory');

            const addedConfig = addAccessoryStub.firstCall.args[0];
            assert.strictEqual(addedConfig.nid, uniqueNid);
            assert.strictEqual(addedConfig.token, uniqueToken);
        });

        it('should log error if Auto-Discovery fails', async () => {
            // Arrange
            const errorMsg = `Login Failed ${crypto.randomUUID()}`;
            sinon.stub(AuthClient.prototype, 'getCredentials').rejects(new Error(errorMsg));

            // Act
            await platform.autoDiscover();

            // Assert
            assert.ok(mockLog.error.calledWithMatch(new RegExp(errorMsg)), 'Should log specific error message');
        });

        it('should gracefully handle "No Devices Found" (null creds)', async () => {
            // Arrange
            sinon.stub(AuthClient.prototype, 'getCredentials').resolves(null);
            const addAccessoryStub = sinon.stub(platform, 'addAccessory');

            // Act
            await platform.autoDiscover();

            // Assert
            assert.ok(addAccessoryStub.notCalled, 'Should not attempt to add accessories');
        });
    });

    describe('addAccessory()', () => {
        it('should register a new accessory if it does not exist in cache', () => {
            // Arrange
            const uniqueNid = `nid-${crypto.randomUUID()}`;
            const deviceConfig = { name: 'Diffuser 1', nid: uniqueNid, token: 't', uid: 'u', sessionId: 's' };

            // Act
            platform.addAccessory(deviceConfig);

            // Assert
            assert.ok(mockApi.registerPlatformAccessories.calledOnce);
            const registeredAccessory = mockApi.registerPlatformAccessories.firstCall.args[2][0];
            assert.strictEqual(registeredAccessory.displayName, 'Diffuser 1');
            assert.strictEqual(registeredAccessory.UUID, `uuid-${uniqueNid}`);
        });

        it('should restore an existing accessory if found in cache', () => {
            // Arrange
            const uniqueNid = `nid-${crypto.randomUUID()}`;
            const deviceConfig = { name: 'Diffuser 1', nid: uniqueNid, token: 't', uid: 'u', sessionId: 's' };

            const cachedAccessory = {
                UUID: `uuid-${uniqueNid}`,
                displayName: 'Diffuser 1',
                context: {},
                getService: sinon.stub().returns(null),
                addService: sinon.stub().returns({
                    getCharacteristic: sinon.stub().returns({ onSet: sinon.stub().returnsThis(), onGet: sinon.stub().returnsThis() }),
                    testCharacteristic: sinon.stub().returns(false),
                    addCharacteristic: sinon.stub()
                })
            };
            platform.accessories.push(cachedAccessory);

            // Act
            platform.addAccessory(deviceConfig);

            // Assert
            assert.ok(mockApi.registerPlatformAccessories.notCalled, 'Should not register again');
            assert.ok(mockLog.info.calledWithMatch(/Restoring/), 'Should log restoration');
        });

        it('should abort if Token or NID is missing', () => {
            // Act 1: Missing Token
            platform.addAccessory({ name: 'Bad Device', nid: '1' });
            assert.ok(mockLog.error.calledWithMatch(/Cannot register accessory/));
            mockLog.error.resetHistory();

            // Act 2: Missing NID
            platform.addAccessory({ name: 'Bad Device', token: 't' });
            assert.ok(mockLog.error.calledWithMatch(/Cannot register accessory/));
            assert.ok(mockApi.registerPlatformAccessories.notCalled);
        });
    });

    describe('discoverDevices()', () => {
        it('should fallback to HSN or Default Name if Alias is missing', () => {
            const addAccessoryStub = sinon.stub(platform, 'addAccessory');
            const creds = { token: 't', uid: 'u', sessionId: 's' };

            // Act
            platform.discoverDevices([
                { nid: '1', hsn: 'HSN_Name' },
                { nid: '2' } // No alias, no hsn
            ], creds);

            // Assert
            assert.strictEqual(addAccessoryStub.callCount, 2);
            assert.strictEqual(addAccessoryStub.firstCall.args[0].name, 'HSN_Name');
            assert.strictEqual(addAccessoryStub.secondCall.args[0].name, 'Smart Diffuser');
        });

        it('should log error if provided empty device list', () => {
            platform.discoverDevices([], {});
            assert.ok(platform.log.error.calledWith('No devices found to register.'));
        });

        it('should handle null device list gracefully', () => {
            platform.discoverDevices(null, {});
            assert.ok(platform.log.error.calledWith('No devices found to register.'));
        });
    });

    describe('refreshSession()', () => {
        it('should deduplicate concurrent refresh requests (Identity Check)', async () => {
            // Arrange
            let resolveCreds;
            const credsPromise = new Promise(r => { resolveCreds = r; });

            const getCredsStub = sinon.stub(AuthClient.prototype, 'getCredentials')
                .returns(credsPromise);

            // Act
            const p1 = platform.refreshSession();
            const p2 = platform.refreshSession();

            // Cleanup
            resolveCreds({ token: 'new', uid: '1', sessionId: '2', nid: 'n', devices: [] });
            await Promise.all([p1, p2]);

            // Assert: Deduplication is proven if getCredentials is only called once
            assert.ok(getCredsStub.calledOnce, 'Should only hit API once');
            getCredsStub.restore();
        });

        it('should return new session credentials on success', async () => {
            // Arrange
            const expectedToken = crypto.randomUUID();
            sinon.stub(AuthClient.prototype, 'getCredentials')
                .resolves({ token: expectedToken, uid: '1', sessionId: '2', nid: 'n', devices: [] });

            // Act
            const creds = await platform.refreshSession();

            // Assert
            assert.strictEqual(creds.token, expectedToken);
            assert.strictEqual(platform._refreshPromise, null, 'Should clear promise cache after completion');
        });

        it('should fail if email is removed from config', async () => {
            platform.config.email = null;
            await assert.rejects(platform.refreshSession(), /Cannot refresh session/);
        });

        it('should fail if password is removed from config', async () => {
            platform.config.password = null;
            await assert.rejects(platform.refreshSession(), /Cannot refresh session/);
        });

        it('should propagate auth errors and clear cache', async () => {
            sinon.stub(AuthClient.prototype, 'getCredentials').rejects(new Error('Auth Down'));

            await assert.rejects(platform.refreshSession(), /Auth Down/);
            assert.strictEqual(platform._refreshPromise, null);
        });
    });

    describe('Edge Cases', () => {
        it('should handle initialization with missing config gracefully', () => {
            const p = new DiffuserPlatform(mockLog, undefined, mockApi);
            assert.strictEqual(p.config, undefined);
        });

        it('should cache accessories when configured', () => {
            const p = new DiffuserPlatform(mockLog, {}, mockApi);
            const acc = { UUID: 'test-uuid' };
            p.configureAccessory(acc);
            assert.strictEqual(p.accessories.length, 1);
            assert.strictEqual(p.accessories[0], acc);
        });
    });
});
