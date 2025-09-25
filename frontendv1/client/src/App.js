import React, { useState, useEffect } from 'react';
import './App.css';

// --- SVG Icons ---
const PowerIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>;
const TempIcon = () => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path></svg>;
const HumidityIcon = () => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>;
const AlertIcon = () => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>;


function App() {
  const [session, setSession] = useState({ loggedIn: false });
  const [devices, setDevices] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [alerts, setAlerts] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);

  const backendUrl = 'https://aedesign-sonoff-backend.onrender.com';

  useEffect(() => {
    fetch(`${backendUrl}/api/session`)
      .then(res => res.json())
      .then(data => { setSession(data); setLoading(false); })
      .catch(err => { setError("Could not connect to backend."); setLoading(false); });
  }, []);

  useEffect(() => {
    if (session.loggedIn) {
      setError(null);
      
      const fetchAllData = () => {
          fetch(`${backendUrl}/api/devices`)
            .then(res => res.json())
            .then(data => setDevices(data.data?.thingList || []))
            .catch(err => setError("Failed to fetch devices."));

          fetch(`${backendUrl}/api/alerts`)
            .then(res => res.json())
            .then(setAlerts)
            .catch(err => console.error("Failed to fetch alerts"));
      };

      fetchAllData();
      const interval = setInterval(fetchAllData, 30000);
      return () => clearInterval(interval);
    }
  }, [session.loggedIn]);

  const handleLogin = () => {
    window.location.href = `${backendUrl}/auth/login`;
  };

  const handleToggle = async (device) => {
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
        setDevices(currentDevices =>
          currentDevices.map(d =>
            d.itemData.deviceid === deviceId
              ? { ...d, itemData: { ...d.itemData, params: { ...d.itemData.params, switch: newStatus } } }
              : d
          )
        );
      } else {
        setError('Failed to toggle device.');
      }
    } catch (err) {
      setError('An error occurred while toggling the device.');
    }
  };

  const handleOpenModal = (device) => {
    setEditingDevice(device);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingDevice(null);
  };

  const handleSaveLimits = async (limits) => { // Email parameter removed
    const deviceId = editingDevice.itemData.deviceid;
    try {
        await fetch(`${backendUrl}/api/devices/${deviceId}/limits`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limits }), // Email no longer sent
        });
        const res = await fetch(`${backendUrl}/api/devices`);
        const data = await res.json();
        setDevices(data.data?.thingList || []);
        handleCloseModal();
    } catch (err) {
        setError('Failed to save limits.');
    }
  };

  const handleDismissAlert = async (alertId) => {
      try {
          await fetch(`${backendUrl}/api/alerts/${alertId}`, { method: 'DELETE' });
          setAlerts(currentAlerts => currentAlerts.filter(a => a.id !== alertId));
      } catch (err) {
          console.error("Failed to dismiss alert");
      }
  };

  const renderDevice = (device) => {
    const { name, online, deviceid, params } = device.itemData;
    const isSwitch = params?.switch !== undefined;
    
    return (
      <div key={deviceid} className={`device-card ${online ? 'online' : ''}`}>
        <div className="card-header">
            <h3>{name}</h3>
            <span className={`status-dot ${online ? 'online' : ''}`}></span>
        </div>
        
        <div className="sensor-display">
            <div className="sensor-item">
                <TempIcon />
                <div className="sensor-value">{params.currentTemperature !== 'unavailable' ? `${params.currentTemperature}°C` : 'N/A'}</div>
                <div className="sensor-label">Temperature</div>
            </div>
            <div className="sensor-item">
                <HumidityIcon />
                <div className="sensor-value">{params.currentHumidity !== 'unavailable' ? `${params.currentHumidity}%` : 'N/A'}</div>
                <div className="sensor-label">Humidity</div>
            </div>
        </div>

        {params.sensorType === 'errorType' && <p className="sensor-error">Sensor not detected. Please check the connection.</p>}
        
        <div className="controls-footer">
            {isSwitch && (
                <div className="control-item">
                    <PowerIcon />
                    <label className="toggle-switch">
                        <input type="checkbox" checked={params.switch === 'on'} onChange={() => handleToggle(device)} disabled={!online} />
                        <span className="slider"></span>
                    </label>
                </div>
            )}
            <button className="button-secondary" onClick={() => handleOpenModal(device)}>Set Limits</button>
        </div>
      </div>
    );
  };

  return (
    <div className="app-container">
        <header className="app-header">
            <h1>Temperature & Humidity Control</h1>
            <div className="header-brand">
                SONOFF Portal
            </div>
        </header>

        <main className="main-content">
            {error && <div className="error-banner">{error}</div>}

            {alerts.length > 0 && (
                <div className="alerts-container">
                    {alerts.map(alert => (
                        <div key={alert.id} className="alert-banner">
                            <AlertIcon />
                            <div className="alert-content">
                                {alert.message}
                            </div>
                            <button onClick={() => handleDismissAlert(alert.id)} className="dismiss-button">&times;</button>
                        </div>
                    ))}
                </div>
            )}

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

        {isModalOpen && <LimitsModal device={editingDevice} onSave={handleSaveLimits} onClose={handleCloseModal} />}
    </div>
  );
}

const LimitsModal = ({ device, onSave, onClose }) => {
    // Email state is no longer needed here
    const [limits, setLimits] = useState({
        tempHigh: device.itemData.limits?.tempHigh || '',
        tempLow: device.itemData.limits?.tempLow || '',
        humidHigh: device.itemData.limits?.humidHigh || '',
        humidLow: device.itemData.limits?.humidLow || '',
    });

    const handleChange = (e) => {
        const { name, value } = e.target;
        setLimits(prev => ({ ...prev, [name]: value === '' ? '' : parseFloat(value) }));
    };

    const handleSave = () => {
        // Only include limits that have a value
        const finalLimits = Object.entries(limits).reduce((acc, [key, value]) => {
            if (value !== '') acc[key] = value;
            return acc;
        }, {});
        onSave(finalLimits); // Email is no longer passed
    };

    return (
        <div className="modal-backdrop">
            <div className="modal-content">
                <h2>Set Limits for {device.itemData.name}</h2>
                <p className="modal-subtitle">Alerts will be sent to the pre-configured administrator email.</p>
                <div className="form-grid">
                    <div className="form-group">
                        <label>Temp {'>'} (°C)</label>
                        <input type="number" name="tempHigh" value={limits.tempHigh} onChange={handleChange} placeholder="e.g., 30" />
                    </div>
                    <div className="form-group">
                        <label>Temp &lt; (°C)</label>
                        <input type="number" name="tempLow" value={limits.tempLow} onChange={handleChange} placeholder="e.g., 15" />
                    </div>
                    <div className="form-group">
                        <label>Humidity {'>'} (%)</label>
                        <input type="number" name="humidHigh" value={limits.humidHigh} onChange={handleChange} placeholder="e.g., 80" />
                    </div>
                    <div className="form-group">
                        <label>Humidity &lt; (%)</label>
                        <input type="number" name="humidLow" value={limits.humidLow} onChange={handleChange} placeholder="e.g., 40" />
                    </div>
                </div>
                <div className="modal-actions">
                    <button className="button-secondary" onClick={onClose}>Cancel</button>
                    <button className="button" onClick={handleSave}>Save Limits</button>
                </div>
            </div>
        </div>
    );
};

export default App;

