require('dotenv').config();
const assert = require('assert');
const AuthClient = require('../src/auth');

describe('AuthClient Integration (Live)', () => {
    let auth;

    before(function() {
        if (!process.env.LBSLM_EMAIL || !process.env.LBSLM_PASSWORD) {
            console.log("Skipping integration tests: LBSLM_EMAIL or LBSLM_PASSWORD not set in .env");
            this.skip();
        }
        auth = new AuthClient(console, process.env.LBSLM_REGION || 'CN');
    });

    it('should login and fetch devices with real credentials', async function() {
        this.timeout(20000); // 20s timeout for real network

        const credentials = await auth.getCredentials(process.env.LBSLM_EMAIL, process.env.LBSLM_PASSWORD);
        
        assert.ok(credentials, 'Credentials should not be null');
        assert.ok(credentials.token, 'Should have a token');
        assert.ok(credentials.uid, 'Should have a UID');
        assert.ok(credentials.sessionId, 'Should have a sessionId');
        assert.ok(Array.isArray(credentials.devices), 'Devices should be an array');
        
        console.log(`    Successfully logged in as ${process.env.LBSLM_EMAIL}`);
        console.log(`    Found ${credentials.devices.length} devices.`);
    });
});
