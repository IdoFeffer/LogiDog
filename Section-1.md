# Section 1 — Problem Understanding & Early Delay Identification (LogiDog)

---

## 1.1 Analysis of Delay Factors

### Operational (internal) factors
- **Pickup issues** — missed/late first‑mile pickup; shipper not ready; incorrect pickup slot.
- **Sortation / hub bottlenecks** — backlog at origin or transit hubs, limited sorting capacity, shift gaps.
- **Linehaul capacity & routing** — insufficient linehaul capacity, sub‑optimal routing, misrouted shipments, tender rejections.
- **Handover frictions** — delays at carrier hand‑offs (air/sea/ground), EDI/API integration lags.
- **Scan gaps** — long intervals with no new tracking events (lost scans, device outages).
- **Documentation** — missing/inaccurate docs (commercial invoice, packing list, HS codes), dangerous‑goods declarations.
- **Customs prep** — docs not submitted prior to arrival; late broker assignment.
- **Address & contact quality** — invalid address, missing contact/door code causing last‑mile failures.
- **SLA/service mismatch** — booked service not aligned to promised delivery date.
- **IT outages/exceptions** — TMS/WMS downtime, message queue backlogs, label reprints.
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

> Goal: flag shipments that are **close to their ETA** but **not far enough along**, or show **abnormal dwell/scan gaps**.

**Key parameters (tunable):**
- `X_days_to_ETA`: **2 days (domestic)** / **3–5 days (international)**.
- `stage_threshold`: must be at least **Last‑Mile** before ETA window; otherwise risk.
- `max_scan_gap_hours`: **12h in Last‑Mile**, **24h otherwise**
- `max_node_dwell_percentile`: dwell time at the current node is above the time by which **90% of shipments** have already cleared this node (for the same lane/facility) **(+ small buffer; fallback: ≥18h if baseline unavailable)** → risk.

**Logic (textual, combined):**
1. Run a periodic job (e.g., hourly) over active shipments.
2. Compute `days_to_eta = ETA_planned - now`.
3. If `days_to_eta > X_days_to_ETA` → **No alert**.
4. Else (within ETA window):
   - **Stage check**: If `current_stage < Last‑Mile` → **At‑Risk (`EARLY_STAGE_NEAR_ETA`)**.
   - **Scan‑gap check**: Let `threshold = 12h` if `current_stage == Last‑Mile` else `24h`. If `scan_gap_hours > threshold` → **At‑Risk (`SCAN_GAP`)**.
   - **Dwell check**: If `current_node_dwell > baseline_90pct + buffer` (fallback: `≥18h` if baseline unavailable) → **At‑Risk (`EXCESS_DWELL`)**.
   - **External risk**: If `(weather ≥ 3 OR port ≥ 7)` **AND** `days_to_eta ≤ 3d` → **At‑Risk (`EXTERNAL_RISK`)**.
   - Else **No alert**.
5. When flagged:
   - Create an alert with **reason code** (e.g., `EARLY_STAGE_NEAR_ETA`, `SCAN_GAP`, `EXCESS_DWELL`, `EXTERNAL_RISK`).
   - Assign to an **owner** (ops team) and suggest **next actions** (expedite linehaul, broker push, customer contact, address verify).

---

## 1.3 Flowchart

Shipment (eta, stage, lastScanTs, dwellHours, extSignals)
|
v
Days to ETA within window?  (2d domestic / 3–5d intl)
├─ no  → no alert
└─ yes
   ├─ stage is Last-Mile or later?
   │  ├─ no  → alert: early_stage_near_eta
   │  └─ yes
   │     ├─ scan gap > threshold?  (12h in Last-Mile, else 24h)
   │     │  ├─ yes → alert: scan_gap
   │     │  └─ no
   │     │     ├─ dwell > baseline_90pct + buffer?
   │     │     │    (fallback: ≥18h if baseline unavailable)
   │     │     ├─ yes → alert: excess_dwell
   │     │     └─ no
   │     │        ├─ external risk?  (weather≥3 or port≥7) and ETA≤3d
   │     │        │  ├─ yes → alert: external_risk
   │     │        │  └─ no  → no alert
   │     │
   │     └
   └

---

## 1.4 Guiding Questions (for discussion)

### A) What data signals best predict delays, and why?
Capture for each: **definition**, **source/system**, **granularity** (lane/facility/stage), **rationale**, **pitfalls**.

- Tracking events & **scan gaps**
- Node **dwell times** & queue metrics
- Lane/facility **baselines** (p50/p90), seasonality
- **Weather severity** index (e.g., storm levels)
- **Port/airport congestion** index (arrivals, turnaround, cancellations)
- Carrier/partner **performance drift** (ETA slippage, missed linehauls)
- **Service level vs promised date** (SLA mismatch)
- **Address quality** & contactability (geocode confidence, door codes)
- **Customs/brokerage readiness** (docs completeness, HS-code quality)
- **Calendar/peaks** (holidays, demand spikes)

### B) Future implementation & evaluation
- **Rules → score → ML** path: start simple (rules), add risk scoring, graduate to ML when data matures.
- **Cold-start baselines**: network-level P90 fallback; auto-tune to lane/facility as data accumulates.
- **Threshold management**: per-stage thresholds (e.g., 12h LM / 24h others), per-lane overrides.
- **Feedback loop**: measure precision/recall of alerts, ETA-save rate, time-to-resolution; iterate monthly.
- **Data schema & quality**: event completeness, clock sync, dedupe keys, partner EDI health.
- **Ownership & playbooks**: reason codes → default owners → standard next actions.
- **Guardrails**: rate-limit repeat alerts, auto-close on delivery, privacy/compliance logging.

### C) Critical data fields for ML training (initial list)
_Grouped by purpose; to be refined per lane/facility._

**Context & IDs:** `shipment_id`, `lane_id`, `facility_id`, `partner_id`, `service_level`  
**Timestamps:** `pickup_at`, `arrive_at_node`, `depart_node`, `last_scan_ts`, `delivered_at`  
**ETA & promises:** `eta_planned`, `eta_updated`, `promised_date`  
**Derived timing:** `scan_gap_hours`, `dwell_time_current`, `dwell_percentile_rank`, `time_in_stage`  
**Location/route:** `origin_geo`, `destination_geo`, `geohash/region`, `route_id`  
**External signals:** `weather_index`, `port_congestion_index`, `holiday_flag`  
**Customs/docs:** `docs_complete_flag`, `hs_code_valid`, `declared_value`, `broker_assigned`, `customs_status/hold_code`  
**Address/contact:** `address_quality_score`, `door_code_present`, `contact_reachable`  
**Physical/capacity:** `weight`, `volume/dims`, `pieces`, `special_handling/dg_flag`  
**Partner performance:** `on_time_percent_lane_partner`, `missed_linehaul_count_recent`  
**Exceptions:** `exception_codes`, `hold_codes`

_Rationale:_ Enables robust feature engineering (scan gaps, dwell baselines, seasonal effects), partner/lane conditioning, and alignment with promised service. Supports both rule-based thresholds and statistical/ML models later on.

---

### D) Alert triggering approach — rules vs. dynamic (basic stats/ML)

**Rule-based (now)**  
- **Pros:** transparent, fast to deploy, minimal data needs, easy for Ops to validate.  
- **Cons:** rigid thresholds, manual tuning, may miss nuanced patterns.

**Dynamic (basic stats/ML, later)**  
- **Pros:** adapts to lanes/facilities/seasonality, captures interactions, improves recall/precision.  
- **Cons:** requires clean history + MLOps, less “explainable” to non-technical users.

**Our choice for this initial system**  
Start **rules-first**, with adaptive baselines (e.g., `baseline_90pct + buffer`), measure KPIs (precision/recall, ETA-save rate, time-to-resolution), then graduate to a lightweight model once data quality/coverage is stable — without discarding the rule framework.