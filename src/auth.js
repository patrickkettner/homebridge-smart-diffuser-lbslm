const http = require('http');
const querystring = require('querystring');

const HOSTS = {
    'CN': 'amos.cn.lbslm.com',
    'US': 'amos.us.lbslm.com'
};

class AuthClient {
    constructor(log, region = 'CN') {
        this.log = log || console;
        this.host = HOSTS[region] || HOSTS['CN'];
        this.log.debug(`Using Auth Host: ${this.host}`);
    }

    async getCredentials(username, password) {
        try {
            const cookies = await this.login(username, password);
            if (!cookies) throw new Error("Login failed: No cookies received");

            const uid = this.extractUid(cookies);
            if (!uid) throw new Error("Login success but UID not found in cookies");

            this.log.debug(`Login successful. UID: ${uid}`);

            const devices = await this.fetchDevices(cookies, uid);
            if (!devices || devices.length === 0) {
                this.log.warn("No devices found on account.");
                return null;
            }

            const primaryDevice = devices[0];
            const token = this.extractToken(cookies);
            const sessionId = this.extractSessionId(cookies);

            return {
                nid: primaryDevice.nid,
                token: token,
                uid: uid,
                sessionId: sessionId,
                devices: devices
            };
        } catch (error) {
            this.log.error("Authentication Error:", error.message);
            throw error;
        }
    }

    login(username, password) {
        return new Promise((resolve, reject) => {
            const postData = querystring.stringify({
                platform: '1',
                areaCode: '0',
                username: username,
                password: password
            });

            const options = {
                hostname: this.host,
                port: 80,
                path: '/admin/login.do',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData),
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: 10000 // 10s timeout
            };

            const req = http.request(options, (res) => {
                if (res.statusCode >= 200 && res.statusCode < 400) {
                    const cookies = res.headers['set-cookie'];
                    if (cookies) {
                        resolve(cookies);
                    } else {
                        // API may return 200 OK with "AuthenticationException" in the body.
                        let data = '';
                        res.on('data', (c) => {
                            data += c;
                        });
                        res.on('end', () => {
                            if (data.includes("AuthenticationException")) {
                                reject(new Error("Invalid Credentials"));
                            } else {
                                resolve(null); // Return only valid cookies
                            }
                        });
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            });

            req.on('error', (e) => {
                reject(e);
            });
            req.write(postData);
            req.end();
        });
    }

    fetchDevices(cookies, uid) {
        return new Promise((resolve, reject) => {
            let cookieArr = [];
            for (const c of cookies) {
                cookieArr.push(c.split(';')[0]);
            }
            const cookieStr = cookieArr.join('; ');
            const query = querystring.stringify({
                online: 2,
                uid: uid,
                draw: 1,
                start: 0,
                length: 10
            });
            const pathUrl = `/admin/amos/searchForWeb.do?${query}`;

            const options = {
                hostname: this.host,
                port: 80,
                path: pathUrl,
                method: 'POST',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Cookie': cookieStr
                },
                timeout: 10000 // 10s timeout
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (c) => {
                    data += c;
                });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json && json.data) {
                            resolve(json.data);
                        } else {
                            resolve([]);
                        }
                    } catch (e) {
                        reject(new Error("Failed to parse device list JSON"));
                    }
                });
            });

            req.on('error', (e) => {
                reject(e);
            });
            req.end();
        });
    }

    extractUid(cookies) {
        for (const c of cookies) {
            if (c.includes('uid=')) {
                return c.split('uid=')[1].split(';')[0];
            }
        }
        return null;
    }

    extractToken(cookies) {
        for (const c of cookies) {
            if (c.includes('token=')) {
                return c.split('token=')[1].split(';')[0];
            }
        }
        return null;
    }

    extractSessionId(cookies) {
        for (const c of cookies) {
            if (c.includes('sessionId=')) {
                return c.split('sessionId=')[1].split(';')[0];
            }
        }
        return null;
    }
}

module.exports = AuthClient;
