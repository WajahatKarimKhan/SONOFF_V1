import React, { useState, useEffect } from 'react';
import './App.css';

// --- SVG Icons ---
const PowerIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>;
const TempIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path></svg>;
const HumidityIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>;

function App() {
  const [session, setSession] = useState({ loggedIn: false });
  const [devices, setDevices] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // New: Use the production backend URL
  const backendUrl = 'https://aedesign-sonoff-backend.onrender.com';

  useEffect(() => {
    fetch(`${backendUrl}/api/session`)
      .then(res => res.json())
      .then(data => {
        setSession(data);
        setLoading(false);
      })
      .catch(err => {
        setError("Could not connect to backend. Is it running?");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (session.loggedIn) {
      setError(null);
      fetch(`${backendUrl}/api/devices`)
        .then(res => res.json())
        .then(data => {
          if (data && data.data && data.data.thingList) {
            setDevices(data.data.thingList);
          } else {
            setDevices([]);
          }
        })
        .catch(err => setError("Failed to fetch devices."));
    }
  }, [session.loggedIn]);

  const handleLogin = () => {
    // Point the login button to the live backend
    window.location.href = `${backendUrl}/auth/login`;
  };

  const handleToggle = async (device) => {
    const deviceId = device.itemData.deviceid;
    const currentStatus = device.itemData.params.switch;
    const newStatus = currentStatus === 'on' ? 'off' : 'on';

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

  const renderDevice = (device) => {
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
            <label className="toggle-switch">
              <input type="checkbox" checked={params.switch === 'on'} onChange={() => handleToggle(device)} disabled={!online} />
              <span className="slider"></span>
            </label>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="portal-layout">
      <div className="sidebar">
        <div className="sidebar-header">
          <h1>SONOFF Portal</h1>
        </div>
        <div className="sidebar-footer">
          <p>Region: {session.region?.toUpperCase() || 'N/A'}</p>
        </div>
      </div>
      <main className="main-content">
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
    </div>
  );
}

export default App;

