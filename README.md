**LogiDog — Early Delay Detection (Assignment)**
**Prepared by:** Ido Feffer

This submission includes a simple dashboard spec and a small JS function that flags shipments at risk of delay, plus sample data and a demo run.

---

**What’s in this repo?**

├─ **Section-1.md**  # Problem understanding & rules
├─ **Section-2.md**  # Dashboard UX (with screenshot)
├─ **Section-3.md**  # API design (REST + WSS)
├─ **Alerts-Dashboard-Drawer.png**  # Screenshot used in Section 2
├─ **Sample-Shipments.json**  # Flat rows used by the list view
└─ **app.js**  # Delay logic + small demo

---

**Data note:**
Sample-Shipments.json provides the flat list-view rows used by the dashboard. Per the API examples, shipment details (e.g., scan_history, node_timeline) are returned by GET /v1/shipments/{id} and are not required in the flat sample table.

---

**Prerequisites:**
Node.js and verify your version - node -v

---

**app.js contains:**

- The delay logic (riskReasons(shipment) and isShipmentAtRisk(shipment)).
- A tiny sample array (SAMPLE_THREE) with 3 shipments.
- A demoThree() function that prints results.

---

**Run the demo**

**Expected output::**

LDG-1029 at_risk=true reasons=["early_stage_near_eta","scan_gap","excess_dwell"]
LDG-1043 at_risk=true reasons=["early_stage_near_eta"]
LDG-1066 at_risk=false reasons=[]

---

**How the logic works?**

- Window by lane type: domestic → 2 days; international → 3 days.
- (Derived using origin*\*/destination*\* with a small IATA→country map.)

- Rules applied when inside the window:
- Stage earlier than Last-Mile → early_stage_near_eta
- Scan gap > threshold (12h in Last-Mile, else 24h) → scan_gap
- Dwell > baseline 90% + buffer (or ≥18h if no baseline) → excess_dwell
- External (weather ≥3 or port ≥7) and ETA ≤3d → external_risk
- isShipmentAtRisk(shipment) returns true if any reason is triggered.