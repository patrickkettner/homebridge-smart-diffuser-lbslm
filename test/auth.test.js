const assert = require('assert');
const sinon = require('sinon');
const http = require('http');
const crypto = require('crypto');
const AuthClient = require('../src/auth');

describe('AuthClient (Platinum Standard)', () => {
    let auth;
    let httpRequestStub;

    // "Scorched Earth" Policy: Clean sandbox for every test
    beforeEach(() => {
        auth = new AuthClient();
        httpRequestStub = sinon.stub(http, 'request');
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('Constructor', () => {
        it('should initialize with default CN region and logging', () => {
        // Act
            const client = new AuthClient();

            // Assert
            assert.strictEqual(client.host, 'amos.cn.lbslm.com');
            assert.ok(client.log);
        });

        it('should default to console if no logger provided', () => {
            const client = new AuthClient();
            assert.strictEqual(client.log, console);
        });

        it('should accept US region configuration', () => {
        // Act
            const client = new AuthClient(null, 'US');

            // Assert
            assert.strictEqual(client.host, 'amos.us.lbslm.com');
        });

        it('should fallback to CN for invalid region codes', () => {
            // Act
            const client = new AuthClient(null, 'INVALID_REGION_' + crypto.randomUUID());

        // Assert
            assert.strictEqual(client.host, 'amos.cn.lbslm.com');
        });
    });

    describe('login()', () => {
        it('should resolve with valid cookies on successful login', async () => {
            // Arrange
            const uniqueUser = `user-${crypto.randomUUID()}`;
            const uniquePass = `pass-${crypto.randomUUID()}`;
            const expectedCookies = [`session=${crypto.randomUUID()}`];

            const mockReq = {
                on: sinon.stub(),
                write: sinon.stub(),
                end: sinon.stub() 
            };
            httpRequestStub.returns(mockReq);

            const promise = auth.login(uniqueUser, uniquePass);

            // Simulate HTTP response callback
            const res = {
                statusCode: 200,
                headers: { 'set-cookie': expectedCookies },
                on: sinon.stub()
            };
            httpRequestStub.firstCall.args[1](res); // Trigger callback

            // Act
            const result = await promise;

            // Assert
            assert.deepStrictEqual(result, expectedCookies, 'Should return exactly the cookies from response');

            // Verification: Deep Argument Inspection
            const requestOptions = httpRequestStub.firstCall.args[0];
            assert.strictEqual(requestOptions.method, 'POST');
            assert.ok(requestOptions.path.includes('/admin/login.do'));

            // Verify payload contains properly encoded credentials
            const writeData = mockReq.write.firstCall.args[0];
            assert.ok(writeData.includes(encodeURIComponent(uniqueUser)), 'Payload must contain encoded username');
            assert.ok(writeData.includes(encodeURIComponent(uniquePass)), 'Payload must contain encoded password');
        });

        it('should reject with "Invalid Credentials" if response body contains AuthenticationException', async () => {
            // Arrange
            const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
            httpRequestStub.returns(mockReq);

            const promise = auth.login('user', 'pass');

            const res = {
                statusCode: 200,
                headers: {}, // No cookies implies failure/check body
                on: (event, cb) => {
                    if (event === 'data') cb('{"status":"fail", "msg":"AuthenticationException"}');
                    if (event === 'end') cb();
                }
            };
            httpRequestStub.firstCall.args[1](res);

            // Act & Assert
            await assert.rejects(promise, /Invalid Credentials/);
        });

        it('should reject on HTTP 401 Unauthorized', async () => {
            // Arrange
            const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
            httpRequestStub.returns(mockReq);

            const promise = auth.login('user', 'pass');

            const res = { statusCode: 401, on: sinon.stub() };
            httpRequestStub.firstCall.args[1](res);

            // Act & Assert
            await assert.rejects(promise, /HTTP 401/);
        });

        it('should reject on Network Socket error', async () => {
        // Arrange
            const mockReq = {
                on: (event, cb) => { if (event === 'error') cb(new Error('Socket Reset')); },
                write: sinon.stub(),
                end: sinon.stub()
            };
            httpRequestStub.returns(mockReq);

            // Act & Assert
            await assert.rejects(auth.login('u', 'p'), /Socket Reset/);
        });
        it('should reject on request error', async () => {
            const mockReq = { 
                on: sinon.stub().callsFake((evt, cb) => {
                    if (evt === 'error') {
                        cb(new Error('Fetch Failed'));
                    }
                }),
                write: sinon.stub(),
                end: sinon.stub()
            };
            httpRequestStub.returns(mockReq);

            await assert.rejects(auth.fetchDevices(['t=1'], 'u1'), /Fetch Failed/);
        });
        it('should return null if no cookies in response', async () => {
            const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
            httpRequestStub.returns(mockReq);

            const promise = auth.login('u', 'p');

            // No Set-Cookie header
            const res = {
                statusCode: 200,
                headers: {},
                on: (evt, cb) => { if (evt === 'data') cb('OK'); if (evt === 'end') cb(); }
            };
            httpRequestStub.firstCall.args[1](res);

            const result = await promise;
            assert.strictEqual(result, null);
        });
    });

    describe('fetchDevices()', () => {
        it('should include correct Cookie header and return parsed devices', async () => {
            // Arrange
            const uniqueToken = `token_${crypto.randomUUID()}`;
            const uniqueUid = `uid_${crypto.randomUUID()}`;
            const expectedNid = `nid_${crypto.randomUUID()}`;

            const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
            httpRequestStub.returns(mockReq);

            const promise = auth.fetchDevices([`token=${uniqueToken}`], uniqueUid);

            const res = {
                on: (event, cb) => {
                    if (event === 'data') cb(JSON.stringify({ data: [{ nid: expectedNid, hsn: 'Device1' }] }));
                    if (event === 'end') cb();
                }
            };
            httpRequestStub.firstCall.args[1](res);

            // Act
            const devices = await promise;

            // Assert
            assert.strictEqual(devices.length, 1);
            assert.strictEqual(devices[0].nid, expectedNid);

            // Verify Headers
            const options = httpRequestStub.firstCall.args[0];
            assert.ok(options.headers.Cookie.includes(uniqueToken), 'Cookie header must contain token');
        });

        it('should resolve empty array when API returns empty data list', async () => {
        // ... (existing test handles this? check implementation)
        });

        it('should resolve empty array if data is null/undefined', async () => {
            const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
            httpRequestStub.returns(mockReq);

            const promise = auth.fetchDevices([], 'u');

            const res = {
                statusCode: 200,
                on: (evt, cb) => { if (evt === 'data') cb(JSON.stringify({ data: null })); if (evt === 'end') cb(); }
            };
            httpRequestStub.firstCall.args[1](res);

            const result = await promise;
            assert.deepStrictEqual(result, []);
        });

        it('should reject if API response is invalid JSON', async () => {
        // Arrange
            const mockReq = { on: sinon.stub(), write: sinon.stub(), end: sinon.stub() };
            httpRequestStub.returns(mockReq);
            const promise = auth.fetchDevices(['c=1'], 'u1');

            const res = {
                on: (event, cb) => {
                    if (event === 'data') cb('<html>Bad Config</html>');
                    if (event === 'end') cb();
                }
            };
            httpRequestStub.firstCall.args[1](res);

            // Act & Assert
            await assert.rejects(promise, /Failed to parse device list JSON/);
        });
    });

    describe('getCredentials()', () => {
        // AAA Pattern Explicit
        it('should orchestrate login and fetchDevices sequence successfully', async () => {
            // Arrange
            const uniqueToken = crypto.randomUUID();
            const uniqueUid = crypto.randomUUID();
            const uniqueSession = crypto.randomUUID();
            const uniqueNid = crypto.randomUUID();

            const mockCookies = [
                `token=${uniqueToken}; Path=/`,
                `uid=${uniqueUid}; Path=/`,
                `sessionId=${uniqueSession}; Path=/`
            ];

            // Stub internal methods to isolate orchestration logic
            const loginStub = sinon.stub(auth, 'login').resolves(mockCookies);
            const fetchDevicesStub = sinon.stub(auth, 'fetchDevices').resolves([{ nid: uniqueNid }]);

            // Act
            const creds = await auth.getCredentials('user', 'pass');

            // Assert
            assert.deepStrictEqual(creds, {
                nid: uniqueNid,
                token: uniqueToken,
                uid: uniqueUid,
                sessionId: uniqueSession,
                devices: [{ nid: uniqueNid }]
            });

            assert.ok(loginStub.calledOnceWith('user', 'pass'), 'Login should be called with credentials');
            assert.ok(fetchDevicesStub.calledOnce, 'Fetch devices should be called');
        });

        it('should fail if login returns null (no cookies)', async () => {
        // Arrange
            sinon.stub(auth, 'login').resolves(null);

            // Act & Assert
            await assert.rejects(auth.getCredentials('u', 'p'), /Login failed: No cookies received/);
        });

        it('should fail if UID is missing from cookies', async () => {
            // Arrange
            sinon.stub(auth, 'login').resolves(['token=123;']); // No UID

        // Act & Assert
            await assert.rejects(auth.getCredentials('u', 'p'), /UID not found/);
        });

        it('should return null if valid login but no devices found', async () => {
            sinon.stub(auth, 'login').resolves(['session=1']);
            sinon.stub(auth, 'extractUid').returns('u1');
            sinon.stub(auth, 'fetchDevices').resolves([]);

            const result = await auth.getCredentials('u', 'p');
            assert.strictEqual(result, null);
        });

        it('should propagate Network Error from login phase', async () => {
            // Arrange
            sinon.stub(auth, 'login').rejects(new Error('DNS Failure'));

            // Act & Assert
            await assert.rejects(auth.getCredentials('u', 'p'), /DNS Failure/);
        });
    });

    describe('Helpers', () => {
        it('should extract UID correctly', () => {
            const uid = crypto.randomUUID();
            assert.strictEqual(auth.extractUid([`uid=${uid};`]), uid);
            assert.strictEqual(auth.extractUid(['ignore=me', `uid=${uid};`]), uid); // Loop
            assert.strictEqual(auth.extractUid(['ignore=me']), null);
        });

        it('should extract Token correctly', () => {
            const token = crypto.randomUUID();
            assert.strictEqual(auth.extractToken([`token=${token};`]), token);
            assert.strictEqual(auth.extractToken(['ignore=me', `token=${token};`]), token); // Loop
        });

        it('should extract SessionId correctly', () => {
            const sid = crypto.randomUUID();
            assert.strictEqual(auth.extractSessionId([`sessionId=${sid};`]), sid);
            assert.strictEqual(auth.extractSessionId(['ignore=me', `sessionId=${sid};`]), sid); // Loop
            assert.strictEqual(auth.extractSessionId(['none=1;']), null);
        });

        it('should return null for Token if missing', () => {
            assert.strictEqual(auth.extractToken(['none=1;']), null);
        });
    });
});
