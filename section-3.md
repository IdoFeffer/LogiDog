# Section 3 — API Design (LogiDog)

This section defines the **client-facing API**.
It focuses on **input/output formats** and the **communication protocol** (REST + WebSocket), aligned with the view schema from Section 2.3 and the sample data in `sample-shipments.json`.

---

## 1) Protocols

- **REST (HTTP/JSON):** initial loads, filtering, pagination, and user actions (Confirm/Assign, ETA update).
- **WebSocket (WSS):** near real-time updates (initial **snapshot** → incremental **deltas**).
- **Fallback:** if WSS is blocked, the client uses **incremental HTTP polling** (e.g., every 15s with `since`/`as_of`).

All times are UTC. Authentication via `Authorization: Bearer <JWT (JSON Web Token)>`.

---

## 2) Denormalized View (row) — reference

A single row as consumed by the dashboard (see Section 2.3):

```json
{
  "shipment_id": "LDG-1029",
  "lane": "TLV→LHR",
  "stage": "Linehaul",
  "eta_planned": "2025-09-09T18:00:00Z",
  "days_to_eta": 2,
  "severity": "high",
  "reason_code": ["scan_gap", "excess_dwell"],
  "scan_gap_hours": 28,
  "dwell_hours_current": 11.0,
  "baseline_90pct_hours": 9.8,
  "external": { "weather_index": 2, "port_congestion": 3 },
  "current_carrier_name": "DHL Express",
  "owner": "Ops-Linehaul-IL",
  "last_update_ts": "2025-09-07T10:12:00Z"
}
```

---

## 3) REST Endpoints (HTTP/JSON)

### `GET /v1/alerts`

**Purpose:** List dashboard rows with filters & pagination.

**Query params (optional):**

- `search` (string), `reason` (string), `carrier` (string), `stage` (string),
- `eta_window` (string; e.g., `2d` or `3-5d`),
- `severity` (`none|low|medium|high`),
- `sort` (e.g., `-severity,days_to_eta`),
- `page` (int, default 1), `page_size` (int, default 50, max 200)

**Response (200):**

```json
{
  "as_of": "2025-09-07T10:12:00Z",
  "page": 1,
  "page_size": 50,
  "total": 324,
  "rows": [
    /* rows in the denormalized shape */
  ]
}
```

---

### `GET /v1/shipments/{shipment_id}`

**Purpose:** Get details for the right-side drawer.

**Response (200):**

```json
{
  "shipment": {
    /* same shape as the denormalized row */
  },
  "scan_history": [
    { "ts": "2025-09-06T06:05:00Z", "event": "Departed Origin Facility" },
    { "ts": "2025-09-05T22:31:00Z", "event": "Arrived at Origin Facility" }
  ],
  "node_timeline": [
    { "node": "Origin Pickup", "status": "Completed" },
    { "node": "Origin Hub", "status": "In progress" },
    { "node": "Linehaul", "status": "In progress" },
    { "node": "Destination Hub", "status": "Pending" },
    { "node": "Last-Mile", "status": "Pending" }
  ]
}
```

---

### `PATCH /v1/alerts/{shipment_id}`

**Purpose:** User actions on an alert.

**Body (examples):**

```json
{ "action": "confirm" }
```

```json
{ "action": "assign", "owner": "LM-West" }
```

**Response (200):** updated row.

---

### `POST /v1/eta-update/{shipment_id}`

**Purpose:** Update the planned ETA.

**Body:**

```json
{ "eta_planned": "2025-09-10T18:00:00Z" }
```

**Response (200):** updated row.

---

### Error format (consistent)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "stage is invalid",
    "details": { "field": "stage", "reason": "unsupported value" }
  }
}
```

---

### REST Client Flow (visual)

```text
Dashboard (user opens Alerts screen)
|
v
Initial load needed?
├─ no  → (use cached rows)
└─ yes
   ├─ have filters/search/sort?
   │  ├─ no  → GET /v1/alerts
   │  └─ yes → GET /v1/alerts?... (with filters)
   │
   v
   Receive list → user selects row?
   ├─ no  → stay on list
   └─ yes → GET /v1/shipments/{id}
            → show drawer
            → user action?
                ├─ Confirm → PATCH /v1/alerts/{id}
                ├─ Assign → PATCH /v1/alerts/{id}
                ├─ ETA update → POST /v1/eta-update/{id}
                └─ No action → close drawer
```

---

## 4) WebSocket (WSS) Channel

**URL:** `wss://api.logidog/alerts`

**Client flow (brief):**

1. Open WSS with a token → receive **snapshot** (current rows).
2. Receive **delta** messages for inserts/updates/deletes.
3. Heartbeat every ~30s; auto-reconnect with exponential backoff.
4. If WSS is unavailable → **HTTP polling** (e.g., `GET /v1/alerts?since=<ISO>`).

**Messages (examples):**

```json
{ "type": "snapshot", "as_of": "2025-09-07T10:12:00Z", "rows": [ /* rows */ ] }
{ "type": "delta", "op": "upsert", "row": { "shipment_id": "LDG-1029", "severity": "high", "last_update_ts": "2025-09-07T10:13:00Z" } }
{ "type": "delta", "op": "delete", "shipment_id": "LDG-1043" }
{ "type": "heartbeat", "ts": "2025-09-07T10:13:30Z" }
{ "type": "command", "cmd": "confirm", "shipment_id": "LDG-1029", "idempotency_key": "uuid-123" }
{ "type": "command", "cmd": "assign", "shipment_id": "LDG-1029", "owner": "LM-West", "idempotency_key": "uuid-124" }
```

---

## 5) Security & Ops (concise)

- **Auth:** `Authorization: Bearer <JWT>` (scopes for read/write).
- **Versioning:** `/v1/...` routes; future break changes via `/v2`.
- **Rate limits:** return `X-RateLimit-*` headers on REST.
- **Idempotency:** `Idempotency-Key` header on POST/PATCH to avoid duplicates.
- **Validation:** JSON schema validation server-side for request/response.
- **Observability:** structured logs; metrics (latency, QPS(Queries per second), errors, reconnect rate).

---