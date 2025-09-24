require('dotenv').config(); // Load variables from .env file at the very top
const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');
const eWeLink = require('ewelink-api-next').default;
const { appId, appSecret } = require('./config');
const { sendAlertEmail } = require('./emailService'); // Import the REAL email service

const app = new Koa();
const router = new Router();
const port = process.env.PORT || 8000;

// --- Production URLs & Config ---
const allowedOrigins = [
    'https://aedesign-sonoffs-app.onrender.com',
    //'http://localhost:3000'
];
const frontendUrl = 'https://aedesign-sonoffs-app.onrender.com';
const backendUrl = 'https://aedesign-sonoff-backend.onrender.com';

// --- In-Memory Storage ---
let tokenStore = {};
let deviceLimits = {};
let activeAlerts = [];
let alertIdCounter = 0;

// --- Middleware Setup ---
const corsOptions = {
    origin: (ctx) => {
        const origin = ctx.request.header.origin;
        if (allowedOrigins.includes(origin)) return origin;
        return false;
    }
};
app.use(cors(corsOptions));
app.use(bodyParser());

const client = new eWeLink.WebAPI({ appId, appSecret });

// --- Routes ---
// [Authentication and basic API routes are unchanged and omitted for brevity]
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
            
            // --- THIS NOW SENDS A REAL EMAIL ---
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
});

