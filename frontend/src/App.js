import './App.css';
import React, { useMemo, useState } from 'react';

import EldLogCanvas from './components/EldLogCanvas';
import TripMap from './components/TripMap';

function formatDurationMinutes(mins) {
  const n = Number(mins);
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '0 min';
  if (n < 60) return `${n} min`;
  if (n % 60 === 0) {
    const h = n / 60;
    return h === 1 ? '1 hr' : `${h} hrs`;
  }
  const h = Math.floor(n / 60);
  const m = n % 60;
  const hPart = h === 1 ? '1 hr' : `${h} hrs`;
  return `${hPart} ${m} min`;
}

function App() {
  const [currentLocation, setCurrentLocation] = useState('Chicago, IL');
  const [pickupLocation, setPickupLocation] = useState('Dallas, TX');
  const [dropoffLocation, setDropoffLocation] = useState('New York, NY');
  const [cycleUsedHours, setCycleUsedHours] = useState(40);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const dailyLogs = result?.daily_logs || [];
  const stops = result?.stops || [];

  const canSubmit = useMemo(() => {
    return (
      currentLocation.trim() &&
      pickupLocation.trim() &&
      dropoffLocation.trim() &&
      Number.isFinite(Number(cycleUsedHours))
    );
  }, [currentLocation, pickupLocation, dropoffLocation, cycleUsedHours]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setResult(null);

    if (!canSubmit) {
      setError('Please fill out all fields.');
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch('http://localhost:8000/api/plan/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_location: currentLocation,
          pickup_location: pickupLocation,
          dropoff_location: dropoffLocation,
          cycle_used_hours: Number(cycleUsedHours),
        }),
      });

      const data = await resp.json().catch(() => null);

      if (!resp.ok) {
        const message =
          data?.error?.message ||
          data?.detail ||
          `Request failed (${resp.status})`;
        throw new Error(message);
      }

      setResult(data);
    } catch (err) {
      setError(err?.message || 'Failed to plan trip.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="AppShell">
      <div className="TopBar">
        <div className="TopBarTitle">HOS Trip Planner</div>
        <div className="TopBarSubtitle">Stops + ELD log sheets</div>
      </div>

      <div className="Layout">
        <div className="Left">
          <div className="Card">
            <div className="CardHeader">
              <h2 className="CardTitle">Trip inputs</h2>
              <div className="CardSubtitle">Plan a route and generate HOS-compliant stops and daily logs</div>
            </div>

            <form className="Form" onSubmit={onSubmit}>
              <label className="Field">
                <div className="FieldLabel">Current Location</div>
                <input
                  className="Input"
                  value={currentLocation}
                  onChange={(e) => setCurrentLocation(e.target.value)}
                  placeholder="Chicago, IL"
                />
              </label>

              <label className="Field">
                <div className="FieldLabel">Pickup Location</div>
                <input
                  className="Input"
                  value={pickupLocation}
                  onChange={(e) => setPickupLocation(e.target.value)}
                  placeholder="Dallas, TX"
                />
              </label>

              <label className="Field">
                <div className="FieldLabel">Dropoff Location</div>
                <input
                  className="Input"
                  value={dropoffLocation}
                  onChange={(e) => setDropoffLocation(e.target.value)}
                  placeholder="New York, NY"
                />
              </label>

              <label className="Field">
                <div className="FieldLabel">Current Cycle Used Hours</div>
                <input
                  className="Input"
                  type="number"
                  step="0.25"
                  min="0"
                  value={cycleUsedHours}
                  onChange={(e) => setCycleUsedHours(e.target.value)}
                />
              </label>

              <button className="Button" type="submit" disabled={!canSubmit || loading}>
                {loading ? 'Planning…' : 'Plan Trip'}
              </button>

              {error ? <div className="Error">{error}</div> : null}
            </form>
          </div>

          {result ? (
            <div className="Card">
              <div className="CardHeader">
                <h2 className="CardTitle">Stops</h2>
                <div className="CardSubtitle">{stops.length} items</div>
              </div>
              <div className="StopsList">
                {stops.map((s, idx) => (
                  <div className="StopRow" key={`${s.type}-${idx}`}>
                    <div className="StopType">{s.type}</div>
                    <div className="StopMain">
                      <div className="StopLoc">{s.location}</div>
                      <div className="StopMeta">
                        <span>{s.start_time}</span>
                        <span className="Dot">•</span>
                        <span>{formatDurationMinutes(s.duration)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="Right">
          {result ? <TripMap stops={stops} /> : <div className="EmptyState">Submit the form to see map + logs.</div>}

          {Array.isArray(dailyLogs) && dailyLogs.length ? (
            <div className="Stack">
              {dailyLogs.map((d) => (
                <EldLogCanvas key={d.date} date={d.date} segments={d.segments} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default App;
