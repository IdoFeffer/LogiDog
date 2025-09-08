# Section 2 — Alerts Dashboard (LogiDog)

## 2.1 Screen (visuals)

A single-screen dashboard showing at-risk shipments with search/filters and clear visual indicators.
(Embedded screenshot below: main list view with right-side details drawer.)

[Alerts Dashboard — with details drawer](img/Alerts-Dashboard-Drawer.png)

- **Main list view:** severity, shipment/lane, stage, ETA, days→ETA, reasons, scan gap, dwell, owner.
- **Details drawer (on row click):** scan history, node timeline, and suggested next actions.

---

## 2.2 Real-time Data Updates — WebSockets

We will use a WebSocket (WSS) channel for near real-time updates (<1–2s).

**Why it fits this system:**

- **Bi-directional:** the UI can both receive alert changes and send user actions (Confirm/Assign) over the same connection.
- **Efficient:** one persistent connection per client; the server pushes only change events (changed rows), avoiding periodic polling.
- **Responsive UX:** instant “Updated just now” feedback without waiting for the next poll.

**Client flow (brief):**
open `wss://api.logidog/alerts` with auth → initial snapshot → change events messages for inserts/updates/deletes.  
if WSS is unavailable, fall back to incremental HTTP polling. (Every 10–15s, faster for high-severity, slower for low).

---

## 2.3 Data Structure for Display (denormalized) — example

The dashboard consumes a denormalized row per shipment (all timestamps are UTC/ISO-8601).
severity is derived from Section 1 thresholds and can be tuned per lane/facility.

```json
{
  "shipment_id": "LDG-1029",
  "lane": "TLV→LHR",
  "origin_iata": "TLV",
  "destination_iata": "LHR",
  "origin_country": "IL",
  "destination_country": "GB",
  "stage": "Linehaul",
  "eta_planned": "2025-09-09T18:12:00Z",
  "days_to_eta": 2,
  "severity": "high",
  "reason_code": ["scan_gap", "excess_dwell"],
  "scan_gap_hours": 28,
  "dwell_hours_current": 11.0,
  "baseline_90pct_hours": 9.8,
  "external": {
    "weather_index": 2,
    "port_congestion": 3
  },
  "current_carrier_name": "DHL Express",
  "owner": "Ops-Linehaul-IL",
  "last_update_ts": "2025-09-07T10:12:00Z"
}
```