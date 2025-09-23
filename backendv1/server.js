const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');
const eWeLink = require('ewelink-api-next').default;
const { appId, appSecret } = require('./config');

const app = new Koa();
const router = new Router();
// Render provides the PORT in an environment variable
const port = process.env.PORT || 8000;

// --- Production URLs ---
const frontendUrl = 'https://aedesign-sonoffs-app.onrender.com';
const backendUrl = 'https://aedesign-sonoff-backend.onrender.com';

// Update CORS to allow requests from your live frontend
app.use(cors({ origin: frontendUrl }));
app.use(bodyParser());

let tokenStore = {};

const client = new eWeLink.WebAPI({
  appId,
  appSecret,
});

// --- Authentication Routes ---
router.get('/auth/login', (ctx) => {
  // Use the new production redirect URL
  const redirectUrl = `${backendUrl}/redirectUrl`;
  const loginUrl = client.oauth.createLoginUrl({
    redirectUrl: redirectUrl,
    grantType: 'authorization_code',
    state: 'your_random_state_string',
  });

  if (loginUrl && typeof loginUrl === 'string') {
    console.log('Redirecting user to eWeLink login page...');
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
      code,
      region,
      // Use the new production redirect URL here as well
      redirectUrl: `${backendUrl}/redirectUrl`,
    });
    tokenStore = {
      accessToken: response.data.accessToken,
      refreshToken: response.data.refreshToken,
      region: region,
    };
    // IMPORTANT: Redirect to the live frontend URL
    ctx.redirect(frontendUrl);
  } catch (error) {
    console.error('Error getting token:', error);
    ctx.status = 500;
    ctx.body = 'Authentication failed.';
  }
});

// --- API Routes (No changes needed here) ---
router.get('/api/session', (ctx) => {
  ctx.body = tokenStore.accessToken ? { loggedIn: true, region: tokenStore.region } : { loggedIn: false };
});

router.get('/api/devices', async (ctx) => {
    if (!tokenStore.accessToken) return ctx.throw(401, 'Not authenticated');
    try {
        client.at = tokenStore.accessToken;
        client.setUrl(tokenStore.region);
        ctx.body = await client.device.getAllThingsAllPages();
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

app.use(router.routes()).use(router.allowedMethods());

app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
});

