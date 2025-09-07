"use strict";

// Section 4 - Code with JavaScript

/** Stage ordering for comparisons */
const STAGE_ORDER = {
  "Origin Pickup": 1,
  "Origin Hub": 2,
  "Linehaul": 3,
  "Customs": 4,
  "Destination Hub": 5,
  "Last-Mile": 6,
  "Delivered": 7,
};

/** Global IATA→country map for lanes used here (extend as needed) */
const IATA_TO_COUNTRY = {
  TLV: "IL",
  LHR: "GB",
  AMS: "NL",
  FRA: "DE",
  JFK: "US",
  SFO: "US",
  ORD: "US",
  BOS: "US",
  MIA: "US",
  LAX: "US",
  SEA: "US",
  YVR: "CA",
  HKG: "HK",
  MAD: "ES",
  CDG: "FR",
  NRT: "JP",
  SYD: "AU",
  DUB: "IE",
  SZX: "CN",
};

/** Tunable thresholds */
const GAP_LAST_MILE_HOURS = 12;
const GAP_OTHERS_HOURS = 24;
const DWELL_P90_BUFFER_H = 1.0;
const DWELL_FALLBACK_H = 18.0;

/** ETA windows (days) */
const ETA_WINDOW_DOMESTIC_DAYS = 2;
const ETA_WINDOW_INTL_DAYS = 3;

// ----------------------------------------------- //

function countriesForShipment(shipment) {
  var originCountry = null;
  var destinationCountry = null;

  if (shipment && shipment.origin_country != null) {
    originCountry = shipment.origin_country;
  } else if (
    shipment &&
    shipment.origin_iata &&
    IATA_TO_COUNTRY[shipment.origin_iata]
  ) {
    originCountry = IATA_TO_COUNTRY[shipment.origin_iata];
  }

  if (shipment && shipment.destination_country != null) {
    destinationCountry = shipment.destination_country;
  } else if (
    shipment &&
    shipment.destination_iata &&
    IATA_TO_COUNTRY[shipment.destination_iata]
  ) {
    destinationCountry = IATA_TO_COUNTRY[shipment.destination_iata];
  }

  return {
    originCountry: originCountry,
    destinationCountry: destinationCountry,
  };
}

function isDomestic(shipment) {
  var countries = countriesForShipment(shipment);
  var originCountry = countries.originCountry;
  var destinationCountry = countries.destinationCountry;

  if (originCountry == null || destinationCountry == null) {
    return null;
  }

  if (originCountry === destinationCountry) {
    return true;
  } else {
    return false;
  }
}

function etaWindowDays(shipment) {
  // Determine lane type (domestic/international/unknown)
  var domesticFlag = isDomestic(shipment);

  // Domestic lanes get a tighter window (2 days)
  if (domesticFlag === true) {
    return ETA_WINDOW_DOMESTIC_DAYS;
  }

  // International lanes get a wider window (3 days)
  if (domesticFlag === false) {
    return ETA_WINDOW_INTL_DAYS;
  }

  // When unknown, choose the conservative (wider) window so we don't miss risks
  return ETA_WINDOW_INTL_DAYS;
}

function riskReasons(shipment) {
  var reasons = [];
  var stage = shipment ? shipment.stage : null;

  // 0) Terminal stage: already delivered → not at risk
  if (stage === "Delivered") return reasons;

  // 1) Input guard: days_to_eta must exist and be a number
  var daysToEta =
    shipment && typeof shipment.days_to_eta === "number"
      ? shipment.days_to_eta
      : null;
  if (daysToEta === null) return reasons;

  // 2) ETA window gate (domestic → 2d, international → 3d)
  var windowDays = etaWindowDays(shipment);
  if (!(daysToEta <= windowDays)) return reasons;

  // 3) Stage check: if earlier than Last-Mile while close to ETA → early_stage_near_eta
  var stageRank = STAGE_ORDER[stage] || 0;
  if (stageRank < STAGE_ORDER["Last-Mile"]) {
    reasons.push("early_stage_near_eta");
  }

  // 4) Scan gap: compare to stage-specific threshold
  var gapThreshold =
    stage === "Last-Mile" ? GAP_LAST_MILE_HOURS : GAP_OTHERS_HOURS;
  if (
    typeof shipment.scan_gap_hours === "number" &&
    shipment.scan_gap_hours > gapThreshold
  ) {
    reasons.push("scan_gap");
  }

  // 5) Dwell: above baseline P90 + buffer OR (no baseline and ≥ fallback)
  var dwellHours = shipment ? shipment.dwell_hours_current : null;
  var baselineP90 = shipment ? shipment.baseline_90pct_hours : null;
  if (typeof dwellHours === "number") {
    if (typeof baselineP90 === "number") {
      if (dwellHours > baselineP90 + DWELL_P90_BUFFER_H) {
        reasons.push("excess_dwell");
      }
    } else {
      if (dwellHours >= DWELL_FALLBACK_H) {
        reasons.push("excess_dwell");
      }
    }
  }

  // 6) External conditions: (weather ≥ 3 OR port ≥ 7) and ETA within 3 days
  var external = shipment && shipment.external ? shipment.external : {};
  var weatherIndex =
    typeof external.weather_index === "number" ? external.weather_index : null;
  var portCongestion =
    typeof external.port_congestion === "number"
      ? external.port_congestion
      : null;
  if (daysToEta <= 3) {
    if (
      (weatherIndex !== null && weatherIndex >= 3) ||
      (portCongestion !== null && portCongestion >= 7)
    ) {
      reasons.push("external_risk");
    }
  }

  // 7) Return all reasons collected (empty array → not at risk)
  return reasons;
}

function isShipmentAtRisk(shipment) {
  return riskReasons(shipment).length > 0;
}

// === Sample subset: 3 shipments ===
const SAMPLE_THREE = [
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
    "external": { "weather_index": 2, "port_congestion": 3 },
    "current_carrier_name": "DHL Express",
    "owner": "Ops-Linehaul-IL",
    "last_update_ts": "2025-09-07T10:12:00Z"
  },
  {
    "shipment_id": "LDG-1043",
    "lane": "JFK→SFO",
    "origin_iata": "JFK",
    "destination_iata": "SFO",
    "origin_country": "US",
    "destination_country": "US",
    "stage": "Origin Hub",
    "eta_planned": "2025-09-08T15:12:00Z",
    "days_to_eta": 1,
    "severity": "medium",
    "reason_code": ["early_stage_near_eta"],
    "scan_gap_hours": 6,
    "dwell_hours_current": 2.5,
    "baseline_90pct_hours": 8.0,
    "external": { "weather_index": 1, "port_congestion": 2 },
    "current_carrier_name": "UPS",
    "owner": "Ops-East",
    "last_update_ts": "2025-09-07T10:05:00Z"
  },
  {
    "shipment_id": "LDG-1066",
    "lane": "FRA→TLV",
    "origin_iata": "FRA",
    "destination_iata": "TLV",
    "origin_country": "DE",
    "destination_country": "IL",
    "stage": "Last-Mile",
    "eta_planned": "2025-09-10T10:12:00Z",
    "days_to_eta": 3,
    "severity": "medium",
    "reason_code": ["scan_gap"],
    "scan_gap_hours": 16,
    "dwell_hours_current": 4.0,
    "baseline_90pct_hours": 9.0,
    "external": { "weather_index": 2, "port_congestion": 1 },
    "current_carrier_name": "Israel Post",
    "owner": "LM-Central",
    "last_update_ts": "2025-09-07T09:58:00Z"
  }
];

// === Demo: run riskReasons/isShipmentAtRisk on the 3 items ===
function demoThree() {
  for (var i = 0; i < SAMPLE_THREE.length; i++) {
    var sh = SAMPLE_THREE[i];
    var reasons = riskReasons(sh);
    var atRisk = reasons.length > 0;
    Logger.log('%s  at_risk=%s  reasons=%s',
      sh.shipment_id, atRisk, JSON.stringify(reasons)
    );
  }
}