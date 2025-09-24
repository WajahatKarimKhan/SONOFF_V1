require('dotenv').config(); // Load environment variables from .env file
const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');
const eWeLink = require('ewelink-api-next').default;
const { appId, appSecret } = require('./config');
const { sendAlertEmail } = require('./emailService');

const app = new Koa();
const router = new Router();
const port = process.env.PORT || 8000;

// --- Production URLs & Config ---
const allowedOrigins = [
    'https://aedesign-sonoffs-app.onrender.com',
    'http://localhost:3000' // Keep for local testing
];
const frontendUrl = 'https://aedesign-sonoffs-app.onrender.com';
const backendUrl = 'https://aedesign-sonoff-backend.onrender.com';


// --- In-Memory Storage ---
let tokenStore = {};
let deviceLimits = {};
let activeAlerts = [];
let alertIdCounter = 0;

// --- Robust CORS Setup ---
const corsOptions = {
    origin: function (ctx) {
        const origin = ctx.request.header.origin;
        if (allowedOrigins.indexOf(origin) !== -1) {
            return origin;
        }
        // If the origin is not allowed, don't return anything.
        // The middleware will then block the request.
        return false;
    }
};
app.use(cors(corsOptions));
app.use(bodyParser());

const client = new eWeLink.WebAPI({ appId, appSecret });

// --- Authentication Routes ---
router.get('/auth/login', (ctx) => {
  const redirectUrl = `${backendUrl}/redirectUrl`;
  const loginUrl = client.oauth.createLoginUrl({
    redirectUrl,
    grantType: 'authorization_code',
    state: 'your_random_state_string',
  });

  if (loginUrl) {
    console.log(`Generated login URL: ${loginUrl}`);
    ctx.redirect(loginUrl);
  } else {
    console.error('CRITICAL: Failed to generate eWeLink login URL.');
    ctx.status = 500;
    ctx.body = 'Could not generate eWeLink login URL.';
  }
});

router.get('/redirectUrl', async (ctx) => {
  try {
    const { code, region } = ctx.request.query;
    const response = await client.oauth.getToken({
      code, region, redirectUrl: `${backendUrl}/redirectUrl`,
    });
    tokenStore = {
      accessToken: response.data.accessToken,
      refreshToken: response.data.refreshToken,
      region: region,
    };
    ctx.redirect(frontendUrl);
  } catch (error) {
    console.error('Error getting token:', error);
    ctx.status = 500;
    ctx.body = 'Authentication failed.';
  }
});

// --- Main API Routes ---
router.get('/api/session', (ctx) => {
  ctx.body = tokenStore.accessToken ? { loggedIn: true, region: tokenStore.region } : { loggedIn: false };
});

router.get('/api/devices', async (ctx) => {
    if (!tokenStore.accessToken) return ctx.throw(401, 'Not authenticated');
    try {
        client.at = tokenStore.accessToken;
        client.setUrl(tokenStore.region);
        const devices = await client.device.getAllThingsAllPages();
        if (devices.data && devices.data.thingList) {
            devices.data.thingList.forEach(device => {
                const deviceId = device.itemData.deviceid;
                if (deviceLimits[deviceId]) {
                    device.itemData.limits = deviceLimits[deviceId];
                }
            });
        }
        ctx.body = devices;
    } catch (error) {
        ctx.throw(500, 'Failed to fetch devices.');
    }
});

router.post('/api/devices/:id/status', async (ctx) => {
    if (!tokenStore.accessToken) return ctx.throw(401, 'Not authenticated');
    try {
        client.at = tokenStore.accessToken;
        client.setUrl(tokenStore.region);
        const { id } = ctx.params;
        const { params } = ctx.request.body;
        ctx.body = await client.device.setThingStatus({ type: 1, id, params });
    } catch (error) {
        ctx.throw(500, 'Failed to toggle device.');
    }
});

// --- Alerting and Limits Routes ---
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
    console.log(`Dismissed alert ${alertId}`);
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
        alertMessage = `Temperature is HIGH: ${currentTemperature}°C (Limit was ${tempHigh}°C)`;
      } else if (tempLow && currentTemperature !== 'unavailable' && currentTemperature < tempLow) {
        alertMessage = `Temperature is LOW: ${currentTemperature}°C (Limit was ${tempLow}°C)`;
      } else if (humidHigh && currentHumidity !== 'unavailable' && currentHumidity > humidHigh) {
        alertMessage = `Humidity is HIGH: ${currentHumidity}% (Limit was ${humidHigh}%)`;
      } else if (humidLow && currentHumidity !== 'unavailable' && currentHumidity < humidLow) {
        alertMessage = `Humidity is LOW: ${currentHumidity}% (Limit was ${humidLow}%)`;
      }
      if (alertMessage) {
        const existingAlert = activeAlerts.find(a => a.deviceId === deviceid && a.originalMessage === alertMessage);
        if (!existingAlert) {
            alertIdCounter++;
            const newAlert = { id: alertIdCounter, deviceId: deviceid, deviceName: name, message: `Alert for ${name}: ${alertMessage}`, originalMessage: alertMessage, timestamp: new Date().toISOString() };
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
});

