import './App.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import EldLogSheet from './components/EldLogSheet';
import TripMap from './components/TripMap';
import { describeStops, timeZoneLabel } from './utils/stops';

// Backend base URL. Override with REACT_APP_API_URL (e.g. http://localhost:8000 for local dev).
const API_URL = (
  process.env.REACT_APP_API_URL || 'https://spotter-hos-app-e2aab.containers.snapdeploy.app'
).replace(/\/+$/, '');

// A normal request takes several seconds; past this, the free-tier backend is probably waking from idle.
const WAKE_NOTICE_DELAY_MS = 15000;

// Cold-start handling for the free-tier backend (it boots in roughly a minute after sleeping).
const REQUEST_TIMEOUT_MS = 30000; // per attempt; a normal warm request finishes in ~8-14s
const RETRY_DELAY_MS = 10000;
const MAX_ATTEMPTS = 7; // first try + 6 retries, ~60s of waiting in total

// Connectivity-class failure (network error, timeout, platform "waking up" page); safe to retry.
class RetryableError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function postPlan(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let resp;
    try {
      resp = await fetch(`${API_URL}/api/plan/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      throw new RetryableError(err?.name === 'AbortError' ? 'Request timed out.' : err?.message || 'Failed to fetch');
    }

    const data = await resp.json().catch(() => null);
    if (resp.ok) return data;

    const message = data?.error?.message || data?.detail;
    // A JSON error body means the app itself answered; anything else (e.g. a 503 HTML page) is the platform.
    if (message) throw new Error(message);
    throw new RetryableError(`Request failed (${resp.status})`);
  } finally {
    clearTimeout(timer);
  }
}

function App() {
  const [currentLocation, setCurrentLocation] = useState('Chicago, IL');
  const [pickupLocation, setPickupLocation] = useState('Dallas, TX');
  const [dropoffLocation, setDropoffLocation] = useState('New York, NY');
  const [cycleUsedHours, setCycleUsedHours] = useState(20);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [showWakeNotice, setShowWakeNotice] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0); // failed attempts so far during a cold-start retry
  const serverReached = useRef(false); // true once the API has answered at all
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      setShowWakeNotice(false);
      return undefined;
    }
    const timer = setTimeout(() => setShowWakeNotice(true), WAKE_NOTICE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  const dailyLogs = result?.daily_logs || [];
  const stops = useMemo(() => result?.stops || [], [result]);
  const stopDays = useMemo(() => describeStops(stops), [stops]);
  const zoneLabel = useMemo(() => timeZoneLabel(), []);

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

    const payload = {
      current_location: currentLocation,
      pickup_location: pickupLocation,
      dropoff_location: dropoffLocation,
      cycle_used_hours: Number(cycleUsedHours),
    };

    setLoading(true);
    try {
      for (let attempt = 1; ; attempt += 1) {
        try {
          const data = await postPlan(payload);
          serverReached.current = true;
          setResult(data);
          return;
        } catch (err) {
          if (!(err instanceof RetryableError)) {
            serverReached.current = true;
            throw err;
          }
          // Only a server we have never reached can be mid-boot; otherwise report the failure right away.
          if (serverReached.current) throw err;
          if (attempt >= MAX_ATTEMPTS) {
            throw new Error(`The server did not start in time (${err.message}). Please try again in a moment.`);
          }
          setRetryAttempt(attempt);
          await sleep(RETRY_DELAY_MS);
          if (!mounted.current) return;
        }
      }
    } catch (err) {
      setError(err?.message || 'Failed to plan trip.');
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRetryAttempt(0);
      }
    }
  }

  return (
    <div className="AppShell">
      {/*
        Cold-start wake trigger. The free-tier host only wakes a sleeping container when a real browser
        loads its page (the wake page runs its own script); fetch/XHR never does. This hidden iframe loads
        the bare backend URL once on page load. Its content is never used.
      */}
      <iframe
        src={`${API_URL}/`}
        title="Backend wake-up"
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: 'absolute', width: 0, height: 0, border: 0, visibility: 'hidden' }}
      />
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

              {retryAttempt > 0 ? (
                <div className="Notice" role="status">
                  Starting up the server, this can take up to a minute... Retrying automatically (attempt{' '}
                  {retryAttempt + 1} of {MAX_ATTEMPTS}).
                </div>
              ) : showWakeNotice ? (
                <div className="Notice" role="status">
                  Waking up the server — this can take up to a minute after it has been idle. Thanks for waiting!
                </div>
              ) : null}

              {error ? <div className="Error">{error}</div> : null}
            </form>
          </div>

          {result ? (
            <div className="Card">
              <div className="CardHeader">
                <h2 className="CardTitle">Stops</h2>
                <div className="CardSubtitle">
                  {stops.length} stops · times in {zoneLabel}
                </div>
              </div>
              <div className="StopsList">
                {stopDays.map((day) => (
                  <section className="StopDay" key={day.key}>
                    <h3 className="StopDayTitle">{day.label}</h3>
                    <div className="StopDayRows">
                      {day.items.map((item) => (
                        <div className="StopRow" key={item.id}>
                          <div className="StopTime">{item.time}</div>
                          <div className="StopBody">
                            <div className="StopTitle">{item.title}</div>
                            {item.detail ? <div className="StopDetail">{item.detail}</div> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="Right">
          {result ? <TripMap stops={stops} route={result.route} /> : <div className="EmptyState">Submit the form to see map + logs.</div>}

          {Array.isArray(dailyLogs) && dailyLogs.length ? (
            <div className="Stack">
              {dailyLogs.map((d, i) => (
                <EldLogSheet
                  key={d.date}
                  date={d.date}
                  segments={d.segments}
                  remarks={d.remarks}
                  dayIndex={i}
                  dayCount={dailyLogs.length}
                />
              ))}
              <p className="LogSheetNote">
                Hours before the trip starts and after the final dropoff are shown as off duty, so every day adds up
                to 24:00.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default App;
