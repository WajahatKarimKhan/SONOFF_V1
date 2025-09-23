const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');
const eWeLink = require('ewelink-api-next').default;
const { appId, appSecret } = require('./config');

const app = new Koa();
const router = new Router();
const port = 8000;

app.use(cors({ origin: 'http://localhost:3000' }));
app.use(bodyParser());

// --- In-Memory Stores ---
let tokenStore = {};
// New: Stores for device limits and active alerts
let limitsStore = {}; // Example: { "deviceId": { tempUpper: 30, tempLower: 10 } }
let alertsStore = []; // Example: [ { id: 1, deviceId: "...", message: "..." } ]
let alertIdCounter = 0;

const client = new eWeLink.WebAPI({
  appId,
  appSecret,
});

// --- Authentication Routes (Unchanged) ---
router.get('/auth/login', (ctx) => {
  const redirectUrl = 'http://localhost:8000/redirectUrl';
  const loginUrl = client.oauth.createLoginUrl({
    redirectUrl: redirectUrl,
    grantType: 'authorization_code',
    state: 'your_random_state_string',
  });
  console.log('Generated login URL:', loginUrl);
  if (loginUrl && typeof loginUrl === 'string') {
    ctx.redirect(loginUrl);
  } else {
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
      redirectUrl: 'http://localhost:8000/redirectUrl',
    });
    tokenStore = {
      accessToken: response.data.accessToken,
      refreshToken: response.data.refreshToken,
      region: region,
    };
    ctx.redirect('http://localhost:3000/');
  } catch (error) {
    ctx.status = 500;
    ctx.body = 'Authentication failed.';
  }
});

// --- API Routes ---
router.get('/api/session', (ctx) => {
  ctx.body = tokenStore.accessToken ? { loggedIn: true, region: tokenStore.region } : { loggedIn: false };
});

router.get('/api/devices', async (ctx) => {
  if (!tokenStore.accessToken) return ctx.throw(401, 'Not authenticated');
  try {
    client.at = tokenStore.accessToken;
    client.setUrl(tokenStore.region);
    const response = await client.device.getAllThingsAllPages();
    
    // New: Check device status against limits
    if (response.data && response.data.thingList) {
        response.data.thingList.forEach(device => {
            const deviceId = device.itemData.deviceid;
            const params = device.itemData.params;
            const limits = limitsStore[deviceId];
            if (limits) {
                checkLimitsAndCreateAlerts(deviceId, device.itemData.name, params, limits);
            }
        });
    }

    ctx.body = response;
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

// New: Endpoint to set limits for a device
router.post('/api/devices/:id/limits', (ctx) => {
    const { id } = ctx.params;
    const limits = ctx.request.body;
    limitsStore[id] = { ...limitsStore[id], ...limits };
    console.log(`Updated limits for ${id}:`, limitsStore[id]);
    ctx.status = 200;
    ctx.body = { message: 'Limits updated successfully.' };
});

// New: Endpoint to get active alerts
router.get('/api/alerts', (ctx) => {
    ctx.body = alertsStore;
});

// New: Endpoint to dismiss an alert
router.delete('/api/alerts/:id', (ctx) => {
    const alertId = parseInt(ctx.params.id, 10);
    alertsStore = alertsStore.filter(alert => alert.id !== alertId);
    ctx.status = 204; // No Content
});

// --- Helper Function ---
function checkLimitsAndCreateAlerts(deviceId, deviceName, params, limits) {
    const { currentTemperature, currentHumidity } = params;
    
    const check = (type, value, upper, lower) => {
        const messageHigh = `Alert: ${deviceName} ${type} is too high! Currently ${value}, limit is ${upper}.`;
        const messageLow = `Alert: ${deviceName} ${type} is too low! Currently ${value}, limit is ${lower}.`;

        // Check if an alert for this specific condition already exists
        const highAlertExists = alertsStore.some(a => a.deviceId === deviceId && a.message === messageHigh);
        const lowAlertExists = alertsStore.some(a => a.deviceId === deviceId && a.message === messageLow);

        if (upper !== null && value > upper && !highAlertExists) {
            alertsStore.push({ id: ++alertIdCounter, deviceId, message: messageHigh });
        }
        if (lower !== null && value < lower && !lowAlertExists) {
            alertsStore.push({ id: ++alertIdCounter, deviceId, message: messageLow });
        }
    };

    if (limits.tempUpper || limits.tempLower) {
        check('Temperature', parseFloat(currentTemperature), limits.tempUpper, limits.tempLower);
    }
    if (limits.humidUpper || limits.humidLower) {
        check('Humidity', parseFloat(currentHumidity), limits.humidUpper, limits.humidLower);
    }
}


app.use(router.routes()).use(router.allowedMethods());

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
  console.log('CORS enabled for http://localhost:3000');
});


