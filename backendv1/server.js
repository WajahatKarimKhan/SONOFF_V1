require('dotenv').config(); // Load variables from .env file if it exists, ignored on Render
const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');
const eWeLink = require('ewelink-api-next').default;
const { appId, appSecret } = require('./config');
const { sendAlertEmail, verifyConnection } = require('./emailService');

const app = new Koa();
const router = new Router();
const port = process.env.PORT || 8000;

// --- Production URLs & Config ---
const frontendUrl = 'https://aedesign-sonoffs-app.onrender.com';
const backendUrl = 'https://aedesign-sonoff-backend.onrender.com';
const alertRecipientEmail = 'wkarim@aedesign.com.pk'; // The hardcoded recipient email address

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

// --- Routes ---
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
    const { limits } = ctx.request.body; // Email is no longer received from the frontend
    deviceLimits[id] = limits; // Only save the limits
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

// --- Background Task for Checking Limits ---
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
      if (!limits) return; // Only check if limits are set for the device

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
            const newAlert = { id: alertIdCounter, deviceId: deviceid, deviceName: name, message: `Alert for ${name}: ${alertMessage}`, originalMessage: alertMessage };
            activeAlerts.push(newAlert);
            
            // --- SEND REAL EMAIL TO HARDCODED ADDRESS ---
            sendAlertEmail(alertRecipientEmail, `SONOFF Alert: ${name}`, newAlert.message);
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
  verifyConnection();
});

