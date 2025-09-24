require('dotenv').config(); // Allows use of a local .env file if it exists, but is ignored on Render
const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');
const eWeLink = require('ewelink-api-next').default;
const { sendAlertEmail, verifyConnection } = require('./emailService');

const app = new Koa();
const router = new Router();
const port = process.env.PORT || 8000;

// --- Load ALL Credentials from Environment Variables ---
const appId = process.env.EWELINK_APP_ID;
const appSecret = process.env.EWELINK_APP_SECRET;

// --- Production URLs & Config ---
const frontendUrl = 'https://aedesign-sonoffs-app.onrender.com';
const backendUrl = 'https://aedesign-sonoff-backend.onrender.com';

// --- In-Memory Storage ---
let tokenStore = {};
let deviceLimits = {};
let activeAlerts = [];
let alertIdCounter = 0;

// --- Middleware Setup ---
// Only allow requests from your live frontend
app.use(cors({ origin: frontendUrl }));
app.use(bodyParser());

// Check if eWeLink credentials are set
if (!appId || !appSecret) {
    console.error("CRITICAL: EWELINK_APP_ID or EWELINK_APP_SECRET is not set in the environment variables.");
    process.exit(1); // Stop the server if credentials are missing
}

const client = new eWeLink.WebAPI({ appId, appSecret });

// --- Routes ---
// [NOTE: All routes are correct and unchanged, omitted for brevity]
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
    ctx.status = 500;
    ctx.body = 'Authentication failed.';
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
    const { limits, email } = ctx.request.body;
    deviceLimits[id] = { limits, email };
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
      const stored = deviceLimits[deviceid];
      if (!stored || !stored.limits || !stored.email) return;

      const { tempHigh, tempLow, humidHigh, humidLow } = stored.limits;
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
            sendAlertEmail(stored.email, `SONOFF Alert: ${name}`, newAlert.message);
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

