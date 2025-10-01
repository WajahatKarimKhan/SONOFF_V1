import os
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# --- Configuration (Reads from Render's Environment Variables) ---
EMAIL_USER = os.getenv("EMAIL_USER")
EMAIL_PASS = os.getenv("EMAIL_PASS") # Your 16-character Gmail App Password

# --- FastAPI App Initialization ---
app = FastAPI()

# Allow your Node.js backend to make requests to this service
# In a real-world scenario, you might want to restrict this to the specific URL
# of your Node.js service for better security.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allows any origin
    allow_credentials=True,
    allow_methods=["POST"],
    allow_headers=["*"],
)

# --- Pydantic Model for incoming alert data ---
class AlertPayload(BaseModel):
    recipient_email: str
    subject: str
    message: str

# --- Email Sending Function ---
def send_alert_email(recipient_email: str, subject: str, message: str):
    if not EMAIL_USER or not EMAIL_PASS:
        print("ERROR: EMAIL_USER or EMAIL_PASS environment variables are not set.")
        raise HTTPException(status_code=500, detail="Email service is not configured on the server.")

    email_message = MIMEMultipart("alternative")
    email_message["From"] = f"SONOFF Alerts <{EMAIL_USER}>"
    email_message["To"] = recipient_email
    email_message["Subject"] = subject
    
    html = f"""
    <html>
      <body>
        <p><b>SONOFF Device Alert:</b></p>
        <p>{message.replace('n', '<br>')}</p>
        <hr>
        <p><small>This is an automated alert from the AE Design Control System.</small></p>
      </body>
    </html>
    """
    email_message.attach(MIMEText(html, "html"))

    try:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
            server.login(EMAIL_USER, EMAIL_PASS)
            server.sendmail(EMAIL_USER, recipient_email, email_message.as_string())
        print(f"✅ Email alert sent successfully to {recipient_email}.")
        return {"status": "success", "message": "Email sent."}
    except Exception as e:
        print(f"❌ FAILED to send email. Error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send email: {e}")

# --- API Endpoint to Trigger Email ---
@app.post("/api/send-alert")
async def trigger_email_alert(payload: AlertPayload):
    """
    Receives alert data and triggers the email sending function.
    """
    return send_alert_email(
        recipient_email=payload.recipient_email,
        subject=payload.subject,
        message=payload.message
    )

@app.get("/")
def health_check():
    """A simple endpoint to confirm the service is running."""
    return {"status": "ok", "service": "Email Microservice"}
