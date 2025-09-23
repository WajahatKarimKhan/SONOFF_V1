import React, { useState, useEffect } from 'react';
import './App.css';

// --- SVG Icons ---
const PowerIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>;
const TempIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path></svg>;
const HumidityIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>;
const SettingsIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>;
const AlertIcon = () => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>;

// --- Components ---

// New: Modal for setting temperature and humidity limits
const LimitsModal = ({ device, onClose, onSave }) => {
    const [limits, setLimits] = useState({
        tempUpper: null,
        tempLower: null,
        humidUpper: null,
        humidLower: null,
    });

    const handleChange = (e) => {
        const { name, value } = e.target;
        // Allow empty string to clear the value, otherwise convert to number
        setLimits(prev => ({ ...prev, [name]: value === '' ? null : Number(value) }));
    };

    const handleSave = () => {
        onSave(device.itemData.deviceid, limits);
        onClose();
    };

    return (
        <div className="modal-backdrop">
            <div className="modal-content">
                <h2>Set Limits for {device.itemData.name}</h2>
                <div className="form-grid">
                    <div className="form-group">
                        <label>Max Temperature (°C)</label>
                        <input type="number" name="tempUpper" placeholder="e.g., 30" onChange={handleChange} />
                    </div>
                    <div className="form-group">
                        <label>Min Temperature (°C)</label>
                        <input type="number" name="tempLower" placeholder="e.g., 15" onChange={handleChange} />
                    </div>
                    <div className="form-group">
                        <label>Max Humidity (%)</label>
                        <input type="number" name="humidUpper" placeholder="e.g., 60" onChange={handleChange} />
                    </div>
                    <div className="form-group">
                        <label>Min Humidity (%)</label>
                        <input type="number" name="humidLower" placeholder="e.g., 40" onChange={handleChange} />
                    </div>
                </div>
                <div className="modal-actions">
                    <button onClick={onClose} className="button secondary">Cancel</button>
                    <button onClick={handleSave} className="button">Save Limits</button>
                </div>
            </div>
        </div>
    );
};

// New: Alert banner component
const AlertBanner = ({ alerts, onDismiss }) => {
    if (!alerts || alerts.length === 0) return null;
    return (
        <div className="alert-banner">
            {alerts.map(alert => (
                <div key={alert.id} className="alert-item">
                    <AlertIcon />
                    <span>{alert.message}</span>
                    <button onClick={() => onDismiss(alert.id)} className="dismiss-button">&times;</button>
                </div>
            ))}
        </div>
    );
};


function App() {
  const [session, setSession] = useState({ loggedIn: false });
  const [devices, setDevices] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [modalDevice, setModalDevice] = useState(null); // Which device to show the modal for
  const backendUrl = 'http://localhost:8000';

  // --- Data Fetching Effects ---
  useEffect(() => {
    // Fetch session on initial load
    fetch(`${backendUrl}/api/session`).then(res => res.json()).then(setSession).catch(() => setError("Could not connect to backend.")).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Fetch devices if logged in
    if (session.loggedIn) {
        fetch(`${backendUrl}/api/devices`).then(res => res.json()).then(data => {
            setDevices(data.data?.thingList || []);
        }).catch(() => setError("Failed to fetch devices."));
    }
  }, [session.loggedIn]);

  useEffect(() => {
      // Periodically fetch alerts
      if (session.loggedIn) {
          const interval = setInterval(() => {
              fetch(`${backendUrl}/api/alerts`).then(res => res.json()).then(setAlerts);
          }, 5000); // Check for new alerts every 5 seconds
          return () => clearInterval(interval);
      }
  }, [session.loggedIn]);

  // --- Event Handlers ---
  const handleLogin = () => {
    window.location.href = `${backendUrl}/auth/login`;
  };
  
  const handleToggle = async (device) => {
    // ... (This function is unchanged)
    const deviceId = device.itemData.deviceid;
    const newStatus = device.itemData.params.switch === 'on' ? 'off' : 'on';
    try {
        const response = await fetch(`${backendUrl}/api/devices/${deviceId}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ params: { switch: newStatus } }),
        });
        const result = await response.json();
        if (result.error === 0) {
            setDevices(current => current.map(d => d.itemData.deviceid === deviceId ? { ...d, itemData: { ...d.itemData, params: { ...d.itemData.params, switch: newStatus }}} : d));
        } else {
            setError('Failed to toggle device.');
        }
    } catch (err) {
        setError('An error occurred while toggling the device.');
    }
  };

  const handleSetLimits = async (deviceId, limits) => {
    try {
        await fetch(`${backendUrl}/api/devices/${deviceId}/limits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(limits),
        });
    } catch (err) {
        setError('Failed to save limits.');
    }
  };
  
  const handleDismissAlert = async (alertId) => {
      try {
          await fetch(`${backendUrl}/api/alerts/${alertId}`, { method: 'DELETE' });
          setAlerts(current => current.filter(a => a.id !== alertId));
      } catch (err) {
          setError('Failed to dismiss alert.');
      }
  };

  // --- Render Functions ---
  const renderDevice = (device) => {
    // ... (This function has one addition: the "Set Limits" button)
    const { name, online, deviceid, params, extra } = device.itemData;
    const isSwitch = params && typeof params.switch !== 'undefined';
    const hasTemp = params && typeof params.currentTemperature !== 'undefined';
    const hasHumid = params && typeof params.currentHumidity !== 'undefined';
    
    return (
      <div key={deviceid} className={`device-card ${online ? 'online' : ''}`}>
        <div className="device-header">
          <h3>{name}</h3>
          <span className={`status-dot ${online ? 'online' : ''}`}></span>
        </div>
        <p className="device-info">Type: UID {extra.uiid}</p>
        
        <div className="sensor-grid">
          {hasTemp && <div className="sensor-reading"><TempIcon /> <strong>{params.currentTemperature !== 'unavailable' ? `${params.currentTemperature}°C` : 'N/A'}</strong></div>}
          {hasHumid && <div className="sensor-reading"><HumidityIcon /> <strong>{params.currentHumidity !== 'unavailable' ? `${params.currentHumidity}%` : 'N/A'}</strong></div>}
        </div>
        
        {isSwitch && (
          <div className="device-control">
            <div className="control-label"><PowerIcon /> Power</div>
            <label className="toggle-switch"><input type="checkbox" checked={params.switch === 'on'} onChange={() => handleToggle(device)} disabled={!online} /><span className="slider"></span></label>
          </div>
        )}

        {(hasTemp || hasHumid) && (
            <div className="device-control">
                <div className="control-label"><SettingsIcon /> Alerts</div>
                <button className="button small" onClick={() => setModalDevice(device)}>Set Limits</button>
            </div>
        )}
      </div>
    );
  };

  return (
    <div className="portal-layout">
      <div className="sidebar">
        {/* ... (Sidebar is unchanged) */}
        <div className="sidebar-header"><h1>SONOFF Portal</h1></div>
        <div className="sidebar-footer"><p>Region: {session.region?.toUpperCase() || 'N/A'}</p></div>
      </div>
      <main className="main-content">
        <AlertBanner alerts={alerts} onDismiss={handleDismissAlert} />
        <div className="page-header">
            <h2>Device Dashboard</h2>
            <p>View and control your eWeLink devices.</p>
        </div>
        
        {error && <div className="error">{error}</div>}

        {loading ? <p>Loading...</p> : !session.loggedIn ? (
          <div className="login-card">
            <h3>Welcome</h3>
            <p>Please connect your eWeLink account to continue.</p>
            <button className="button" onClick={handleLogin}>Login with eWeLink</button>
          </div>
        ) : (
          <div className="device-grid">
            {devices === null ? <p>Loading devices...</p> : devices.length > 0 ? devices.map(renderDevice) : <p>No devices found.</p>}
          </div>
        )}
      </main>
      
      {modalDevice && <LimitsModal device={modalDevice} onClose={() => setModalDevice(null)} onSave={handleSetLimits} />}
    </div>
  );
}

export default App;


