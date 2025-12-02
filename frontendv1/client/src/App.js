import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Zap, AlertTriangle, ShieldCheck, Server, Thermometer, Wifi } from 'lucide-react';

// ================= CONFIGURATION =================
// SECURE WebSocket URL for Render (wss://)
const WS_URL = "wss://smartgridxbackend.onrender.com/ws/client"; 

// ================= COMPONENT: GAUGE CARD =================
const StatCard = ({ label, value, unit, icon: Icon, color }) => (
  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
      <div className="flex items-end gap-1 mt-1">
        <span className="text-2xl font-bold text-slate-800">{value}</span>
        <span className="text-sm font-medium text-slate-400 mb-1">{unit}</span>
      </div>
    </div>
    <div className={`p-3 rounded-full ${color} bg-opacity-10`}>
      <Icon size={20} className={color.replace('bg-', 'text-')} />
    </div>
  </div>
);

// ================= COMPONENT: RELAY BUTTON =================
const RelayButton = ({ index, state, onClick }) => (
  <button
    onClick={() => onClick(index, !state)}
    className={`w-full p-4 rounded-xl border transition-all duration-200 flex items-center justify-between group
      ${state 
        ? 'bg-amber-500 border-amber-500 shadow-lg shadow-amber-500/30' 
        : 'bg-white border-slate-200 hover:border-slate-300'}`}
  >
    <div className="flex items-center gap-3">
      <div className={`w-2 h-2 rounded-full ${state ? 'bg-white animate-pulse' : 'bg-slate-300'}`} />
      <span className={`font-semibold ${state ? 'text-white' : 'text-slate-600'}`}>
        Circuit {index + 1}
      </span>
    </div>
    <div className={`text-xs font-bold px-2 py-1 rounded uppercase
      ${state ? 'bg-white text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
      {state ? 'ON' : 'OFF'}
    </div>
  </button>
);

// ================= MAIN APP =================
const App = () => {
  const [socket, setSocket] = useState(null);
  const [systemData, setSystemData] = useState(null);
  const [trendData, setTrendData] = useState([]);

  // WebSocket Connection
  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("Connected to Backend");
      setSocket(ws);
    };

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === "update") {
        setSystemData(payload.data);
        
        // Update Chart Data (Keep last 20 points)
        setTrendData(prev => {
          const newData = [...prev, {
            time: new Date().toLocaleTimeString(),
            grid: payload.data.pole.power,
            house: payload.data.house.power
          }];
          return newData.slice(-20);
        });
      }
    };

    ws.onclose = () => setSocket(null);
    return () => ws.close();
  }, []);

  const toggleRelay = (index, newState) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      const cmd = {
        action: "set_relay",
        relay_index: index,
        state: newState
      };
      socket.send(JSON.stringify(cmd));
    }
  };

  if (!systemData) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400">
      <div className="flex flex-col items-center gap-4">
        <Zap className="animate-bounce text-amber-500" size={48} />
        <p>Connecting to Smart Gridx...</p>
      </div>
    </div>
  );

  const { pole, house, alerts } = systemData;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans text-slate-800">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* HEADER */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-4">
            <div className="bg-gradient-to-br from-amber-500 to-orange-600 p-3 rounded-xl shadow-lg shadow-amber-500/20">
              <Activity className="text-white" size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Smart Gridx</h1>
              <p className="text-sm text-slate-500 font-medium">IoT Monitoring & Predictive Maintenance</p>
            </div>
          </div>
          <div className="flex gap-4">
             <div className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 border
              ${pole.connected ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                <Wifi size={16} /> Grid Node: {pole.connected ? 'Online' : 'Offline'}
             </div>
             <div className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 border
              ${house.connected ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                <Server size={16} /> SPAN Panel: {house.connected ? 'Online' : 'Offline'}
             </div>
          </div>
        </header>

        {/* ALERTS SECTION (Conditional) */}
        {alerts.theft_detected && (
          <div className="bg-red-50 border border-red-200 p-4 rounded-xl flex items-center gap-4 animate-pulse">
            <div className="bg-red-100 p-2 rounded-full"><AlertTriangle className="text-red-600" /></div>
            <div>
              <h3 className="font-bold text-red-700">THEFT DETECTED</h3>
              <p className="text-sm text-red-600">Power mismatch detected between Pole and House. Inspect line immediately.</p>
            </div>
          </div>
        )}

        {alerts.maintenance_risk && (
          <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl flex items-center gap-4">
            <div className="bg-orange-100 p-2 rounded-full"><Activity className="text-orange-600" /></div>
            <div>
              <h3 className="font-bold text-orange-700">PREDICTIVE MAINTENANCE ALERT</h3>
              <p className="text-sm text-orange-600">Risk Score: {alerts.risk_score}. High probability of failure due to current/temp deviation.</p>
            </div>
          </div>
        )}

        {/* MAIN GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* LEFT COL: POLE / GRID SIDE */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="text-slate-400" size={20} />
              <h2 className="text-lg font-bold text-slate-700">Grid Source (Pole)</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="Input Voltage" value={pole.voltage.toFixed(1)} unit="V" icon={Zap} color="text-amber-500 bg-amber-500" />
              <StatCard label="Grid Power" value={pole.power.toFixed(0)} unit="W" icon={Activity} color="text-amber-500 bg-amber-500" />
              <StatCard label="Frequency" value={pole.frequency.toFixed(1)} unit="Hz" icon={Activity} color="text-blue-500 bg-blue-500" />
              <StatCard label="Power Factor" value={pole.pf.toFixed(2)} unit="" icon={ShieldCheck} color="text-emerald-500 bg-emerald-500" />
            </div>

            {/* CHART */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-80">
              <h3 className="text-sm font-bold text-slate-500 uppercase mb-6">Real-time Power Trend</h3>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="colorGrid" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorHouse" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="time" hide />
                  <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} 
                  />
                  <Area type="monotone" dataKey="grid" stroke="#f59e0b" fillOpacity={1} fill="url(#colorGrid)" strokeWidth={2} name="Grid Power" />
                  <Area type="monotone" dataKey="house" stroke="#3b82f6" fillOpacity={1} fill="url(#colorHouse)" strokeWidth={2} name="House Power" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* RIGHT COL: HOUSE / SPAN SIDE */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 mb-2">
              <Server className="text-slate-400" size={20} />
              <h2 className="text-lg font-bold text-slate-700">Smart Home (SPAN Panel)</h2>
            </div>
            
            {/* HOUSE STATS */}
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="Consumption" value={house.power.toFixed(0)} unit="W" icon={Zap} color="text-blue-500 bg-blue-500" />
              <StatCard label="Current Draw" value={house.current.toFixed(2)} unit="A" icon={Activity} color="text-blue-500 bg-blue-500" />
              <StatCard label="Temperature" value={house.temperature.toFixed(1)} unit="°C" icon={Thermometer} color={house.temperature > 40 ? "text-red-500 bg-red-500" : "text-emerald-500 bg-emerald-500"} />
              <StatCard label="Total Energy" value={house.energy.toFixed(2)} unit="kWh" icon={Zap} color="text-purple-500 bg-purple-500" />
            </div>

            {/* RELAY CONTROLS */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold text-slate-500 uppercase mb-4">Circuit Control (SPAN Relays)</h3>
              <div className="grid grid-cols-2 gap-4">
                {house.relays.map((state, idx) => (
                  <RelayButton 
                    key={idx} 
                    index={idx} 
                    state={state} 
                    onClick={toggleRelay} 
                  />
                ))}
              </div>
            </div>

            {/* PREDICTIVE MAINTENANCE CARD */}
            <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg relative overflow-hidden">
               <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white opacity-5 rounded-full blur-2xl"></div>
               <h3 className="text-sm font-bold text-slate-400 uppercase mb-2">AI Health Monitor</h3>
               <div className="flex items-end justify-between">
                 <div>
                   <p className="text-3xl font-bold">{alerts.risk_score}</p>
                   <p className="text-xs text-slate-400">Risk Probability (Px)</p>
                 </div>
                 <div className="text-right">
                   <p className={`font-bold ${alerts.maintenance_risk ? 'text-orange-400' : 'text-emerald-400'}`}>
                     {alerts.maintenance_risk ? 'MAINTENANCE NEEDED' : 'OPTIMAL CONDITION'}
                   </p>
                   <p className="text-xs text-slate-500">{systemData.alerts.message}</p>
                 </div>
               </div>
               {/* Health Bar */}
               <div className="w-full h-2 bg-slate-700 rounded-full mt-4 overflow-hidden">
                 <div 
                   className={`h-full transition-all duration-500 ${alerts.maintenance_risk ? 'bg-orange-500' : 'bg-emerald-500'}`}
                   style={{ width: `${Math.min(alerts.risk_score * 100, 100)}%` }}
                 />
               </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};

export default App;
