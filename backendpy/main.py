import os
import smtplib
import ssl
import asyncio
import httpx
from email.mime.text import MIMEText
from typing import Dict, Any, List

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# --- Configuration (Loaded from Render Environment Variables) ---
# eWeLink Credentials
APP_ID = os.getenv("EWELINK_APP_ID")
APP_SECRET = os.getenv("EWELINK_APP_SECRET")

# Email Credentials
EMAIL_SENDER = os.getenv("EMAIL_USER")
EMAIL_PASS = os.getenv("EMAIL_APP_PASSWORD") # Using a distinct name for clarity
ALERT_RECIPIENT_EMAIL = "wkk24084@gmail.com"

# Production URLs
FRONTEND_URL = "https://aedesign-sonoffs-app.onrender.com"
BACKEND_URL = "https://aedesign-sonoff-backend.onrender.com"

# --- In-Memory Storage ---
token_store: Dict[str, Any] = {}
device_master_list: Dict[str, Any] = {} # A master list to hold all device data
active_alerts: List[Dict[str, Any]] = []
alert_id_counter = 0

# --- FastAPI Application Setup ---
app = FastAPI(
    title="SONOFF Portal Backend (Python)",
    description="A Python-based backend to control eWeLink devices.",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Models for Data Validation ---
class DeviceParams(BaseModel):
    switch: str

class TogglePayload(BaseModel):
    params: DeviceParams

class LimitsPayload(BaseModel):
    limits: Dict[str, float]

# --- Email Service ---
async def send_alert_email(subject: str, message: str):
    """Sends a real email alert using Gmail's SMTP server."""
    if not EMAIL_SENDER or not EMAIL_PASS:
        print("⚠️ Email credentials not set. Cannot send email.")
        return

    msg = MIMEText(f"<p><b>SONOFF Device Alert:</b></p><p>{message.replace('/n', '<br>')}</p>", 'html')
    msg["Subject"] = subject
    msg["From"] = f"SONOFF Portal <{EMAIL_SENDER}>"
    msg["To"] = ALERT_RECIPIENT_EMAIL

    context = ssl.create_default_context()
    try:
        print(f"🚀 Attempting to send email alert to {ALERT_RECIPIENT_EMAIL}...")
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
            server.login(EMAIL_SENDER, EMAIL_PASS)
            server.send_message(msg)
        print(f"✅ Email alert sent successfully.")
    except Exception as e:
        print(f"❌ CRITICAL: Failed to send email. Check credentials and network settings.")
        print(f"   Error: {e}")

# --- eWeLink Authentication ---
@app.get("/auth/login")
async def login():
    """Constructs the eWeLink OAuth URL and redirects the user."""
    if not APP_ID:
        raise HTTPException(status_code=500, detail="EWELINK_APP_ID is not configured.")
    
    redirect_uri = f"{BACKEND_URL}/redirectUrl"
    state = "your_random_state_string"
    
    auth_url = (
        f"https://c2ccdn.coolkit.cc/oauth/index.html?"
        f"clientId={APP_ID}&"
        f"redirectUrl={redirect_uri}&"
        f"grantType=authorization_code&"
        f"state={state}"
    )
    return RedirectResponse(url=auth_url)

@app.get("/redirectUrl")
async def handle_redirect(code: str, region: str):
    """Handles the callback from eWeLink, exchanges the code for a token."""
    if not APP_SECRET:
        raise HTTPException(status_code=500, detail="EWELINK_APP_SECRET is not configured.")

    token_url = f"https://{region}-apia.coolkit.cc/v2/user/oauth/token"
    payload = {
        "clientId": APP_ID,
        "clientSecret": APP_SECRET,
        "grantType": "authorization_code",
        "code": code,
        "redirectUrl": f"{BACKEND_URL}/redirectUrl",
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(token_url, json=payload)
            response.raise_for_status()
            data = response.json().get("data", {})
        
        token_store.update({
            "accessToken": data.get("accessToken"),
            "refreshToken": data.get("refreshToken"),
            "region": region,
        })
        print("✅ Successfully authenticated with eWeLink.")
        return RedirectResponse(url=FRONTEND_URL)
    except httpx.HTTPStatusError as e:
        print(f"❌ ERROR: Failed to get token from eWeLink. Response: {e.response.text}")
        raise HTTPException(status_code=500, detail="Authentication failed.")

# --- API Endpoints ---
@app.get("/api/session")
async def get_session():
    return {"loggedIn": True} if token_store.get("accessToken") else {"loggedIn": False}

@app.get("/api/devices")
async def get_devices():
    return {"data": {"thingList": list(device_master_list.values())}}

@app.post("/api/devices/{device_id}/status")
async def set_device_status(device_id: str, payload: TogglePayload):
    from pyewelink import EWeLink
    if not token_store.get("accessToken"):
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        async with EWeLink(access_token=token_store["accessToken"], region=token_store["region"], app_id=APP_ID, app_secret=APP_SECRET) as client:
            await client.set_device_power_state(device_id, payload.params.switch)
        
        if device_id in device_master_list:
            device_master_list[device_id]['itemData']['params']['switch'] = payload.params.switch
        return {"error": 0, "data": {}}
    except Exception as e:
        print(f"❌ ERROR toggling device {device_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to toggle device")


@app.post("/api/devices/{device_id}/limits")
async def save_limits(device_id: str, payload: LimitsPayload):
    if device_id in device_master_list:
        if 'limits' not in device_master_list[device_id]['itemData']:
             device_master_list[device_id]['itemData']['limits'] = {}
        device_master_list[device_id]['itemData']['limits'].update(payload.limits)
    
    print(f"Limits updated for {device_id}: {payload.limits}")
    return {"message": "Limits saved successfully."}

@app.get("/api/alerts")
async def get_alerts():
    return active_alerts

@app.delete("/api/alerts/{alert_id}")
async def dismiss_alert(alert_id: int):
    global active_alerts
    active_alerts = [a for a in active_alerts if a["id"] != alert_id]
    return {"message": "Alert dismissed."}
    
# --- Background Task for Monitoring ---
async def check_device_limits():
    """Periodically fetches device status and checks against limits."""
    global alert_id_counter
    from pyewelink import EWeLink
    
    while True:
        await asyncio.sleep(60)
        if not token_store.get("accessToken"):
            continue

        print("🔄 Running background check for device limits...")
        try:
            async with EWeLink(access_token=token_store["accessToken"], region=token_store["region"], app_id=APP_ID, app_secret=APP_SECRET) as client:
                devices = await client.get_devices()

            for device in devices:
                device_id = device["deviceid"]
                name = device["name"]
                params = device.get("params", {})
                
                # Update our master list with the latest data
                current_limits = device_master_list.get(device_id, {}).get('itemData', {}).get('limits', {})
                device_master_list[device_id] = {
                    "itemData": {
                        "name": name, "online": device.get("online"), "deviceid": device_id,
                        "params": params, "extra": device.get("extra", {}), "limits": current_limits
                    }
                }
                
                if not current_limits: continue

                temp = params.get("currentTemperature")
                humid = params.get("currentHumidity")
                alert_message = None

                if current_limits.get("tempHigh") and temp != "unavailable" and temp > current_limits["tempHigh"]:
                    alert_message = f"Temperature is too HIGH: {temp}°C (Limit: {current_limits['tempHigh']}°C)."
                elif current_limits.get("tempLow") and temp != "unavailable" and temp < current_limits["tempLow"]:
                    alert_message = f"Temperature is too LOW: {temp}°C (Limit: {current_limits['tempLow']}°C)."
                
                if current_limits.get("humidHigh") and humid != "unavailable" and humid > current_limits["humidHigh"]:
                    alert_message = f"Humidity is too HIGH: {humid}% (Limit: {current_limits['humidHigh']}%)."
                elif current_limits.get("humidLow") and humid != "unavailable" and humid < current_limits["humidLow"]:
                    alert_message = f"Humidity is too LOW: {humid}% (Limit: {current_limits['humidLow']}%)."

                if alert_message:
                    if not any(a["originalMessage"] == alert_message for a in active_alerts if a["deviceId"] == device_id):
                        alert_id_counter += 1
                        new_alert = {"id": alert_id_counter, "deviceId": device_id, "deviceName": name, "message": f"Alert for {name}: {alert_message}", "originalMessage": alert_message}
                        active_alerts.append(new_alert)
                        await send_alert_email(f"SONOFF Alert: {name}", new_alert["message"])

        except Exception as e:
            print(f"❌ ERROR during background check: {e}")

@app.on_event("startup")
async def startup_event():
    """Start the background monitoring task when the app starts."""
    asyncio.create_task(check_device_limits())

