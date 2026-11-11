import type { SubseaCable } from '../types/network';

/**
 * Submarine Electrical Power Feeding Equipment (PFE) Engine
 * Models constant-current DC power feeding along copper composite conductors,
 * series-fed EDFA repeaters, ocean ground return electrodes, and fault-mode
 * terminal reconfiguration per ITU-T G.977 and SubOptic PFE engineering standards.
 */

export type PfeMode =
  | 'terrestrial-local'   // Terrestrial inline amplifiers powered by local AC/DC utility grid
  | 'repeaterless-none'   // Unrepeatered short subsea cable (no wet plant power required)
  | 'double-end-bipolar'  // Nominal balanced +/- kV constant-current shore feeding
  | 'single-end-reconfig' // Reconfigured single-end or split-ground feeding during shunt/PFE fault
  | 'tripped-localization'; // High-voltage HVDC tripped on open cut; low-voltage DC bridge active

export type SubsystemFaultMode =
  | 'none'
  | 'complete-cut'        // Both copper conductor and optical fibers severed
  | 'shunt-fault'         // Polyethylene insulation breach to seawater; copper & fibers intact
  | 'optical-only-cut'    // Optical fiber fracture inside intact copper tube
  | 'single-pfe-outage'   // One shore station PFE rectifier bank offline
  | 'repeater-failure'    // Single EDFA repeater pump laser / zener bypass fault
  | 'bu-spur-fault';      // Branching Unit sea-earth switch / spur isolation fault

export interface PfeSystemSpec {
  lineCurrentAmps: number;          // Constant DC line current I_line (A)
  conductorResistanceOhmKm: number; // Copper tube DC resistance R_c (Ohm/km at 4°C seabed)
  repeaterDropVolts: number;        // Series voltage drop per EDFA repeater V_rep (V)
  maxTerminalVoltageKv: number;     // Maximum shore PFE terminal rating V_max (kV)
  earthElectrodeResistanceOhm: number; // Ocean ground bed resistance (Ohm)
}

export interface PfeTelemetry {
  mode: PfeMode;
  lineCurrentAmps: number;
  conductorResistanceOhmKm: number;
  totalCableResistanceOhm: number;
  repeaterDropVolts: number;
  totalSystemVoltageKv: number;     // Total loop voltage V_total (kV)
  terminalAVoltageKv: number;       // Positive terminal voltage at Endpoint A (+kV)
  terminalBVoltageKv: number;       // Negative terminal voltage at Endpoint B (-kV)
  maxTerminalRatingKv: number;      // Max rating (e.g. 15.0 kV)
  powerMarginKv: number;            // Available terminal voltage headroom before overload (kV)
  zeroVoltPositionKm: number;       // Distance from Endpoint A where cable potential = 0 V (seawater ground)
  totalWetPlantPowerKw: number;     // Total DC power dissipated in cable + repeaters (kW)
  poweredRepeaterCount: number;     // Number of repeaters receiving nominal constant current
  unpoweredRepeaterCount: number;   // Number of repeaters starved of current
  voltageProfileKv: Array<{ km: number; voltageKv: number }>; // Sampled voltage profile V(x)
}

export function derivePfeSpec(cable: SubseaCable): PfeSystemSpec {
  if (cable.isTerrestrial) {
    return {
      lineCurrentAmps: 0,
      conductorResistanceOhmKm: 0,
      repeaterDropVolts: 0,
      maxTerminalVoltageKv: 0,
      earthElectrodeResistanceOhm: 0,
    };
  }

  // Modern SDM systems (12-24 fiber pairs) use pump-sharing with ~1.10 A line current and low-resistance copper (0.68 Ohm/km)
  if (cable.rfsYear >= 2020) {
    return {
      lineCurrentAmps: 1.08,
      conductorResistanceOhmKm: 0.68,
      repeaterDropVolts: 38.0,
      maxTerminalVoltageKv: 15.0,
      earthElectrodeResistanceOhm: 2.2,
    };
  }

  // 2012-2019 Coherent systems
  if (cable.rfsYear >= 2012) {
    return {
      lineCurrentAmps: 0.96,
      conductorResistanceOhmKm: 0.76,
      repeaterDropVolts: 42.0,
      maxTerminalVoltageKv: 14.0,
      earthElectrodeResistanceOhm: 2.5,
    };
  }

  // Pre-2012 Legacy systems
  return {
    lineCurrentAmps: 0.88,
    conductorResistanceOhmKm: 0.92,
    repeaterDropVolts: 45.0,
    maxTerminalVoltageKv: 12.5,
    earthElectrodeResistanceOhm: 3.0,
  };
}

/**
 * Computes the complete electrical state of the submarine power feeding system
 * from Ohm's law, series repeater drops, and fault topology.
 */
export function computePfeState(
  cable: SubseaCable,
  repeaterCount: number,
  faultMode: SubsystemFaultMode = 'none',
  faultProgressT = 0.5
): PfeTelemetry {
  const spec = derivePfeSpec(cable);

  if (cable.isTerrestrial) {
    return {
      mode: 'terrestrial-local',
      lineCurrentAmps: 0,
      conductorResistanceOhmKm: 0,
      totalCableResistanceOhm: 0,
      repeaterDropVolts: 0,
      totalSystemVoltageKv: 0,
      terminalAVoltageKv: 0,
      terminalBVoltageKv: 0,
      maxTerminalRatingKv: 0,
      powerMarginKv: 0,
      zeroVoltPositionKm: 0,
      totalWetPlantPowerKw: Number((repeaterCount * 0.12).toFixed(2)),
      poweredRepeaterCount: faultMode === 'complete-cut' ? 0 : repeaterCount,
      unpoweredRepeaterCount: faultMode === 'complete-cut' ? repeaterCount : 0,
      voltageProfileKv: [
        { km: 0, voltageKv: 0 },
        { km: cable.lengthKm, voltageKv: 0 },
      ],
    };
  }

  if (repeaterCount === 0) {
    return {
      mode: 'repeaterless-none',
      lineCurrentAmps: 0,
      conductorResistanceOhmKm: spec.conductorResistanceOhmKm,
      totalCableResistanceOhm: Math.round(spec.conductorResistanceOhmKm * cable.lengthKm),
      repeaterDropVolts: 0,
      totalSystemVoltageKv: 0,
      terminalAVoltageKv: 0,
      terminalBVoltageKv: 0,
      maxTerminalRatingKv: spec.maxTerminalVoltageKv,
      powerMarginKv: spec.maxTerminalVoltageKv,
      zeroVoltPositionKm: cable.lengthKm * 0.5,
      totalWetPlantPowerKw: 0,
      poweredRepeaterCount: 0,
      unpoweredRepeaterCount: 0,
      voltageProfileKv: [
        { km: 0, voltageKv: 0 },
        { km: cable.lengthKm, voltageKv: 0 },
      ],
    };
  }

  const clampedT = Math.max(0.02, Math.min(0.98, faultProgressT));
  const totalCableResistanceOhm = Number(
    (
      spec.conductorResistanceOhmKm * cable.lengthKm +
      2 * spec.earthElectrodeResistanceOhm
    ).toFixed(1)
  );

  // Governing equation: V_total = I_line * R_total + N_rep * V_rep
  const cableOhmicDropVolts = spec.lineCurrentAmps * totalCableResistanceOhm;
  const repeaterStringDropVolts = repeaterCount * spec.repeaterDropVolts;
  const totalVolts = cableOhmicDropVolts + repeaterStringDropVolts;
  const totalSystemVoltageKv = Number((totalVolts / 1000).toFixed(2));
  const totalWetPlantPowerKw = Number(
    ((totalVolts * spec.lineCurrentAmps) / 1000).toFixed(2)
  );

  // Case 1: Complete mechanical cable cut (copper conductor severed)
  if (faultMode === 'complete-cut') {
    const cutKm = Number((cable.lengthKm * clampedT).toFixed(1));
    return {
      mode: 'tripped-localization',
      lineCurrentAmps: 0,
      conductorResistanceOhmKm: spec.conductorResistanceOhmKm,
      totalCableResistanceOhm,
      repeaterDropVolts: spec.repeaterDropVolts,
      totalSystemVoltageKv,
      terminalAVoltageKv: 0,
      terminalBVoltageKv: 0,
      maxTerminalRatingKv: spec.maxTerminalVoltageKv,
      powerMarginKv: 0,
      zeroVoltPositionKm: cutKm,
      totalWetPlantPowerKw: 0,
      poweredRepeaterCount: 0,
      unpoweredRepeaterCount: repeaterCount,
      voltageProfileKv: [
        { km: 0, voltageKv: 0 },
        { km: cutKm, voltageKv: 0 },
        { km: cable.lengthKm, voltageKv: 0 },
      ],
    };
  }

  // Case 2: Insulation Shunt Fault to Seawater Ground at faultProgressT
  // The shunt fault clamps V(x_fault) = 0 V (ocean ground potential).
  // Terminal A feeds +V_total * t_fault, Terminal B feeds -V_total * (1 - t_fault)
  if (faultMode === 'shunt-fault') {
    const faultKm = Number((cable.lengthKm * clampedT).toFixed(1));
    const reqAKv = totalSystemVoltageKv * clampedT;
    const reqBKv = totalSystemVoltageKv * (1 - clampedT);
    const maxReqKv = Math.max(reqAKv, reqBKv);

    const terminalAVoltageKv = Number(
      Math.min(spec.maxTerminalVoltageKv, reqAKv).toFixed(2)
    );
    const terminalBVoltageKv = Number(
      (-Math.min(spec.maxTerminalVoltageKv, reqBKv)).toFixed(2)
    );
    const powerMarginKv = Number(
      (spec.maxTerminalVoltageKv - maxReqKv).toFixed(2)
    );

    const overloadRatio =
      maxReqKv > spec.maxTerminalVoltageKv
        ? (maxReqKv - spec.maxTerminalVoltageKv) / maxReqKv
        : 0;
    const unpoweredRepeaterCount =
      overloadRatio > 0 ? Math.max(1, Math.ceil(repeaterCount * overloadRatio)) : 0;
    const poweredRepeaterCount = Math.max(
      0,
      repeaterCount - unpoweredRepeaterCount
    );

    return {
      mode: 'single-end-reconfig',
      lineCurrentAmps: spec.lineCurrentAmps,
      conductorResistanceOhmKm: spec.conductorResistanceOhmKm,
      totalCableResistanceOhm,
      repeaterDropVolts: spec.repeaterDropVolts,
      totalSystemVoltageKv,
      terminalAVoltageKv,
      terminalBVoltageKv,
      maxTerminalRatingKv: spec.maxTerminalVoltageKv,
      powerMarginKv,
      zeroVoltPositionKm: faultKm,
      totalWetPlantPowerKw,
      poweredRepeaterCount,
      unpoweredRepeaterCount,
      voltageProfileKv: [
        { km: 0, voltageKv: terminalAVoltageKv },
        { km: faultKm, voltageKv: 0 },
        { km: cable.lengthKm, voltageKv: terminalBVoltageKv },
      ],
    };
  }

  // Case 3: Single Shore PFE Terminal Outage (Terminal A drops to 0 V ocean ground; Terminal B supplies full string)
  if (faultMode === 'single-pfe-outage') {
    const terminalAVoltageKv = 0;
    const terminalBVoltageKv = Number(
      (-Math.min(spec.maxTerminalVoltageKv, totalSystemVoltageKv)).toFixed(2)
    );
    const powerMarginKv = Number(
      (spec.maxTerminalVoltageKv - totalSystemVoltageKv).toFixed(2)
    );
    const unpoweredRepeaterCount =
      totalSystemVoltageKv > spec.maxTerminalVoltageKv
        ? Math.ceil(
            repeaterCount *
              ((totalSystemVoltageKv - spec.maxTerminalVoltageKv) /
                totalSystemVoltageKv)
          )
        : 0;

    return {
      mode: 'single-end-reconfig',
      lineCurrentAmps: spec.lineCurrentAmps,
      conductorResistanceOhmKm: spec.conductorResistanceOhmKm,
      totalCableResistanceOhm,
      repeaterDropVolts: spec.repeaterDropVolts,
      totalSystemVoltageKv,
      terminalAVoltageKv,
      terminalBVoltageKv,
      maxTerminalRatingKv: spec.maxTerminalVoltageKv,
      powerMarginKv,
      zeroVoltPositionKm: 0,
      totalWetPlantPowerKw,
      poweredRepeaterCount: repeaterCount - unpoweredRepeaterCount,
      unpoweredRepeaterCount,
      voltageProfileKv: [
        { km: 0, voltageKv: 0 },
        { km: cable.lengthKm * 0.5, voltageKv: Number((terminalBVoltageKv * 0.5).toFixed(2)) },
        { km: cable.lengthKm, voltageKv: terminalBVoltageKv },
      ],
    };
  }

  // Case 4: Nominal Balanced Double-End Feeding (including optical-only-cut or single repeater pump degradation)
  const halfKv = Number((totalSystemVoltageKv * 0.5).toFixed(2));
  const powerMarginKv = Number((spec.maxTerminalVoltageKv - halfKv).toFixed(2));

  return {
    mode: 'double-end-bipolar',
    lineCurrentAmps: spec.lineCurrentAmps,
    conductorResistanceOhmKm: spec.conductorResistanceOhmKm,
    totalCableResistanceOhm,
    repeaterDropVolts: spec.repeaterDropVolts,
    totalSystemVoltageKv,
    terminalAVoltageKv: halfKv,
    terminalBVoltageKv: -halfKv,
    maxTerminalRatingKv: spec.maxTerminalVoltageKv,
    powerMarginKv,
    zeroVoltPositionKm: Number((cable.lengthKm * 0.5).toFixed(1)),
    totalWetPlantPowerKw,
    poweredRepeaterCount: repeaterCount,
    unpoweredRepeaterCount: 0,
    voltageProfileKv: [
      { km: 0, voltageKv: halfKv },
      { km: Number((cable.lengthKm * 0.5).toFixed(1)), voltageKv: 0 },
      { km: cable.lengthKm, voltageKv: -halfKv },
    ],
  };
}

