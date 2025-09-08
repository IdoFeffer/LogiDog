# Section 1 — Problem Understanding & Early Delay Identification (LogiDog)

---

## 1.1 Analysis of Delay Factors

### Operational (internal) factors

- **Pickup issues** — missed/late first‑mile pickup; shipper not ready; incorrect pickup slot.
- **Sortation / hub bottlenecks** — backlog at origin or transit hubs, limited sorting capacity, shift gaps.
- **Linehaul capacity & routing** — insufficient linehaul capacity, misrouted shipments, tender rejections.
- **Handover frictions** — delays at carrier hand‑offs (air/sea/ground).
- **Scan gaps** — long intervals with no new tracking events (lost scans, device outages).
- **Documentation** — missing/inaccurate docs (commercial invoice, packing list).
- **Customs prep** — docs not submitted prior to arrival; late broker assignment.
- **Address & contact quality** — invalid address, missing contact.
- **Service mismatch** — booked service not aligned to promised delivery date.
- **Temperature/handling constraints** — special handling windows for medical equipment increasing dwell.

### External factors

- **Weather & natural events** — storms, floods, snow, wildfires.
- **Traffic & infrastructure** — road closures, accidents, bridge/rail issues.
- **Port/airport congestion** — berthing/ground‑handling delays, flight cancellations.
- **Customs & regulatory** — holds, inspections, changing sanctions/document rules.
- **Labor disruptions** — strikes at ports, carriers, or customs.
- **Holidays & peak seasons** — reduced operating hours, demand spikes.
- **Geopolitical/security** — conflict zones, security incidents on key lanes.

---

## 1.2 Early Delay Identification — simple rule‑based logic

> Goal: flag shipments that are close to their ETA but not far enough along, or show abnormal dwell/scan gaps.

**Key parameters (tunable):**

- `X_days_to_ETA`: **2 days (domestic)** / **3–5 days (international)**.
- `stage_threshold`: must be at least Last‑Mile before ETA window; otherwise risk.
- `max_scan_gap_hours`: 12h in Last‑Mile, 24h otherwise
- `max_node_dwell_percentile`: dwell time at the current node is above the time by which 90% of shipments have already cleared this node (for the same lane/facility) (+ small buffer; fallback: ≥18h if baseline unavailable) → risk.

**Logic:**

1. Run a periodic job (e.g., hourly) over active shipments.
2. Compute `days_to_eta = eta_planned - now`.
3. If `days_to_eta > X_days_to_ETA` → No alert.
4. Else (within ETA window):
   - **Stage check**: If `stage < Last‑Mile` → At‑Risk (`EARLY_STAGE_NEAR_ETA`).
   - **Scan‑gap check**: Let `threshold = 12h` if `stage == Last‑Mile` else `24h`. If `scan_gap_hours > threshold` → At‑Risk (`SCAN_GAP`).
   - **Dwell check**: If `dwell_hours_current > baseline_90pct_hours + buffer` (fallback: `≥18h` if baseline unavailable) → At‑Risk (`EXCESS_DWELL`).
   - **External risk**: If `(external.weather_index ≥ 3 OR external.port_congestion ≥ 7)` AND `days_to_eta ≤ 3d` → At‑Risk (`EXTERNAL_RISK`).
   - Else - No alert.
5. When flagged:
   - Create an alert with reason code (e.g.,`EARLY_STAGE_NEAR_ETA`, `SCAN_GAP`, `EXCESS_DWELL`, `EXTERNAL_RISK`).
   - Assign to an owner (ops team) and suggest next actions (expedite linehaul, broker push, customer contact, address verify).

---

## 1.3 Flowchart

Shipment (eta_planned, stage, last_scan_ts, dwell_hours_current, external)
|
v
Days to ETA within window? (2d domestic / 3–5d intl)
├─ no → no alert
└─ yes
├─ stage is Last-Mile or later?
│ ├─ no → alert: early_stage_near_eta
│ └─ yes
│ ├─ scan gap > threshold? (12h in Last-Mile, else 24h)
│ │ ├─ yes → alert: scan_gap
│ │ └─ no
│ │ ├─ dwell > baseline_90pct + buffer?
│ │ │ (fallback: ≥18h if baseline unavailable)
│ │ ├─ yes → alert: excess_dwell
│ │ └─ no
│ │ ├─ external risk? (external.weather_index≥3 or external.port_congestion≥7) and ETA≤3d
│ │ │ ├─ yes → alert: external_risk
│ │ │ └─ no → no alert

---

## 1.4 Guiding Questions (for discussion)

### A) What types of data (existing or to be collected) could serve as strong indicators for accurate delay prediction?

- Tracking events & scan gaps.
- Node dwell times & queue metrics.
- Lane/facility baselines (50%/90%), seasonality.
- Weather severity index (e.g., storm levels).
- Port/airport congestion index (arrivals, turnaround, cancellations).
- Carrier performance drift (ETA slippage, missed linehauls).
- Service level vs promised date.
- Address quality & contactability (geocode confidence, wrong address).
- Customs/brokerage readiness (docs completeness).
- Calendar/peaks (holidays, demand spikes).

### B) Considering a future implementation of a Machine Learning (ML) model

- **Rules → score → ML** path: start simple (rules), add risk scoring (0-100), graduate to ML when data matures.
- **Cold-start baselines**: use a network-level 90% baseline as fallback; auto-tune to lane/facility as data accumulates.
- **Threshold management**: per-stage thresholds (e.g., 12h Last-Mile / 24h others), per-lane overrides.
- **Feedback loop**: measure precision/recall of alerts, ETA-save rate, time-to-resolution; iterate monthly.
- **Data schema & quality**: event completeness, clock sync, dedupe keys, carrier EDI/API health.
- **Ownership & playbooks**: reason codes → default owners → standard next actions.
- **Guardrails**: rate-limit repeat alerts, auto-close on delivery, privacy/compliance logging.

### C) Critical data fields for ML training (initial list)

**Context & IDs:** `shipment_id`, `lane_id`, `facility_id`, `carrier_id`, `service_level`  
**Timestamps:** `pickup_at`, `arrive_at_node`, `depart_node`, `last_scan_ts`, `delivered_at`  
**ETA & promises:** `eta_planned`, `eta_updated`, `promised_date`  
**Derived timing:** `scan_gap_hours`, `dwell_time_current`, `dwell_percentile_rank`, `time_in_stage`  
**Location/route:** `origin_geo`, `destination_geo`, `geohash/region`, `route_id`  
**External signals:** `weather_index`, `port_congestion_index`, `holiday_flag`  
**Customs/docs:** `docs_complete_flag`, `hs_code_valid`, `declared_value`, `broker_assigned`, `customs_status/hold_code`  
**Address/contact:** `address_quality_score`, `door_code_present`, `contact_reachable`  
**Physical/capacity:** `weight`, `volume/dims`, `pieces`, `special_handling/dg_flag`  
**Partner performance:** `on_time_percent_lane_carrier`, `missed_linehaul_count_recent`  
**Exceptions:** `exception_codes`, `hold_codes`

**Why these**: they capture operational state + timing signals, external disruptions, and per-lane baselines—enabling robust features without leakage at prediction time.

---

### D) Alert triggering approach — rules vs. dynamic (basic stats / ML)

**Rule-based (now)**

- **Advantages:** transparent, fast to deploy, minimal data needs, easy for Ops to validate.
- **Disadvantages:** rigid thresholds, manual tuning, may miss nuanced patterns.

**Dynamic (basic stats / ML)**

- **Advantages:** adapts to lanes/facilities/seasonality, captures interactions, improves recall/precision.
- **Disadvantages:** requires clean history + MLOps (Machine-Learning Operations), less “explainable” to non-technical users.

**Chosen approach:**
Start rule-first with adaptive 90% baselines, track precision/recall + ETA-save + TTR, and evolve to a lightweight ML model once data is reliable—keeping rules as guardrails.
