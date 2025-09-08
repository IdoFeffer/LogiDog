# Section 3 — API Design (LogiDog)

This section defines the client-facing API.
It focuses on input/output formats and the communication protocol (REST + WebSocket), aligned with the view schema from Section 2.3 and the sample data in `sample-shipments.json`.

---

## 1) Protocols

- **REST (HTTP/JSON):** initial loads, filtering, pagination, and user actions (Confirm/Assign, ETA update).
- **WebSocket (WSS):** near real-time updates (initial snapshot → incremental changes).
- **Fallback:** if WSS is blocked, the client uses incremental HTTP polling (e.g., every ~30s with `since`/`as_of`).

All times are UTC. Authentication via `Authorization: Bearer <JWT (JSON Web Token)>`.

---

## 2) Denormalized View (row) — reference

A single row as consumed by the dashboard (see Section 2.3):

```json
{
  "shipment": {
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
    "external": { "weather_index": 2, "port_congestion": 3 },
    "current_carrier_name": "DHL Express",
    "owner": "Ops-Linehaul-IL",
    "last_update_timestamp": "2025-09-07T10:12:00Z"
  },
  "scan_history": [
    {
      "timestamp": "2025-09-06T06:05:00Z",
      "event": "Departed Origin Facility"
    },
    {
      "timestamp": "2025-09-05T22:31:00Z",
      "event": "Arrived at Origin Facility"
    }
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

## 3) REST Endpoints (HTTP/JSON)

### `GET /v1/alerts`

**Purpose:** List dashboard rows with filters & pagination.

**Query params (optional):**

- `search` (string), `reason` (string), `carrier` (string), `stage` (string),
- `eta_window` (string; e.g., `2d` or `3-5d`),
- `severity` (`none, low, medium, high`),
- `sort` (e.g., `-severity, days_to_eta`),
- `page` (int, default 1), `page_size` (int, default 50, max 200)

```json
{
  "as_of": "2025-09-07T10:12:00Z",
  "page": 1,
  "page_size": 50,
  "total": 324,
  "rows": []
}
```

---

### `GET /v1/shipments/{shipment_id}`

**Purpose:** Get details for the right-side drawer.

```json
{
  "shipment": {
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
    "external": { "weather_index": 2, "port_congestion": 3 },
    "current_carrier_name": "DHL Express",
    "owner": "Ops-Linehaul-IL",
    "last_update_timestamp": "2025-09-07T10:12:00Z"
  },
  "scan_history": [
    {
      "timestamp": "2025-09-06T06:05:00Z",
      "event": "Departed Origin Facility"
    },
    {
      "timestamp": "2025-09-05T22:31:00Z",
      "event": "Arrived at Origin Facility"
    }
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

**Request JSON (examples):**

```json
{ "action": "confirm" }
```

```json
{ "action": "assign", "owner": "LM-West" }
```

---

### `POST /v1/eta-update/{shipment_id}`

**Purpose:** Update the planned ETA.

**Request JSON:**

```json
{ "eta_planned": "2025-09-10T18:00:00Z" }
```

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

1. Open WSS with a token → receive snapshot (current rows).
2. Receive change event messages for inserts/updates/deletes.
3. Heartbeat every ~30s; auto-reconnect with exponential backoff.
4. If WSS is unavailable → HTTP polling every ~30s (e.g., `GET /v1/alerts?since=<ISO>`).

**Messages (examples):**

```json
[
  [
    { "type": "snapshot", "as_of": "2025-09-07T10:12:00Z", "rows": [] },

    {
      "type": "change",
      "operation": "add",
      "timestamp": "2025-09-07T10:12:05Z",
      "row": {
        "shipment_id": "LDG-1300",
        "lane": "TLV→LHR",
        "stage": "Linehaul",
        "severity": "medium",
        "last_update_timestamp": "2025-09-07T10:12:05Z"
      }
    },

    {
      "type": "change",
      "operation": "update",
      "timestamp": "2025-09-07T10:13:00Z",
      "row": {
        "shipment_id": "LDG-1029",
        "severity": "high",
        "scan_gap_hours": 29,
        "last_update_timestamp": "2025-09-07T10:13:00Z"
      }
    },

    {
      "type": "change",
      "operation": "delete",
      "timestamp": "2025-09-07T10:14:00Z",
      "shipment_id": "LDG-1043"
    },

    { "type": "heartbeat", "timestamp": "2025-09-07T10:13:30Z" },

    {
      "type": "command",
      "action": "confirm",
      "shipment_id": "LDG-1029",
      "command_id": "uuid-123"
    },

    {
      "type": "command",
      "action": "assign",
      "shipment_id": "LDG-1029",
      "owner": "LM-West",
      "command_id": "uuid-124"
    }
  ]
]
```

---

## 5) Security & Ops

- **Auth:** `Authorization: Bearer <JWT>` (scopes for read/write).
- **Versioning:** `/v1/...` routes, future breaking changes via `/v2`.
- **Rate limits:** return `X-RateLimit-*` headers on REST.
- **Deduplication:** Use a Command-Id header on all POST/PATCH requests (a unique identifier per action) to prevent duplicate processing.
- **Validation:** JSON schema validation server-side for request/response.
- **Observability:** structured logs; metrics (latency, QPS(Queries per second), errors, reconnect rate).