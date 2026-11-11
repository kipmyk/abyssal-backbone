# Abyssal Backbone — Subsea Fiber-Optic, PFE & RFC 4271 BGP-4 Engineering Simulator

**Abyssal Backbone** is an interactive 3D subsea telecommunications, physical-layer optical transmission, constant-current Power Feeding Equipment (PFE), and inter-domain RFC 4271 BGP-4 fault simulator built with TypeScript, Three.js, and Vite.

---

## Development Note

Abyssal Backbone was originally built using **Gemini 4 Argon** as an experimental project to test the model's capabilities in building a complex, interactive engineering simulation.

What started as an experiment evolved into an exploration of subsea telecommunications, fiber-optic engineering, bathymetry, and BGP routing.

The project continues to evolve with a focus on engineering accuracy, physical realism, and reproducible simulations.

---

## Engineering Models & Physical Fidelity

Every number displayed in the engineering workstation is derived from physical or protocol equations rather than hardcoded UI telemetry:

### 1. Submarine Optical Transmission Engine ([`src/sim/opticalEngine.ts`](./src/sim/opticalEngine.ts))
Models long-haul submarine DWDM transmission in accordance with **ITU-T G.977**, **ITU-T G.976**, and **ITU-T G.Suppl.41**:
- **Vacuum vs. Group Velocity Propagation Delay**:
  $$\tau_{\text{prop}} = \frac{L \cdot n_{\text{eff}}}{c_0}, \quad c_0 = 299{,}792.458\text{ km/s}, \quad v_g \approx \frac{c_0}{1.4680} \approx 204{,}218\text{ km/s}$$
- **Per-Span Optical Attenuation**:
  $$A_{\text{span}} = \alpha_{\text{dB/km}} \cdot L_{\text{span}} + \alpha_{\text{splice}} \cdot N_{\text{splices}} + \alpha_{\text{age}}$$
- **Repeater EDFA Noise & ASE Accumulation** ($h\nu = 1.284\times 10^{-19}\text{ J}$ at $\lambda = 1550\text{ nm}$, $B_{\text{ref}} = 12.5\text{ GHz}$):
  $$P_{\text{ASE},k} = n_{\text{sp}} \cdot h\nu \cdot (G_k - 1) \cdot B_{\text{ref}}, \quad \text{OSNR}_{\text{ASE}} = 10\log_{10}\left(\frac{P_{\text{ch}}}{\sum_{k=1}^{N} P_{\text{ASE},k}}\right)$$
- **Kerr Nonlinear Interference (Gaussian Noise Model)** & Total Generalized OSNR ($\text{GOSNR}$):
  $$\text{SNR}_{\text{total}}^{-1} = \text{OSNR}_{\text{ASE}}^{-1} + \text{SNR}_{\text{NLI}}^{-1}$$
- **Q-Factor, Pre-FEC / Post-FEC BER, and SD-FEC Thresholds**:
  - $\text{Q}_{\text{dB}} \ge 8.5\text{ dB}$: Nominal operation.
  - $6.2\text{ dB} \le \text{Q}_{\text{dB}} < 8.5\text{ dB}$: Degraded optical margin (Pre-FEC errors rising, corrected by SD-FEC or throughput-throttled).
  - $\text{Q}_{\text{dB}} < 6.2\text{ dB}$: Loss of Frame / Loss of Signal (`LOS`).

### 2. Submarine Constant-Current Power Feeding Equipment ([`src/sim/pfeEngine.ts`](./src/sim/pfeEngine.ts))
Models dual-end constant-current DC power feeding ($I_{\text{line}} = 0.85\text{–}1.10\text{ A}$) across a $0.7\text{–}1.0\text{ }\Omega/\text{km}$ copper composite conductor:
- **Nominal Dual-End Feed**:
  $$V_{\text{total}} = I_{\text{line}} \cdot R_{\text{cu}} \cdot L + N_{\text{rep}} \cdot V_{\text{drop,rep}}, \quad V_A = +\frac{V_{\text{total}}}{2}, \quad V_B = -\frac{V_{\text{total}}}{2}$$
- **Single-End Earth Shunt Fault (`shunt-fault`)**:
  - Insulation breakdown at fractional distance $x_f \in (0,1)$ creates a seawater virtual ground ($0\text{ V}$) at $x_f \cdot L$.
  - Terminal A feeds Segment A ($+V_A = I \cdot R_A$) and Terminal B feeds Segment B ($-V_B = -I \cdot R_B$), keeping all repeaters energized while raising a PFE ground fault alarm unless required voltage exceeds terminal compliance ($\pm 12\text{–}15\text{ kV}$).

### 3. Inter-Domain RFC 4271 BGP-4 Control Plane ([`src/sim/bgpEngine.ts`](./src/sim/bgpEngine.ts))
Separates control-plane route selection from data-plane forwarding:
- Models Autonomous Systems (`ASN`, Tier-1 / Tier-2 IXP / Regional transit roles), `Adj-RIB-In`, `Loc-RIB`, and `Adj-RIB-Out`.
- Executes the **RFC 4271 Section 9.1.2** decision process in strict order:
  1. Highest `LOCAL_PREF` (Customer `200` > Peer `150` > Provider `100` per Gao-Rexford valley-free routing)
  2. Shortest `AS_PATH` length
  3. Lowest `ORIGIN` (`IGP` < `EGP` < `INCOMPLETE`)
  4. Lowest `MED` (Multi-Exit Discriminator)
  5. `eBGP` over `iBGP`
  6. Lowest IGP physical propagation delay to `NEXT_HOP`
  7. Lowest neighbor router ID tie-breaker
- Supports BGP community policy enforcement (`NO_EXPORT` (`65535:65281`), `6453:999` Cape Emergency Transit), valley-free route leaks, and `/24` sub-prefix hijacks.

### 4. Bathymetric Relief, Burial Profile & Branching Units ([`src/data/bathymetry.ts`](./src/data/bathymetry.ts), [`src/data/provenance.ts`](./src/data/provenance.ts))
- Continuous proportional bathymetry ($0\text{ m}$ to $-8{,}500\text{ m}$) covering continental shelves, slopes, mid-ocean ridges, and abyssal plains.
- Depth-derived submarine cable armor classification:
  - **Double Armored (`DA`)** & $1.5\text{–}2.2\text{ m}$ seabed plough burial on shallow shelves ($< 400\text{ m}$).
  - **Single Armored (`SA`)** & $0.8\text{ m}$ burial on upper continental slopes ($400\text{–}1{,}500\text{ m}$).
  - **Light Weight Protected (`LWP`)** across mid-depth slopes and ridges ($1{,}500\text{–}2{,}500\text{ m}$).
  - **Light Weight (`LW`)** surface-laid across deep abyssal plains ($> 2{,}500\text{ m}$).
- Subsea Branching Units (`BU`) with passive optical wavelength/fiber routing and PFE high-voltage sea-earth switching.

### 5. Coherent OTDR (C-OTDR) & PFE Fault Localization ([`src/sim/otdrEngine.ts`](./src/sim/otdrEngine.ts))
- Distinguishes single-ended conventional OTDR (limited to the first repeater span by EDFA optical isolators) from submarine **Coherent OTDR (C-OTDR) / Line Monitoring Equipment (LME)** and **PFE DC Voltage/Resistance Bridge** localization.
- Computes physical distance uncertainty $\pm\Delta x\text{ km}$ from group index uncertainty ($\pm 0.0005$), fiber slack/plough overlength factor ($1.2\%\text{–}2.8\%$), and span noise floor.

### 6. 15-Stage Subsea Marine Repair Workflow ([`src/sim/repairEngine.ts`](./src/sim/repairEngine.ts))
- Models realistic marine repair logistics from fault detection through C-OTDR/PFE localization, zone permit clearance, CS vessel transit at $11.8\text{–}12.5\text{ kn}$, sea-state weather hold, ROV seabed survey or deep grapnel runs, cable cut, End-A recovery & buoy-off, End-B recovery, shipboard universal joint (`UJ`) + spare repeater (`RPT`) splicing ($16\text{–}18\text{ h}$ per joint), final bight lay (`2.3×` water depth extra spare cable), and post-lay burial inspection.

---

## Fault & Routing Scenarios

The simulator includes 10 deterministic engineering scenarios selectable from the top control bar:

| Scenario ID | Category | Physical / Protocol Mechanism |
| :--- | :--- | :--- |
| `red-sea-blackout` | Multi-Cable Cut | Simultaneous anchor-drag severing of 4 Red Sea systems (`2Africa`, `PEACE`, `SEA-ME-WE 6`, `EIG`), forcing Cape of Good Hope reroutes. |
| `luzon-typhoon` | Turbidity Current Cut | Submarine canyon turbidity landslide severing `Cross-Strait Express` and `Pacific Rim North` in the Luzon Strait. |
| `med-anchor-drag` | Shallow Shelf Cut | Anchor drag in the Sicilian Channel severing `2Africa` and `Med-Atlantic Corridor`. |
| `atlantic-storm` | Continental Shelf Cut | Flemish Cap fishing trawl fault severing `Amitié` and `Trans-Atlantic North`. |
| `pfe-shunt-fault` | PFE Insulation Shunt | Single-end sea-earth insulation fault on `PEACE` (`I_shunt = 0.96 A`). Dual-end PFE re-biases (`+1.23 kV / -2.29 kV`), keeping traffic online in `DEGRADED` status. |
| `repeater-pump-degrade` | Optical Degradation | Repeater `RPT-03` 980 nm laser diode degradation on `Equiano` (`-6.5 dB` gain loss), compressing Q-factor and margin without full LOS. |
| `bgp-route-leak` | BGP Route Leak | `AS37100` (Mtunzini) leaks learned provider routes to transit peers (`LOCAL_PREF 200`), hair-pinning Europe–Africa traffic. |
| `bgp-prefix-hijack` | BGP `/24` Hijack | Unauthorized `/24` sub-prefix announcement (`102.68.14.0/24`) preempts `/16` covering route via longest-prefix match. |
| `cape-policy-block` | BGP Policy Block | Simultaneous Red Sea cut and `NO_EXPORT` community block at Cape Town (`AS3741`), triggering `POLICY_BLOCKED` reachability loss despite physical Cape fiber remaining intact. |
| `suez-cls-outage` | CLS Facility Outage | Terrestrial Suez-Cairo CLS power/backhaul outage isolating all 4 Red Sea cables without an underwater fiber break. |

---

## Getting Started

### Prerequisites
- Node.js 20+ and npm

### Installation & Development Server
```bash
npm install
npm run dev
```

### Production Build & Typecheck
```bash
npm run build
```

### Phase 1–10 Scientific Integrity Verification Suite
Run the automated deterministic verification suite ([`src/sim/verificationSuite.ts`](./src/sim/verificationSuite.ts)) validating ITU-T G.977 ASE accumulation, EDFA unpowered absorption, PFE Ohm's law & shunt re-biasing, RFC 4271 BGP-4 tie-breaking, C-OTDR uncertainty bounds, and 15-stage deep-water repair bight geometry:
```bash
npm test
```

---

## Data Provenance & Attribution

All infrastructure entries in Abyssal Backbone carry explicit provenance tags (`REAL`, `APPROXIMATED`, or `SYNTHETIC`) documented in [`src/data/provenance.ts`](./src/data/provenance.ts) and [`docs/ENGINEERING_AUDIT.md`](./docs/ENGINEERING_AUDIT.md).

## License

Released under the [MIT License](./LICENSE).
