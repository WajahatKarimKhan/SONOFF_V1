const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');
const eWeLink = require('ewelink-api-next').default;
const { appId, appSecret } = require('./config');

const app = new Koa();
const router = new Router();
const port = process.env.PORT || 8000;

// --- Production URLs ---
const frontendUrl = 'https://aedesign-sonoffs-app.onrender.com';
const backendUrl = 'https://aedesign-sonoff-backend.onrender.com';

// --- In-Memory Storage ---
let tokenStore = {};
// Store limits and alerts in memory { deviceId: { limits, email } }
let deviceLimits = {};
// Store active alerts { id, deviceName, message, timestamp }
let activeAlerts = [];
let alertIdCounter = 0;


app.use(cors({ origin: frontendUrl }));
app.use(bodyParser());

const client = new eWeLink.WebAPI({
  appId,
  appSecret,
});

// --- Authentication Routes ---
router.get('/auth/login', (ctx) => {
  const redirectUrl = `${backendUrl}/redirectUrl`;
  const loginUrl = client.oauth.createLoginUrl({
    redirectUrl,
    grantType: 'authorization_code',
    state: 'your_random_state_string',
  });
  if (loginUrl) {
    console.log('Redirecting user to eWeLink login page...');
    ctx.redirect(loginUrl);
  } else {
    console.error('CRITICAL: Failed to generate login URL.');
    ctx.status = 500;
    ctx.body = 'Could not generate eWeLink login URL.';
  }
});

router.get('/redirectUrl', async (ctx) => {
  try {
    const { code, region } = ctx.request.query;
    const response = await client.oauth.getToken({
      code,
      region,
      redirectUrl: `${backendUrl}/redirectUrl`,
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
        // Attach saved limits to the device data
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
    ctx.status = 204; // No content
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
      if (!stored || !stored.limits) return;

      const { tempHigh, tempLow, humidHigh, humidLow } = stored.limits;
      const { currentTemperature, currentHumidity } = params;

      let alertMessage = null;
      if (tempHigh && currentTemperature !== 'unavailable' && currentTemperature > tempHigh) {
        alertMessage = `Temperature is HIGH: ${currentTemperature}°C (Limit: ${tempHigh}°C)`;
      } else if (tempLow && currentTemperature !== 'unavailable' && currentTemperature < tempLow) {
        alertMessage = `Temperature is LOW: ${currentTemperature}°C (Limit: ${tempLow}°C)`;
      } else if (humidHigh && currentHumidity !== 'unavailable' && currentHumidity > humidHigh) {
        alertMessage = `Humidity is HIGH: ${currentHumidity}% (Limit: ${humidHigh}%)`;
      } else if (humidLow && currentHumidity !== 'unavailable' && currentHumidity < humidLow) {
        alertMessage = `Humidity is LOW: ${currentHumidity}% (Limit: ${humidLow}%)`;
      }

      if (alertMessage) {
        // Avoid creating duplicate alerts
        const existingAlert = activeAlerts.find(a => a.deviceId === deviceid && a.message === alertMessage);
        if (!existingAlert) {
            alertIdCounter++;
            const newAlert = {
                id: alertIdCounter,
                deviceId: deviceid,
                deviceName: name,
                message: alertMessage,
                timestamp: new Date().toISOString()
            };
            activeAlerts.push(newAlert);
            // SIMULATE SENDING EMAIL
            console.log('--- 📧 SIMULATING EMAIL ALERT ---');
            console.log(`TO: ${stored.email || 'No email set'}`);
            console.log(`SUBJECT: Alert for device ${name}`);
            console.log(`MESSAGE: ${alertMessage}`);
            console.log('---------------------------------');
        }
      }
    });
  } catch (error) {
    console.error('Error during background check:', error.message);
  }
};

// Run the check every 60 seconds
setInterval(checkDeviceLimits, 60000);


app.use(router.routes()).use(router.allowedMethods());

app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
});

