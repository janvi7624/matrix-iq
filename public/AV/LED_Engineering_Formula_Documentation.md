# LED Display Engineering Formula Documentation

Reference document for the LED Controller Selection AI dataset.
All formulas follow standard engineering practice used by LED display manufacturers (NovaStar, Colorlight, Linsn, Huidu, Brompton) and system integrators.

Version 1.0 — 17 July 2026

---

## 1. Unit Conversion

**Feet to millimetres**

```
Display_Width_mm  = Display_Width_ft  × 304.8
Display_Height_mm = Display_Height_ft × 304.8
```

1 foot = 304.8 mm exactly. In practice, physical display size is dictated by cabinet dimensions, so the feet value is derived from the cabinet matrix rather than the other way round:

```
Display_Width_mm  = Cabinet_Width_mm  × Cabinets_Horizontal
Display_Height_mm = Cabinet_Height_mm × Cabinets_Vertical
Display_Width_ft  = Display_Width_mm  ÷ 304.8
```

**Area**

```
Total_Area_sqft = Display_Width_ft × Display_Height_ft
Total_Area_sqm  = (Display_Width_mm × Display_Height_mm) ÷ 1,000,000
```

---

## 2. Pixel Calculations

Pixel pitch (P value) is the centre-to-centre distance between LEDs in millimetres. P2.5 means 2.5 mm between pixel centres.

```
Horizontal_Pixels = Display_Width_mm  ÷ Pixel_Pitch_mm
Vertical_Pixels   = Display_Height_mm ÷ Pixel_Pitch_mm
Total_Pixels      = Horizontal_Pixels × Vertical_Pixels
Total_Megapixels  = Total_Pixels ÷ 1,000,000
```

Because cabinet dimensions are designed as integer multiples of the pitch, these divisions always resolve to whole numbers (e.g. a 500 mm cabinet at P2.5 = exactly 200 px).

**Pixel density**

```
Pixels_per_sqm = (1000 ÷ Pixel_Pitch_mm)²
```

Example: P2.5 → (1000/2.5)² = 160,000 px/m².

**Minimum viewing distance (rule of thumb)**

```
Min_Viewing_Distance_m ≈ Pixel_Pitch_mm × 1.0   (acceptable)
Optimal_Viewing_Distance_m ≈ Pixel_Pitch_mm × 2–3
```

P4 → comfortable from ~8–12 m. This drives indoor (fine pitch) vs outdoor (coarse pitch) selection.

---

## 3. Cabinet and Module Calculations

```
Cabinets_Horizontal = Display_Width_mm  ÷ Cabinet_Width_mm
Cabinets_Vertical   = Display_Height_mm ÷ Cabinet_Height_mm
Total_Cabinets      = Cabinets_Horizontal × Cabinets_Vertical

Modules_per_Cabinet = (Cabinet_Width_mm ÷ Module_Width_mm) × (Cabinet_Height_mm ÷ Module_Height_mm)
Total_Modules       = Modules_per_Cabinet × Total_Cabinets
```

Common combinations:

| Pitch | Module (mm) | Cabinet (mm) | Cabinet resolution |
|---|---|---|---|
| P0.9 / P1.25 | 150 × 168.75 | 600 × 337.5 | 667 × 375 / 480 × 270 |
| P1.86 / P2 / P2.5 | 320 × 160 | 640 × 480 or 500 × 500 | e.g. P2.5: 256 × 192 |
| P3 / P4 | 192 × 192 / 320 × 160 | 576 × 576, 640 × 640, 960 × 960 | e.g. P4: 240 × 240 |
| P5–P10 outdoor | 320 × 160 | 960 × 960, 1280 × 960 | e.g. P10: 96 × 96 |

---

## 4. Receiving Card Calculations

A receiving card (RX) drives one cabinet in fixed installations. Its load limit is set by both pixel capacity and HUB connector count.

```
Cabinet_Pixels = (Cabinet_Width_mm ÷ Pitch) × (Cabinet_Height_mm ÷ Pitch)

RX_per_Cabinet = CEILING( Cabinet_Pixels ÷ RX_Max_Pixels )
Required_Receiving_Cards = Total_Cabinets × RX_per_Cabinet
```

Typical RX capacities: NovaStar A5s Plus ≈ 512×384, A8s/A10s Pro ≈ 512×512 (262,144 px); Colorlight i5/i9 similar class. For all cabinet sizes in this dataset one RX card per cabinet is sufficient, so:

```
Required_Receiving_Cards = Total_Cabinets
```

For redundant systems, RX count doubles only if hot-backup cards are physically installed (rare); normally redundancy is achieved by loop cabling, not extra RX cards.

---

## 5. Bandwidth / Data Rate Estimation

**Raw video payload**

```
Data_Rate_bps = Total_Pixels × Colour_Depth_bits × Frame_Rate × Overhead
Data_Rate_Gbps = Data_Rate_bps ÷ 1,000,000,000
```

Dataset assumptions: 24-bit colour (3 × 8 bit), 60 fps source, 15 % protocol/blanking overhead:

```
Data_Rate_Gbps = Total_Pixels × 24 × 60 × 1.15 ÷ 10⁹
```

Note: display **refresh rate** (1920 Hz / 3840 Hz) is generated on the module by the driver ICs from the frame buffer — it does not multiply the transport bandwidth. Transport bandwidth follows the **source frame rate** (60 fps here).

**Gigabit port capacity (industry rule of thumb)**

```
Pixels_per_1G_Port @ 60Hz, 8-bit  ≈ 650,000
Pixels_per_1G_Port @ 60Hz, 10-bit ≈ 490,000
Pixels_per_1G_Port @ 120Hz, 8-bit ≈ 325,000
Pixels_per_10G_Fiber ≈ 6,500,000 (8-bit, 60 Hz)

Ports_Required = CEILING( Total_Pixels ÷ 650,000 )
```

Higher bit depth or frame rate divides the per-port capacity proportionally:

```
Pixels_per_Port = 650,000 × (60 ÷ Frame_Rate) × (8 ÷ Bits_per_Colour)
```

---

## 6. Controller (Sending) Capacity Calculations

```
Controller_Usable_Pixels = Controller_Max_Pixels × (1 − Safety_Margin)

Fits_Single_Controller =
      Total_Pixels        ≤ Controller_Usable_Pixels
  AND Horizontal_Pixels   ≤ Controller_Max_Width
  AND Vertical_Pixels     ≤ Controller_Max_Height
  AND Ports_Required      ≤ Ethernet_Ports + (Fiber_Ports × 10G_equivalent)

Controller_Units = CEILING( Total_Pixels ÷ Controller_Usable_Pixels )
Controller_Load_% = Total_Pixels ÷ (Controller_Max_Pixels × Controller_Units) × 100
```

**Selection algorithm used in this dataset**

1. Filter all controllers where the display fits (pixels, width, height) with ≥ 10 % headroom.
2. Prefer the smallest controller whose utilisation is ≥ 30 % (economical fit — avoids paying for unused capacity).
3. Apply project-tier preference (budget → Huidu/Linsn/Colorlight entry; standard → NovaStar VX/MCTRL, Colorlight X; premium/broadcast/XR → NovaStar MX, Brompton Tessera).
4. If nothing fits, cascade N units of the largest fiber-class controller (MX6000 Pro / X8000 class) in mosaic mode with genlock.

---

## 7. Safety Margin

```
Safety_Margin = 10 % (minimum, this dataset)
```

Reasons: firmware overhead, future frame-rate or bit-depth upgrades, calibration data traffic, and avoiding operation at absolute limits. Premium/rental applications often plan 20–25 % headroom. Never load a port or controller to 100 % of datasheet capacity.

```
Design_Load_Pixels ≤ 0.9 × Datasheet_Max_Pixels
```

---

## 8. Redundancy

**When required (dataset rule):**

```
Redundancy = YES if:
    (Outdoor AND Area > 400 sq ft)      — weather-exposed, high-visibility assets
 OR Total_Pixels > 4,000,000            — large commercial walls
 OR Application_Tier = Premium          — broadcast / mission-critical
```

**How it is implemented:**

- **Loop (ring) backup:** each Ethernet chain is cabled from the last cabinet back to a spare port. Port count doubles:
  ```
  Ports_With_Redundancy = Ports_Required × 2
  ```
- **Dual controller hot backup:** a second identical sending unit mirrors the primary (frame-sync). Controller count doubles.
- **Dual power/data cabinets:** outdoor cabinets specified with dual PSU and dual RX where the budget allows.

Redundant port demand can force selection of the next controller size up even when raw pixel capacity fits — always check `Ports_Required × 2 ≤ Available_Ports` when redundancy is mandated.

---

## 9. Best Practices

1. **Design from the cabinet, not the feet.** Round the requested feet dimensions to the nearest whole cabinet matrix, then recompute the true size.
2. **Match pitch to viewing distance**, not to budget alone (Section 2 rule of thumb).
3. **Brightness:** indoor 600–1,200 nits; semi-outdoor 2,500–4,000; full sunlight outdoor 5,000–10,000 nits.
4. **Refresh rate ≥ 1920 Hz** for any display that will be filmed or photographed; ≥ 3840 Hz for broadcast/XR.
5. **Keep controller load between 30 % and 90 %** of derated capacity — below 30 % wastes money, above 90 % erodes the safety margin.
6. **Fiber above 100 m.** Copper Cat6 runs must stay under 100 m; use 10G optical between controller and distribution for longer runs and for > ~6.5 MP walls.
7. **One RX card per cabinet** for fixed installs simplifies service; map ports so each Ethernet chain stays under its pixel limit *and* under ~8–10 cabinets for easy fault isolation.
8. **Plan redundancy for outdoor and revenue-generating displays** (DOOH, stadiums) — loop backup costs only cabling and ports.
9. **Verify width/height port-map limits**, not just total pixels: ultrawide ticker displays frequently exceed max-width before max-pixels.
10. **Always re-verify against the current official datasheet.** Capacities in the knowledge base reflect published specs at time of writing; firmware versions and regional SKUs vary. Prices are indicative — confirm with authorized distributors (USD→INR at ₹84/$ used here, excluding GST/duties).

---

## Worked Example

Requirement: ~20 ft × 10 ft indoor P2.5 wall.

```
Cabinet 640×480 mm → 10 × 6 cabinets = 6400 × 2880 mm (21.0 × 9.45 ft, 198.4 sq ft)
Pixels: 6400/2.5 × 2880/2.5 = 2560 × 1152 = 2,949,120 px (2.95 MP)
Modules: 640/320 × 480/160 = 6 per cabinet × 60 cabinets = 360
Data rate: 2,949,120 × 24 × 60 × 1.15 / 10⁹ = 4.88 Gbps
Ports: ceil(2,949,120 / 650,000) = 5
RX cards: 60
Controller: needs ≥ 2.95/0.9 = 3.28 MP usable → NovaStar VX600 (3.9 MP, 6 ports) — load 75.6 %, 5 of 6 ports used. ✔
```
