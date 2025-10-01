import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

# --- Configuration (Reads from Render Environment Variables) ---
# Your "From" email, which you will verify on SendGrid
EMAIL_USER = os.getenv("EMAIL_USER")
# The API key you will create in the SendGrid dashboard
SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY")

# --- FastAPI App Initialization ---
app = FastAPI()

# Allow requests from any origin. You could restrict this to your Node.js backend's URL for better security.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["POST"],
    allow_headers=["*"],
)

# --- Pydantic Model for incoming alert data ---
class AlertPayload(BaseModel):
    recipient_email: str
    subject: str
    message: str

# --- API Endpoint to Trigger Email ---
@app.post("/api/send-alert")
async def trigger_email_alert(payload: AlertPayload):
    """
    Receives alert data and triggers an email using the SendGrid API.
    """
    if not SENDGRID_API_KEY or not EMAIL_USER:
        print("ERROR: SENDGRID_API_KEY or EMAIL_USER environment variables are not set.")
        raise HTTPException(status_code=500, detail="Email service is not configured on the server.")

    # Create the email message object using SendGrid's helper
    html_content = f"""
    <html>
      <body>
        <p><b>SONOFF Device Alert:</b></p>
        <p>{payload.message.replace('n', '<br>')}</p>
        <hr>
        <p><small>This is an automated alert from the AE Design Control System.</small></p>
      </body>
    </html>
    """
    
    message = Mail(
        from_email=EMAIL_USER,
        to_emails=payload.recipient_email,
        subject=payload.subject,
        html_content=html_content
    )

    # Send the email using the SendGrid API client
    try:
        sg = SendGridAPIClient(SENDGRID_API_KEY)
        response = sg.send(message)
        print(f"✅ Email alert sent via SendGrid to {payload.recipient_email}. Status Code: {response.status_code}")
        return {"status": "success", "message": "Email sent via SendGrid."}
    except Exception as e:
        print(f"❌ FAILED to send email via SendGrid. Error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send email via SendGrid: {e}")

@app.get("/")
def health_check():
    """A simple endpoint to confirm the service is running."""
    return {"status": "ok", "service": "Email Microservice (SendGrid)"}
