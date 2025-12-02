import json
import asyncio
import logging
from typing import Dict, List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime

# ================= CONFIGURATION =================
app = FastAPI(title="Smart Gridx Backend")

# Allow CORS for React Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Logger setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("SmartGridx")

# ================= STATE MANAGEMENT =================
# We store the latest data in memory to compare nodes
system_state = {
    "pole": {
        "connected": False,
        "power": 0.0,
        "voltage": 0.0,
        "current": 0.0,
        "energy": 0.0,
        "pf": 0.0,
        "frequency": 0.0,
        "last_seen": None
    },
    "house": {
        "connected": False,
        "power": 0.0,
        "voltage": 0.0,
        "current": 0.0,
        "energy": 0.0,
        "temperature": 25.0, # Default
        "relays": [False, False, False, False],
        "last_seen": None
    },
    "alerts": {
        "theft_detected": False,
        "maintenance_risk": False,
        "risk_score": 0.0, # Px value
        "message": "System Normal"
    }
}

# ================= WEBSOCKET MANAGER =================
class ConnectionManager:
    def __init__(self):
        # We allow multiple frontend clients (dashboards)
        self.frontend_connections: List[WebSocket] = []
        # We track hardware connections specifically
        self.hardware_connections: Dict[str, WebSocket] = {}

    async def connect_frontend(self, websocket: WebSocket):
        await websocket.accept()
        self.frontend_connections.append(websocket)
        logger.info("New Frontend Connected")

    def disconnect_frontend(self, websocket: WebSocket):
        if websocket in self.frontend_connections:
            self.frontend_connections.remove(websocket)

    async def connect_hardware(self, websocket: WebSocket, device_type: str):
        await websocket.accept()
        self.hardware_connections[device_type] = websocket
        logger.info(f"Hardware Connected: {device_type}")
        
        # Update connection status
        if device_type == "pole":
            system_state["pole"]["connected"] = True
        elif device_type == "house":
            system_state["house"]["connected"] = True
            
        await self.broadcast_state()

    def disconnect_hardware(self, device_type: str):
        if device_type in self.hardware_connections:
            del self.hardware_connections[device_type]
        
        if device_type == "pole":
            system_state["pole"]["connected"] = False
        elif device_type == "house":
            system_state["house"]["connected"] = False
            
        logger.info(f"Hardware Disconnected: {device_type}")

    async def broadcast_state(self):
        # Send full system state to all frontends
        payload = json.dumps({
            "type": "update",
            "timestamp": datetime.now().isoformat(),
            "data": system_state
        })
        for connection in self.frontend_connections:
            try:
                await connection.send_text(payload)
            except:
                pass

    async def send_command_to_house(self, command: dict):
        # Send control command to ESP32 House Node
        if "house" in self.hardware_connections:
            try:
                await self.hardware_connections["house"].send_text(json.dumps(command))
                logger.info(f"Sent command to House: {command}")
            except Exception as e:
                logger.error(f"Failed to send command: {e}")

manager = ConnectionManager()

# ================= MATH MODELS (The "Brain") =================

def run_theft_detection():
    """
    Logic: If Pole sends 500W but House receives 300W, 
    then 200W is being stolen (or lost).
    Threshold: > 20 Watts difference is considered theft/leakage.
    """
    pole_p = system_state["pole"]["power"]
    house_p = system_state["house"]["power"]
    
    # Only run if both are connected and values are non-zero
    if system_state["pole"]["connected"] and system_state["house"]["connected"]:
        loss = pole_p - house_p
        
        # Tolerance of 20 Watts (wire resistance/measurement error)
        if loss > 20.0: 
            system_state["alerts"]["theft_detected"] = True
            return f"THEFT DETECTED! {loss:.1f}W unaccounted for."
    
    system_state["alerts"]["theft_detected"] = False
    return None

def run_predictive_maintenance():
    """
    SRS Section 5.5: Px = a1(Idev) + a2(Tdev) + ...
    We use:
    - Idev: Deviation of Current from 'Safe Limit' (e.g., 15 Amps)
    - Tdev: Deviation of Temp from 'Safe Limit' (e.g., 50 Celsius)
    """
    current = system_state["house"]["current"]
    temp = system_state["house"]["temperature"]
    
    # 1. Normalize values (Simplified for FYP demo)
    # If Current > 10A, risk increases
    i_dev = max(0, (current - 10.0) / 10.0) 
    
    # If Temp > 40C, risk increases
    t_dev = max(0, (temp - 40.0) / 40.0)
    
    # 2. Weights (Alpha values)
    alpha_1 = 0.6 # Current is most important
    alpha_2 = 0.4 # Temp is secondary
    
    # 3. Calculate Px
    Px = (alpha_1 * i_dev) + (alpha_2 * t_dev)
    
    system_state["alerts"]["risk_score"] = round(Px, 2)
    
    if Px > 0.7:
        system_state["alerts"]["maintenance_risk"] = True
        return f"CRITICAL: High Failure Risk (Score: {Px:.2f})"
    
    system_state["alerts"]["maintenance_risk"] = False
    return None

def update_system_logic():
    msg_theft = run_theft_detection()
    msg_maint = run_predictive_maintenance()
    
    if msg_theft:
        system_state["alerts"]["message"] = msg_theft
    elif msg_maint:
        system_state["alerts"]["message"] = msg_maint
    else:
        system_state["alerts"]["message"] = "System Healthy"

# ================= ENDPOINTS =================

@app.get("/")
def read_root():
    return {"status": "Smart Gridx Backend Running"}

@app.websocket("/ws/hardware/pole")
async def websocket_pole(websocket: WebSocket):
    await manager.connect_hardware(websocket, "pole")
    try:
        while True:
            data = await websocket.receive_text()
            # Parse ESP32 Data
            payload = json.loads(data)
            
            # Update State
            system_state["pole"].update({
                "voltage": payload.get("voltage", 0),
                "current": payload.get("current", 0),
                "power": payload.get("power", 0),
                "energy": payload.get("energy", 0),
                "frequency": payload.get("frequency", 0),
                "pf": payload.get("pf", 0),
                "last_seen": datetime.now().isoformat()
            })
            
            update_system_logic()
            await manager.broadcast_state()
            
    except WebSocketDisconnect:
        manager.disconnect_hardware("pole")
        await manager.broadcast_state()

@app.websocket("/ws/hardware/house")
async def websocket_house(websocket: WebSocket):
    await manager.connect_hardware(websocket, "house")
    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            
            # Helper to extract nested json
            sensors = payload.get("sensors", {})
            relays = payload.get("relays", [False, False, False, False])
            
            system_state["house"].update({
                "voltage": sensors.get("voltage", 0),
                "current": sensors.get("current", 0),
                "power": sensors.get("power", 0),
                "energy": sensors.get("energy", 0),
                "temperature": sensors.get("temperature", 25),
                "pf": sensors.get("pf", 0),
                "relays": relays,
                "last_seen": datetime.now().isoformat()
            })
            
            update_system_logic()
            await manager.broadcast_state()
            
    except WebSocketDisconnect:
        manager.disconnect_hardware("house")
        await manager.broadcast_state()

@app.websocket("/ws/client")
async def websocket_frontend(websocket: WebSocket):
    await manager.connect_frontend(websocket)
    try:
        # Send initial state immediately
        await manager.broadcast_state()
        
        while True:
            # Listen for commands from React (e.g., Turn Relay OFF)
            data = await websocket.receive_text()
            command = json.loads(data)
            
            if command.get("action") == "set_relay":
                # Forward to ESP32 House Node
                await manager.send_command_to_house(command)
                
    except WebSocketDisconnect:
        manager.disconnect_frontend(websocket)
