import os
import asyncio
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pyewelink import Client

# --- Configuration (Reads from Render's Environment Variables) ---
EWELINK_EMAIL = os.getenv("EWELINK_EMAIL")
EWELINK_PASSWORD = os.getenv("EWELINK_PASSWORD")
EWELINK_REGION = os.getenv("EWELINK_REGION", "as") # Defaults to 'as' if not set
APP_ID = os.getenv("APP_ID")
APP_SECRET = os.getenv("APP_SECRET")

EMAIL_USER = os.getenv("EMAIL_USER")
EMAIL_PASS = os.getenv("EMAIL_PASS") # Your 16-character Gmail App Password
ALERT_RECIPIENT_EMAIL = "wkk24084@gmail.com"


# --- FastAPI App Initialization ---
app = FastAPI()

# Allow frontend running on Render to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://aedesign-sonoffs-app.onrender.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables to hold the client instance and device data
client: Client | None = None
device_limits = {}


# --- Email Sending Function ---
def send_alert_email_from_python(recipient_email, subject, message):
    if not EMAIL_USER or not EMAIL_PASS:
        print("⚠️ Email credentials are not set. Cannot send email.")
        return

    email_message = MIMEMultipart("alternative")
    email_message["From"] = f"SONOFF Alerts <{EMAIL_USER}>"
    email_message["To"] = recipient_email
    email_message["Subject"] = subject
    html = f"<html><body><p><b>SONOFF Device Alert:</b></p><p>{message.replace('n', '<br>')}</p></body></html>"
    email_message.attach(MIMEText(html, "html"))

    try:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
            server.login(EMAIL_USER, EMAIL_PASS)
            server.sendmail(EMAIL_USER, recipient_email, email_message.as_string())
        print(f"✅ Email alert sent successfully to {recipient_email}.")
    except Exception as e:
        print(f"❌ CRITICAL: Failed to send email via Gmail. Error: {e}")


# --- Background Task for Checking Limits ---
async def check_device_limits_periodically():
    global client
    while True:
        await asyncio.sleep(60) # Wait for 60 seconds before each check
        print("Running periodic check for device limits...")
        if not client or not client.wsh.is_connected:
            print("Client not connected, skipping check.")
            continue
        try:
            devices = await client.get_devices()
            for device in devices:
                device_id = device.get("deviceid")
                limits = device_limits.get(device_id)
                if not limits:
                    continue
                
                params = device.get("params", {})
                temp = params.get("currentTemperature", "unavailable")
                humid = params.get("currentHumidity", "unavailable")
                alert_message = None

                if temp != "unavailable":
                    if limits.get("tempHigh") and temp > limits["tempHigh"]:
                        alert_message = f"Temperature is too HIGH: {temp}°C (Limit: {limits['tempHigh']}°C)."
                    elif limits.get("tempLow") and temp < limits["tempLow"]:
                        alert_message = f"Temperature is too LOW: {temp}°C (Limit: {limits['tempLow']}°C)."
                
                if humid != "unavailable":
                    if limits.get("humidHigh") and humid > limits["humidHigh"]:
                        alert_message = f"Humidity is too HIGH: {humid}% (Limit: {limits['humidHigh']}%)."
                    elif limits.get("humidLow") and humid < limits["humidLow"]:
                        alert_message = f"Humidity is too LOW: {humid}% (Limit: {limits['humidLow']}%)."

                if alert_message:
                    subject = f"SONOFF Alert: {device.get('name')}"
                    send_alert_email_from_python(ALERT_RECIPIENT_EMAIL, subject, alert_message)
                    # Simple logic to avoid spamming: remove the limit after alerting
                    # A more advanced approach would use timestamps to send alerts only once per hour
                    # For now, this is simple and effective.
                    # device_limits.pop(device_id, None) 

        except Exception as e:
            print(f"Error during background check: {e}")


# --- FastAPI Startup and Shutdown Events ---
@app.on_event("startup")
async def startup_event():
    global client
    print("Server starting up...")
    if not all([EWELINK_EMAIL, EWELINK_PASSWORD, EWELINK_REGION, APP_ID, APP_SECRET]):
        print("eWeLink credentials not fully set. eWeLink functionality will be disabled.")
        return
    
    client = Client(
        email=EWELINK_EMAIL,
        password=EWELINK_PASSWORD,
        region=EWELINK_REGION,
        app_id=APP_ID,
        app_secret=APP_SECRET
    )
    await client.login()
    print("eWeLink login successful.")
    
    # Start the background task
    asyncio.create_task(check_device_limits_periodically())


@app.on_event("shutdown")
async def shutdown_event():
    if client and client.wsh.is_connected:
        await client.close()
        print("eWeLink connection closed.")


# --- Pydantic Models for Data Validation ---
class StatusParams(BaseModel):
    switch: str # "on" or "off"

class Limits(BaseModel):
    tempHigh: float | None = None
    tempLow: float | None = None
    humidHigh: float | None = None
    humidLow: float | None = None

# --- API Endpoints ---
@app.get("/api/devices")
async def get_all_devices():
    if not client:
        raise HTTPException(status_code=503, detail="eWeLink client not initialized.")
    try:
        devices = await client.get_devices()
        # Add saved limits to the device data before sending
        for device in devices:
            if device.get("deviceid") in device_limits:
                device["itemData"]["limits"] = device_limits[device.get("deviceid")]
        # Mimic the nested structure of the Node.js version
        return {"error": 0, "data": {"thingList": devices}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/devices/{device_id}/status")
async def set_device_status(device_id: str, params: StatusParams):
    if not client:
        raise HTTPException(status_code=503, detail="eWeLink client not initialized.")
    try:
        await client.set_device_power_state(device_id, params.switch)
        return {"error": 0, "message": "Status updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/devices/{device_id}/limits")
def set_device_limits(device_id: str, limits: Limits):
    # .dict() converts the Pydantic model to a dictionary
    # exclude_unset=True removes any fields that were not provided in the request
    device_limits[device_id] = limits.dict(exclude_unset=True)
    print(f"Limits updated for device {device_id}: {device_limits[device_id]}")
    return {"message": "Limits saved successfully"}
