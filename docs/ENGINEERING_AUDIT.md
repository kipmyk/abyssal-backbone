# Phase 1: Engineering Reality Audit — Abyssal Backbone

**Audit Date:** 2026-11-11  
**Target Codebase:** `/Users/mac/Code/Gemini` (Baseline Commit `21aade3`)  
**Standards Referenced:** ITU-T G.977, ITU-T G.977.1, ITU-T G.976, ITU-T G.654, ITU-T G Suppl. 41, RFC 4271 (BGP-4)

---

## 1. Verified Capabilities in Baseline Implementation

1. **Geodesic & Spherical 3D Coordinate Mapping (`src/globe/GlobeScene.ts`)**:
   - Converts WGS84 `[lat, lon]` coordinates to 3D Cartesian vectors (`latLonToVector3` / `vector3ToLatLon`) and drapes `CatmullRomCurve3` cable geometries over a displaced seabed mesh.
2. **First-Order Optical Propagation Velocity (`src/sim/routingEngine.ts`)**:
   - Uses refractive index $n \approx 1.468$ ($v = c / n \approx 204.19\text{ km/ms}$) to calculate baseline round-trip propagation delay from cable route length.
3. **Interactive Fault Injection & Multi-Corridor State Tracking (`src/main.ts`, `src/sim/routingEngine.ts`)**:
   - Supports interactive 3D raycast cable clicks, 29 Cable Landing Stations (CLS), 41 subsea/terrestrial segments, 12 traffic corridors, and custom source-destination traceroute inspection.
4. **Dual-Viewport 3D Rendering (`src/globe/GlobeScene.ts`, `src/subsea/SubseaRovScene.ts`)**:
   - Separates global orbital visualization from close-up 3D subsea cable/repeater/ROV inspection and 2D canvas cross-sections (`src/ui/seabedOtdrCanvas.ts`).

---

## 2. Parameter-by-Parameter Engineering Audit Table

| Parameter | Physical / Networking Quantity | Unit | Governing Equation / Principle | Standard / Reference | Operational Limitations | Current Baseline Implementation Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Fiber Attenuation ($\alpha$)** | Linear optical power loss per unit length at $\lambda = 1550\text{ nm}$ | $\text{dB/km}$ | $P(z) = P_0 - \alpha z$ | ITU-T G.654.B/E ($0.154\text{--}0.170\text{ dB/km}$), G.652.D ($0.19\text{--}0.22\text{ dB/km}$) | Increases with hydrogen darkening, radiation, bend loss, and splice aging (EOL margin). | **Missing / Hardcoded:** Not modeled in `routingEngine.ts`; `seabedOtdrCanvas.ts` uses an arbitrary graphic slope (`0.14 + spanSaw + t * 0.12`). |
| **Span Loss & Amplifier Gain ($G$)** | Total optical attenuation across repeater span of length $L_{\text{span}}$ compensated by EDFA gain | $\text{dB}$ | $G = \alpha L_{\text{span}} + L_{\text{splice}} + L_{\text{margin}}$ | ITU-T G.977, G.977.1 | Typical EDFA gain $14\text{--}20\text{ dB}$; excessive span length ($>110\text{ km}$) degrades OSNR exponentially. | **Oversimplified:** `computeRepeaterCount` divides `lengthKm / 95` (or `85`) without computing span loss or distinguishing repeaterless systems. |
| **ASE Noise & OSNR** | Ratio of optical signal power to Amplified Spontaneous Emission (ASE) noise in $B_{\text{ref}} = 12.5\text{ GHz}$ ($0.1\text{ nm}$) | $\text{dB}$ | $\text{OSNR}_{\text{dB}} = P_{\text{out,dBm}} - L_{\text{span,dB}} - \text{NF}_{\text{dB}} - 10\log_{10}(N) - 10\log_{10}(h\nu B_{\text{ref}} / 1\text{ mW})$ where $10\log_{10}(h\nu B_{\text{ref}}) \approx -58.0\text{ dBm}$ | ITU-T G Suppl. 41, G.977 | Must account for nonlinear Kerr impairments ($\text{SNR}_{\text{NLI}}$) at high launch power, creating an optimal launch power (~$0\text{ to }+2\text{ dBm/ch}$). | **Inaccurate Empirical Formula:** `computeNominalOsnrDb` uses `23.4 - Math.log10(repeaters) * 3.2`, ignoring launch power, span loss, noise figure, and nonlinearities; sets `osnrDb = 0` on cut. |
| **Q-Factor & Pre/Post-FEC BER** | Signal quality metric and bit-error rate before and after Soft-Decision Forward Error Correction | $\text{dB}$, dimensionless | $Q_{\text{linear}} \approx \sqrt{\text{GSNR} \cdot \frac{B_{\text{ref}}}{R_s}}$, $\text{BER}_{\text{pre}} = \frac{1}{2}\text{erfc}\left(\frac{Q_{\text{linear}}}{\sqrt{2}}\right)$ | ITU-T G.975.1, G.976, G Suppl. 41 | SD-FEC limit typically $\text{BER}_{\text{pre}} \approx 2.4 \times 10^{-2}$ ($Q \approx 6.0\text{ dB}$). Below threshold, optical carrier drops (LOF/LOS). | **Missing:** Neither Q-factor, Pre-FEC BER, Post-FEC BER, chromatic dispersion, PMD, nor BOL/EOL margin are calculated. |
| **PFE Constant Current & Terminal Voltage ($I_{\text{PFE}}, V_{\text{PFE}}$)** | Direct-current constant-current power feed and terminal voltages across cable conductor + repeaters | $\text{A}$, $\text{kV}$ | $V_{\text{total}} = I_{\text{PFE}} \cdot (R_{\text{cable}} \cdot L) + N_{\text{rep}} \cdot V_{\text{drop,rep}}$; Balanced double-end feed: $V_A = +V_{\text{total}}/2$, $V_B = -V_{\text{total}}/2$ | ITU-T G.977, SubOptic PFE Standards | Max terminal rating typically $\pm 12\text{ to }\pm 15\text{ kV}$. Under single-shunt fault, single-end feeding can maintain operation if $V_{\text{total}} \le V_{\text{max}}$. | **Inaccurate:** `computeNominalPfeKv` uses `1.6 + repeaters * 0.145` without current $I$, conductor $\Omega/\text{km}$, or repeater drop $V_{\text{rep}}$; sets `pfeVoltageKv = 0` on any fault, even a shunt fault. |
| **BGP Control Plane vs. Data Plane** | Autonomous System path vector routing (RFC 4271) vs. physical fiber forwarding | AS numbers, prefixes, attributes | RFC 4271 Decision Process: `LOCAL_PREF` $\to$ `AS_PATH` length $\to$ `ORIGIN` $\to$ `MED` $\to$ `eBGP > iBGP` $\to$ IGP metric to `NEXT_HOP` | RFC 4271, RFC 1997 (Communities), Gao-Rexford Valley-Free Model | Policy (no-export, valley-free peering, route filters) can block a physically intact path; route leaks/hijacks can blackhole or tromboning-congest traffic when all physical cables are intact. | **Incorrect Architecture:** `RoutingEngine.findShortestPath` runs latency+utilization Dijkstra directly over landing stations. No ASes, BGP speakers, RIBs, `LOCAL_PREF`, `AS_PATH`, or policy filtering exist. |
| **Bathymetry, Cable Armor & Burial Depth** | Seabed depth, sediment type, armor class, and sub-seabed burial depth along route | $\text{m}$ | Burial target $d_{\text{burial}} \in [0, 2.5]\text{ m}$ governed by water depth ($<1500\text{ m}$), sediment plowability, and fishing/anchor hazard index | ICPC Recommendations #2, #6 | Plow burial feasible down to ~$1,500\text{ m}$ in sand/clay; rocky outcrops require articulated pipe/mattresses; deep abyssal ($>2,000\text{ m}$) is surface-laid LW cable ($0\text{ m}$ burial). | **Missing:** Cables have only a scalar `depthMaxM`. No segment-level armor profile (DA, SA, LWP, LW), burial depth profile, or Branching Units (BUs) are modeled. |
| **OTDR / C-OTDR & LME Localization** | Optical backscatter trace and fault distance estimation with measurement uncertainty | $\text{dB}$, $\text{km}$ | Conventional OTDR limited to first repeater (~$90\text{ km}$) by optical isolators; long-haul uses Coherent OTDR (C-OTDR) through EDFA chain + LME + PFE DC resistance/capacitance bridge | ITU-T G.976, G.977.1 | C-OTDR & electrical bridge localization has distance uncertainty $\pm \Delta x$ ($\pm 0.8\text{ to }\pm 8.5\text{ km}$) due to refractive index variation, cable slack ($2\text{--}8\%$), and ASE noise floor. | **Misleading:** `seabedOtdrCanvas.ts` plots a single conventional OTDR trace across $9,000\text{ km}$ as if no isolators exist, and reports exact fault distance to $0.1\text{ km}$ with zero uncertainty. |
| **Subsea Repair Workflow** | 15-stage maritime cable ship & ROV recovery, jointing, testing, and re-lay operation | Hours / days, knots, meters | Recovery time scales with depth $D$, sea state (Beaufort), burial de-trenching, water-ingress cutback ($2\cdot D$), universal joint splicing (~$16\text{--}24\text{ h/joint}$), and vessel transit distance | ICPC / Atlantic & Indian Ocean Cable Maintenance Agreements (ACMA / IOCMA / MECMA) | Deep-water repairs ($>4,000\text{ m}$) require holding-grapnel + cut-and-hold or ROV assistance and insertion of spare cable equal to $2 \times \text{depth}$; weather > Beaufort 6 halts deck jointing. | **Oversimplified:** `tickRepairs` uses a 4-label linear counter (`steaming -> grappling -> splicing -> pfe-ramp`) finishing in seconds with no mobilization, transit distance, slack budget, or electrical/optical acceptance testing. |

---

## 3. Incorrect Relationships Between Simulation Subsystems

1. **Dijkstra Used as Control Plane**: Traffic immediately shifts around congested or severed cables using global shortest-path knowledge (`findShortestPath`). In reality, BGP selects paths at the Autonomous System (AS) level based on `LOCAL_PREF` and `AS_PATH` length; BGP is oblivious to physical cable utilization or optical OSNR unless an interface breaches its Post-FEC BER threshold and tears down the BGP session, or Traffic Engineering (TE) / MED policy is explicitly applied.
2. **All Faults Treated as Total Optical + Electrical Cuts**: In `severCable`, every fault immediately zeroes both `pfeVoltageKv` and `osnrDb` and takes the entire trunk offline. In reality:
   - A **PFE Shunt Fault** (insulation abrasion to seawater without severing the copper tube or fibers) shifts the virtual ground to the fault point; dual-end PFE terminals automatically reconfigure so the intact cable continues passing 100% of optical traffic unless single-end voltage limits are exceeded.
   - A **Single-Terminal PFE Outage** drops one shore supply, forcing the remote terminal to supply the full repeater string voltage $V_{\text{total}}$.
   - A **Branching Unit (BU) Fault** can isolate a spur while leaving the main trunk operational (or vice versa).
   - A **BGP Route Leak or Prefix Hijack** causes massive latency inflation, tromboning, or blackholing while **zero physical subsea cables are severed**.
3. **Conventional OTDR Shown Across Multi-Thousand-Kilometer Repeatered Trunks**: Standard OTDR pulses cannot pass backward through unidirectional EDFA optical isolators. Submarine systems use **Coherent OTDR (C-OTDR)** via dedicated supervisory return paths at repeaters, **Line Monitoring Equipment (LME)** gain-tilt telemetry per repeater span, and **PFE DC resistance/capacitance (Milliammeter / Bridge)** measurements for shunt/open fault localization.

---

## 4. Prioritized Implementation Roadmap

1. **Stage 1 (Highest Priority — Phase 4): BGP-4 Control Plane & Physical Data Plane Separation (`src/sim/bgpEngine.ts`, `src/sim/routingEngine.ts`)**
   - Model real Autonomous Systems (Tier-1 transits, regional carriers, cloud networks, IXP route servers), eBGP/iBGP sessions mapped to physical cable paths, `Adj-RIB-In`, `Loc-RIB`, `Adj-RIB-Out`, RFC 4271 decision rules (`LOCAL_PREF` $\to$ `AS_PATH` $\to$ `ORIGIN` $\to$ `MED` $\to$ `eBGP>iBGP` $\to$ `IGP`), valley-free export policies, and policy-induced reachability failures vs. data-plane capacity exhaustion.
2. **Stage 2 (Phase 2): ITU-T G.977 / G.Suppl.41 Optical Transmission Engine (`src/sim/opticalEngine.ts`)**
   - Compute span attenuation, EDFA gain, ASE noise accumulation, Kerr NLI penalty, GSNR, Q-factor, Pre-FEC and Post-FEC BER, chromatic dispersion, PMD, BOL/EOL margins, and distinguish repeatered vs. repeaterless architectures.
3. **Stage 3 (Phase 3): Constant-Current Submarine PFE Electrical Engine (`src/sim/pfeEngine.ts`)**
   - Compute constant current $I_{\text{PFE}}$, cable resistance $R_{\text{cable}} \cdot L$, repeater voltage drop $N_{\text{rep}} V_{\text{rep}}$, terminal voltages $V_A, V_B$, voltage profile $V(x)$ along the cable, and distinct fault modes (Shunt fault with automatic single-end PFE reconfiguration, Open-circuit cut, Optical-only fiber break, Single repeater failure, CLS PFE outage).
4. **Stage 4 (Phases 5, 6, 8): Bathymetric Engineering, Armor/Burial Profiles, C-OTDR/LME Uncertainty & Data Provenance (`src/data/provenance.ts`, `src/sim/otdrEngine.ts`)**
   - Add per-segment armor/burial models, Branching Units, provenance metadata (`verified` / `estimated` / `simulated`), and realistic C-OTDR + LME + PFE electrical bridge fault localization with confidence intervals and dead zones.
5. **Stage 5 (Phases 7 & 9): 15-Stage Subsea Repair Operations & 14 Credible Engineering Scenarios (`src/sim/repairEngine.ts`, `src/data/networkData.ts`, `src/main.ts`)**
   - Upgrade repair vessel simulation to the 15-stage maritime workflow with realistic ETR (hours/days) and add all 14 physical, power, and BGP control-plane scenarios.
6. **Stage 6 (Phase 10): Scientific Integrity & Deterministic Verification Suite (`src/sim/verificationSuite.ts`)**
   - Validate all physical equations, BGP decision invariants, PFE shunt vs. open behavior, and OTDR uncertainty bounds.

---

## 5. Test Plan & Measurable Acceptance Criteria

| Test ID | Subsystem | Verification Criterion | Target Acceptance Bound |
| :--- | :--- | :--- | :--- |
| **T-OPT-01** | Optical Attenuation & Span Loss | Span loss $L_{\text{span}} = \alpha \cdot d_{\text{span}} + L_{\text{splice}}$ scales strictly monotonically with span length and fiber coefficient $\alpha$. | Exact match to $\pm 0.01\text{ dB}$ against analytical formula. |
| **T-OPT-02** | ASE Noise & OSNR Accumulation | Doubling repeater count $N$ (with identical span loss and NF) reduces linear $\text{OSNR}_{\text{ASE}}$ by $10\log_{10}(2) \approx 3.01\text{ dB}$. | $\Delta \text{OSNR} = 3.01 \pm 0.05\text{ dB}$. |
| **T-OPT-03** | Q-Factor & FEC Threshold | Degrading OSNR below SD-FEC threshold ($Q < 6.0\text{ dB}$, $\text{BER}_{\text{pre}} > 2.4 \times 10^{-2}$) triggers post-FEC errors and optical link down. | Link transitions from `UP` to `LOS/LOF` when $Q < Q_{\text{FEC}}$. |
| **T-PFE-01** | Constant-Current Ohm's Law | Total PFE voltage $V_{\text{total}} = I_{\text{line}} R_{\text{km}} L + N_{\text{rep}} V_{\text{rep}}$ matches sum of positive and negative shore terminal magnitudes $\|V_A\| + \|V_B\|$. | Conservation of voltage to $\pm 0.01\text{ kV}$. |
| **T-PFE-02** | Shunt Fault Reconfiguration | A seawater insulation shunt fault at $x_f$ shifts $V(x_f) = 0\text{ V}$; if single-end required voltage $\le V_{\text{max}}$ ($15\text{ kV}$), repeaters remain powered and optical traffic stays UP. | Shunt fault on short/medium system keeps `opticalUp === true`; open cut sets `opticalUp === false`. |
| **T-BGP-01** | RFC 4271 Attribute Precedence | Route with higher `LOCAL_PREF` is chosen over shorter `AS_PATH`; equal `LOCAL_PREF` selects shorter `AS_PATH` even if physical propagation RTT is higher. | 100% deterministic compliance with RFC 4271 Section 9.1.2. |
| **T-BGP-02** | Policy Block vs. Physical Path | When valley-free / `no-export` policy filters a backup peering path, BGP reports `UNREACHABLE` despite an active physical path existing in the graph. | `physicallyReachable === true` AND `bgpReachable === false`. |
| **T-BGP-03** | Route Leak & Prefix Hijack | Injecting an unauthorized route leak or shorter-AS-path hijack diverts corridor traffic and induces congestion/blackhole with zero cables severed. | `severedCount === 0` AND `reroutedCount > 0`. |
| **T-OTDR-01** | Localization Uncertainty | Fault distance estimate includes non-zero uncertainty $\pm \Delta x$ ($\text{km}$) scaling with fiber length, slack variance, and measurement method (C-OTDR vs. DC bridge). | $\Delta x > 0.5\text{ km}$ for long-haul faults; true fault lies within $[x_{\text{est}} - \Delta x, x_{\text{est}} + \Delta x]$. |
| **T-REP-01** | Depth & Burial Repair Scaling | Repair ETR (hours) for a deep abyssal fault ($>4,500\text{ m}$) or deeply buried shelf fault in high sea state is strictly greater than a shallow unburied fault in calm seas. | $T_{\text{repair}}(5000\text{ m, Bft 6}) > T_{\text{repair}}(400\text{ m, Bft 2})$. |

