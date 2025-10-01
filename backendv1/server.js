require('dotenv').config();
const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');
const eWeLink = require('ewelink-api-next').default;
const axios = require('axios'); // Import axios
const { appId, appSecret } = require('./config');
// const { sendAlertEmail, verifyConnection } = require('./emailService'); // REMOVE THIS LINE

const app = new Koa();
const router = new Router();
const port = process.env.PORT || 8000;

// --- Production URLs & Config ---
const frontendUrl = 'https://aedesign-sonoffs-app.onrender.com';
const backendUrl = 'https://aedesign-sonoff-backend.onrender.com';
// The URL of your new Python email microservice on Render
const pythonEmailServiceUrl = process.env.PYTHON_EMAIL_SERVICE_URL; 
const alertRecipientEmail = 'rehmanjavaid68@gmail.com';

// --- In-Memory Storage ---
let tokenStore = {};
let deviceLimits = {};
let activeAlerts = [];
let alertIdCounter = 0;

// --- Middleware ---
app.use(cors({ origin: frontendUrl }));
app.use(bodyParser());

if (!appId || !appSecret) {
    console.error("CRITICAL: appId or appSecret is missing from config.js.");
    process.exit(1);
}
const client = new eWeLink.WebAPI({ appId, appSecret });

// --- New Function to Call Python Email Service ---
const triggerPythonEmailAlert = async (recipient, subject, message) => {
    if (!pythonEmailServiceUrl) {
        console.error("CRITICAL: PYTHON_EMAIL_SERVICE_URL is not set in environment variables.");
        return;
    }

    try {
        console.log(`Attempting to send email alert via Python service to ${recipient}`);
        await axios.post(`${pythonEmailServiceUrl}/api/send-alert`, {
            recipient_email: recipient,
            subject: subject,
            message: message,
        });
        console.log("✅ Successfully triggered email alert via Python service.");
    } catch (error) {
        console.error("❌ FAILED to trigger Python email service.");
        if (error.response) {
            console.error('Error Response:', error.response.data);
        } else {
            console.error('Error Message:', error.message);
        }
    }
};


// --- Routes (No changes needed for most routes) ---
router.get('/auth/login', (ctx) => {
    const redirectUrl = `${backendUrl}/redirectUrl`;
    const loginUrl = client.oauth.createLoginUrl({ redirectUrl, grantType: 'authorization_code', state: 'your_random_state_string' });
    if (loginUrl) {
        ctx.redirect(loginUrl);
    } else {
        ctx.status = 500;
        ctx.body = 'Could not generate eWeLink login URL.';
    }
});

router.get('/redirectUrl', async (ctx) => {
    try {
        const { code, region } = ctx.request.query;
        const response = await client.oauth.getToken({ code, region, redirectUrl: `${backendUrl}/redirectUrl` });
        tokenStore = { accessToken: response.data.accessToken, refreshToken: response.data.refreshToken, region: region };
        ctx.redirect(frontendUrl);
    } catch (error) {
        console.error("Authentication Error:", error.response ? error.response.data : error.message);
        ctx.status = 500;
        ctx.body = 'Authentication failed. Please check backend logs.';
    }
});

router.get('/api/session', (ctx) => {
    ctx.body = tokenStore.accessToken ? { loggedIn: true, region: tokenStore.region } : { loggedIn: false };
});

router.get('/api/devices', async (ctx) => {
    if (!tokenStore.accessToken) return ctx.throw(401, 'Not authenticated');
    client.at = tokenStore.accessToken;
    client.setUrl(tokenStore.region);
    const devices = await client.device.getAllThingsAllPages();
    if (devices.data && devices.data.thingList) {
        devices.data.thingList.forEach(d => {
            if (deviceLimits[d.itemData.deviceid]) {
                d.itemData.limits = deviceLimits[d.itemData.deviceid];
            }
        });
    }
    ctx.body = devices;
});

router.post('/api/devices/:id/status', async (ctx) => {
    if (!tokenStore.accessToken) return ctx.throw(401, 'Not authenticated');
    client.at = tokenStore.accessToken;
    client.setUrl(tokenStore.region);
    const { id } = ctx.params;
    const { params } = ctx.request.body;
    ctx.body = await client.device.setThingStatus({ type: 1, id, params });
});

router.post('/api/devices/:id/limits', (ctx) => {
    if (!tokenStore.accessToken) return ctx.throw(401, 'Not authenticated');
    const { id } = ctx.params;
    const { limits } = ctx.request.body;
    deviceLimits[id] = limits;
    console.log(`Limits updated for device ${id}:`, deviceLimits[id]);
    ctx.status = 200;
    ctx.body = { message: 'Limits saved successfully.' };
});

router.get('/api/alerts', (ctx) => {
    ctx.body = activeAlerts;
});

router.delete('/api/alerts/:id', (ctx) => {
    const alertId = parseInt(ctx.params.id, 10);
    activeAlerts = activeAlerts.filter(alert => alert.id !== alertId);
    ctx.status = 204;
});

// ... after your router.delete('/api/alerts/:id', ...) route

// ===================================================================
//  ⚠️ PUBLIC DEBUG ENDPOINT - COMMENT OUT/DELETE WHEN NOT IN USE ⚠️
//  Visiting https://aedesign-sonoff-backend.onrender.com/api/devices/raw-debug
//  will make all your device data publicly visible.
// ===================================================================
router.get('/api/devices/raw-debug', async (ctx) => {
    // First, check if you are logged in. This adds a small layer of security.
    if (!tokenStore.accessToken) {
        ctx.status = 401; // Unauthorized
        ctx.body = { 
            error: 'Not authenticated.',
            message: 'Please log in through the frontend application first to generate a session token.' 
        };
        return;
    }

    try {
        // Fetch the latest device data from eWeLink
        client.at = tokenStore.accessToken;
        client.setUrl(tokenStore.region);
        const devices = await client.device.getAllThingsAllPages();

        // Display the raw JSON data directly in the browser, nicely formatted
        ctx.type = 'json';
        ctx.body = JSON.stringify(devices, null, 2); // The '2' makes it readable
    } catch (error) {
        ctx.status = 500; // Internal Server Error
        ctx.body = { 
            error: 'Failed to fetch devices from eWeLink API.',
            details: error.message 
        };
    }
});
// ===================================================================
//  END OF PUBLIC DEBUG ENDPOINT
// ===================================================================


// --- Background Task for Checking Limits (MODIFIED) ---
const checkDeviceLimits = async () => {
    if (!tokenStore.accessToken) return;
    try {
        client.at = tokenStore.accessToken;
        client.setUrl(tokenStore.region);
        const devices = await client.device.getAllThingsAllPages();
        if (!devices.data || !devices.data.thingList) return;

        devices.data.thingList.forEach(device => {
            const { deviceid, name, params } = device.itemData;
            const limits = deviceLimits[deviceid];
            if (!limits) return;

            const { tempHigh, tempLow, humidHigh, humidLow } = limits;
            const { currentTemperature, currentHumidity } = params;
            let alertMessage = null;
            
            if (tempHigh && currentTemperature !== 'unavailable' && currentTemperature > tempHigh) {
                alertMessage = `Temperature is too HIGH: ${currentTemperature}°C (Your limit is ${tempHigh}°C).`;
            } else if (tempLow && currentTemperature !== 'unavailable' && currentTemperature < tempLow) {
                alertMessage = `Temperature is too LOW: ${currentTemperature}°C (Your limit is ${tempLow}°C).`;
            } else if (humidHigh && currentHumidity !== 'unavailable' && currentHumidity > humidHigh) {
                alertMessage = `Humidity is too HIGH: ${currentHumidity}% (Your limit is ${humidHigh}%).`;
            } else if (humidLow && currentHumidity !== 'unavailable' && currentHumidity < humidLow) {
                alertMessage = `Humidity is too LOW: ${currentHumidity}% (Your limit is ${humidLow}%).`;
            }
            
            if (alertMessage) {
                const existingAlert = activeAlerts.find(a => a.deviceId === deviceid && a.originalMessage === alertMessage);
                if (!existingAlert) {
                    alertIdCounter++;
                    const fullMessage = `Alert for ${name}: ${alertMessage}`;
                    const newAlert = { id: alertIdCounter, deviceId: deviceid, deviceName: name, message: fullMessage, originalMessage: alertMessage };
                    activeAlerts.push(newAlert);
                    
                    // *** THIS IS THE KEY CHANGE ***
                    // Instead of using nodemailer, call our new function
                    triggerPythonEmailAlert(alertRecipientEmail, `SONOFF Alert: ${name}`, fullMessage);
                }
            }
        });
    } catch (error) {
        console.error('Error during background check:', error.message);
    }
};
setInterval(checkDeviceLimits, 60000);

app.use(router.routes()).use(router.allowedMethods());

app.listen(port, () => {
    console.log(`Backend server running on port ${port}`);
    // verifyConnection(); // REMOVE THIS LINE
});
