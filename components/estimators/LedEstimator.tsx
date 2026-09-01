'use client';

import { useEffect, useMemo, useState } from 'react';
import { LED_INSTALLATION_RATE_PER_SQFT, ledModels, LedModel } from '@/lib/data/ledModels';
import { aioModels, AioModel } from '@/lib/data/aioModels';
import {
  LED_ASPECT_PRESETS,
  LedRedundancyMode,
  LedUnit,
  computeLedPixelSpec,
  convertLedLength,
  ftToCurrentUnit,
  getAreaSqFt,
  getLedControllerSelection,
  getLedDimensionsFt,
  getNearestAspectPreset,
  parseCustomRatio
} from '@/lib/ledEngineering';
import { cabinetSizeForPitch, computeCabinetGridOptions, pitchesForCategory, CabinetGridOption } from '@/lib/ledCabinets';
import { formatMoney } from '@/lib/format';
import { selectAllOnFocus } from '@/lib/numberInputHelpers';
import { CostInputs, DomainResult, LineItem } from '@/lib/types';
import { applyOverride, extraProductKeys, overrideMapKey, OverrideMap } from '@/lib/catalogOverrides';
import styles from '../calculator.module.css';

export interface LedModelPreset {
  nonce: number;
  modelKey: string;
  heightFt: number;
  widthFt: number;
}

interface LedEstimatorProps {
  active: boolean;
  costInputs: CostInputs;
  onResultChange: (result: DomainResult) => void;
  presetModel?: LedModelPreset | null;
  overrides: OverrideMap;
}

function firstModelForCategory(category: 'indoor' | 'outdoor'): string {
  const categoriesToShow = category === 'indoor' ? ['indoor', 'cob'] : [category];
  return Object.keys(ledModels).find((key) => categoriesToShow.includes(ledModels[key].category)) || '';
}

export default function LedEstimator({ active, costInputs, onResultChange, presetModel, overrides }: LedEstimatorProps) {
  const [ledMode, setLedMode] = useState<'cabinet' | 'aio'>('cabinet');
  const [height, setHeight] = useState(4);
  const [width, setWidth] = useState(6);
  const [unit, setUnit] = useState<LedUnit>('ft');
  const [category, setCategory] = useState<'indoor' | 'outdoor'>('indoor');
  const [modelKey, setModelKey] = useState<string>(() => firstModelForCategory('indoor'));
  const [priceTier, setPriceTier] = useState<'b2b' | 'b2c'>('b2b');
  const [controlMode, setControlMode] = useState('Synchronous');
  const [redundancy, setRedundancy] = useState<LedRedundancyMode>('auto');
  const [aspectMode, setAspectMode] = useState<'auto' | 'custom'>('auto');
  const [aspectPreset, setAspectPreset] = useState('16:9');
  const [aspectCustom, setAspectCustom] = useState('16:9');
  const [pixelPitch, setPixelPitch] = useState<number>(() => pitchesForCategory('indoor')[0]);
  const [cabinetChoice, setCabinetChoice] = useState<'down' | 'up'>('down');
  const [aioModelKey, setAioModelKey] = useState<string>(() => Object.keys(aioModels)[0] || '');
  const [aioQty, setAioQty] = useState(1);

  // Admin-added products (Product Catalog) have no entry in the hardcoded
  // ledModels file — union their keys in and merge overrides on top of
  // whatever base exists (or {} for a brand-new product).
  const modelKeys = useMemo(
    () => [...Object.keys(ledModels), ...extraProductKeys('led', Object.keys(ledModels), overrides)].sort((a, b) => a.localeCompare(b)),
    [overrides]
  );
  const effectiveModels = useMemo(() => {
    const map: Record<string, LedModel> = {};
    modelKeys.forEach((key) => {
      map[key] = applyOverride(ledModels[key] || ({} as LedModel), overrides.get(overrideMapKey('led', key)), 'details');
    });
    return map;
  }, [modelKeys, overrides]);

  const aioModelKeys = useMemo(() => [...Object.keys(aioModels), ...extraProductKeys('aio', Object.keys(aioModels), overrides)], [overrides]);
  const effectiveAioModels = useMemo(() => {
    const map: Record<string, AioModel> = {};
    aioModelKeys.forEach((key) => {
      map[key] = applyOverride(aioModels[key] || ({} as AioModel), overrides.get(overrideMapKey('aio', key)), 'details');
    });
    return map;
  }, [aioModelKeys, overrides]);

  useEffect(() => {
    if (!aioModelKeys.includes(aioModelKey)) setAioModelKey(aioModelKeys[0] || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aioModelKeys]);

  useEffect(() => {
    const categoriesToShow = category === 'indoor' ? ['indoor', 'cob'] : [category];
    if (!categoriesToShow.includes(effectiveModels[modelKey]?.category)) {
      const match = modelKeys.find((key) => categoriesToShow.includes(effectiveModels[key]?.category));
      setModelKey(match || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, effectiveModels, modelKeys]);

  // Pixel pitch (for cabinet sizing) is a separate concern from the LED
  // model's own pitch (used for controller selection, unchanged below) —
  // reset it to a valid value for the category whenever category changes.
  useEffect(() => {
    const valid = pitchesForCategory(category);
    if (!valid.includes(pixelPitch)) setPixelPitch(valid[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  useEffect(() => {
    if (!presetModel || !ledModels[presetModel.modelKey]) return;
    setCategory('indoor');
    setModelKey(presetModel.modelKey);
    setUnit('ft');
    setHeight(presetModel.heightFt);
    setWidth(presetModel.widthFt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetModel?.nonce]);

  const model = effectiveModels[modelKey];
  const aioModel = effectiveAioModels[aioModelKey];
  const dimensions = { height, width, unit };

  // Preserve physical size when the unit changes — convert the entered
  // numbers instead of silently reinterpreting them under the new unit.
  function handleUnitChange(newUnit: LedUnit) {
    setHeight(Number(convertLedLength(height, unit, newUnit).toFixed(3)));
    setWidth(Number(convertLedLength(width, unit, newUnit).toFixed(3)));
    setUnit(newUnit);
  }

  // LED walls are built from fixed-size cabinets — a requested mm size
  // almost never divides evenly, so this offers the two nearest achievable
  // whole-cabinet sizes (round every axis down, or round every axis up) for
  // the rep to choose between, rather than silently picking one. Only
  // active in "mm" unit mode; every other unit keeps the pre-existing
  // continuous-area behavior untouched.
  const cabinetInfo = useMemo(() => {
    if (unit !== 'mm' || !width || !height) return null;
    const cabinet = cabinetSizeForPitch(pixelPitch, category);
    const grid = computeCabinetGridOptions(width, height, cabinet);
    return { cabinet, grid };
  }, [unit, width, height, pixelPitch, category]);

  const chosenGrid: CabinetGridOption | null = cabinetInfo ? cabinetInfo.grid[cabinetChoice] : null;

  // Costing (area-based: panel/installation/fabrication) uses the actual
  // achievable cabinet-grid size once one's chosen; controller/resolution
  // selection below deliberately keeps using the raw entered dimensions +
  // the selected model's own pitch — that's an existing, separate subsystem
  // this change doesn't touch.
  const effectiveDimensions = chosenGrid ? { height: chosenGrid.actualHeightMm, width: chosenGrid.actualWidthMm, unit: 'mm' as LedUnit } : dimensions;

  const aspectSuggestion = useMemo(() => {
    const { widthFt, heightFt } = getLedDimensionsFt(dimensions);
    if (!widthFt || !heightFt) return null;
    const currentRatio = widthFt / heightFt;
    let targetLabel: string;
    let targetRatio: number;
    if (aspectMode === 'auto') {
      targetLabel = getNearestAspectPreset(currentRatio);
      targetRatio = LED_ASPECT_PRESETS[targetLabel];
    } else if (aspectPreset === 'custom') {
      targetRatio = parseCustomRatio(aspectCustom) || currentRatio;
      targetLabel = aspectCustom || 'Custom';
    } else {
      targetLabel = aspectPreset;
      targetRatio = LED_ASPECT_PRESETS[targetLabel];
    }
    const suggestedHeightFt = widthFt / targetRatio;
    const suggestedHeight = ftToCurrentUnit(suggestedHeightFt, unit);
    return {
      text: `Current ratio ≈ ${currentRatio.toFixed(2)}:1. For width ${width} ${unit}, ${targetLabel} suggests a height of ≈ ${suggestedHeight.toFixed(2)} ${unit}.`,
      suggestedHeight
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, width, unit, aspectMode, aspectPreset, aspectCustom]);

  const selection = useMemo(() => {
    if (!model) return null;
    const spec = computeLedPixelSpec({ dimensions, category, modelPitch: model.pitch, controlMode });
    return getLedControllerSelection(spec, redundancy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, height, width, unit, category, controlMode, redundancy]);

  const result = useMemo<DomainResult | null>(() => {
    if (ledMode === 'aio') {
      if (!aioModel || !aioModelKey) return null;
      const qty = Math.max(1, Math.round(aioQty) || 1);
      const amount = aioModel.price * qty;
      const lineItems: LineItem[] = [
        { description: `${aioModelKey} — ${aioModel.resolutionClass} All-In-One LED Display`, qty, rate: aioModel.price, amount, unit: 'Nos' }
      ];
      const summary = [
        { label: 'Series', value: 'AIO (All-In-One)' },
        { label: 'Size', value: `${aioModel.diagonalInches}"` },
        { label: 'Resolution', value: aioModel.resolutionClass },
        { label: 'Unit price', value: formatMoney(aioModel.price) },
        { label: 'Quantity', value: String(qty) }
      ];
      return { label: `Active LED — AIO ${aioModelKey}`, domainKey: 'av', lineItems, subtotal: amount, summary };
    }

    if (!model || !selection) return null;
    const area = getAreaSqFt(effectiveDimensions);
    const selectedPrice = priceTier === 'b2b' ? model.b2bPricePerSqFt : model.b2cPricePerSqFt;
    const panelCost = area * selectedPrice;
    const controllerCost = selection.totalPrice;
    const installationArea = area * LED_INSTALLATION_RATE_PER_SQFT;
    const fabricationArea = area * model.fabricationPerSqFt;
    const installation = installationArea + costInputs.installationCost;
    const fabrication = fabricationArea + costInputs.fabricationCost;
    const scaffolding = model.scaffoldingFixed + costInputs.scaffoldingCost;
    const subtotal = panelCost + controllerCost + installation + fabrication + scaffolding;

    const lineItems: LineItem[] = [
      { description: `${modelKey} LED Screen — ${area.toFixed(2)} sq ft`, qty: area.toFixed(2), rate: selectedPrice, amount: panelCost, unit: 'Sq Ft' }
    ];
    if (chosenGrid) {
      lineItems.push({
        description: `Cabinets — ${chosenGrid.cols}×${chosenGrid.rows} grid (${chosenGrid.cabinetCount} nos, ${cabinetInfo?.cabinet.width}×${cabinetInfo?.cabinet.height}mm each) — actual size ${chosenGrid.actualWidthMm}×${chosenGrid.actualHeightMm}mm`,
        qty: chosenGrid.cabinetCount,
        rate: 0,
        amount: 0,
        unit: 'Nos'
      });
    }
    if (selection.matched) {
      lineItems.push({ description: `Controller — ${selection.name}`, qty: selection.units, rate: selection.unitPrice, amount: controllerCost, unit: 'Nos' });
    } else {
      lineItems.push({ description: 'Controller — no rule match', qty: 1, rate: 0, amount: 0, unit: 'Nos' });
    }
    lineItems.push({ description: 'Installation', qty: area.toFixed(2), rate: LED_INSTALLATION_RATE_PER_SQFT, amount: installationArea, unit: 'Sq Ft' });
    if (costInputs.installationCost) {
      lineItems.push({ description: 'Additional installation cost', qty: 1, rate: costInputs.installationCost, amount: costInputs.installationCost, unit: 'Nos' });
    }
    lineItems.push({ description: 'Fabrication', qty: area.toFixed(2), rate: model.fabricationPerSqFt, amount: fabricationArea, unit: 'Sq Ft' });
    if (costInputs.fabricationCost) {
      lineItems.push({ description: 'Additional fabrication cost', qty: 1, rate: costInputs.fabricationCost, amount: costInputs.fabricationCost, unit: 'Nos' });
    }
    lineItems.push({ description: 'Scaffolding', qty: 1, rate: model.scaffoldingFixed, amount: model.scaffoldingFixed, unit: 'Set' });
    if (costInputs.scaffoldingCost) {
      lineItems.push({ description: 'Additional scaffolding cost', qty: 1, rate: costInputs.scaffoldingCost, amount: costInputs.scaffoldingCost, unit: 'Nos' });
    }

    const summary = [
      { label: 'LED model', value: modelKey },
      { label: 'Price tier', value: priceTier === 'b2b' ? 'B2B (Partner price)' : 'B2C (End-user price)' },
      ...(chosenGrid ? [{ label: 'Cabinet grid', value: `${chosenGrid.cols}×${chosenGrid.rows} (${chosenGrid.cabinetCount} cabinets, ${cabinetInfo?.cabinet.width}×${cabinetInfo?.cabinet.height}mm each)` }] : []),
      { label: 'Area (sq ft)', value: area.toFixed(2) },
      { label: 'Panel price', value: formatMoney(selectedPrice) },
      { label: 'LED panel cost', value: formatMoney(panelCost) },
      { label: 'Resolution', value: `${selection.spec.horizontalPixels} x ${selection.spec.verticalPixels} px` },
      { label: 'Control mode', value: selection.spec.controlMode },
      { label: 'Controller', value: selection.matched ? `${selection.name} x${selection.units}${selection.redundant ? ' (redundant)' : ''}` : 'No rule match' },
      ...(selection.matched ? [{ label: 'Controller confidence', value: `${selection.confidence}%` }] : []),
      { label: 'Controller cost', value: formatMoney(controllerCost) },
      { label: 'Installation cost', value: formatMoney(installation) },
      { label: 'Fabrication cost', value: formatMoney(fabrication) },
      { label: 'Scaffolding cost', value: formatMoney(scaffolding) }
    ];

    return { label: `Active LED — ${modelKey}`, domainKey: 'av', lineItems, subtotal, summary };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledMode, aioModel, aioModelKey, aioQty, model, selection, modelKey, priceTier, height, width, unit, costInputs, chosenGrid]);

  useEffect(() => {
    if (active && result) onResultChange(result);
  }, [active, result, onResultChange]);

  if (ledMode === 'aio' ? !aioModel : !model || !selection) return null;

  const spec = selection?.spec;
  const area = getAreaSqFt(effectiveDimensions);

  return (
    <section className={`${styles.sectionPanel} ${active ? '' : styles.hidden}`}>
      <h2 className={styles.h2}>Active LED Estimator</h2>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ledMode">Series</label>
          <select id="ledMode" className={styles.formControl} value={ledMode} onChange={(e) => setLedMode(e.target.value as 'cabinet' | 'aio')}>
            <option value="cabinet">LED Wall (Cabinet Build)</option>
            <option value="aio">AIO Series (All-In-One)</option>
          </select>
        </div>
      </div>

      {ledMode === 'aio' && aioModel ? (
        <>
          <div className={`${styles.row} ${styles.columns}`}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="aioModel">AIO size</label>
              <select id="aioModel" className={styles.formControl} value={aioModelKey} onChange={(e) => setAioModelKey(e.target.value)}>
                {aioModelKeys.map((key) => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="aioQty">Quantity</label>
              <input id="aioQty" className={styles.formControl} type="number" step="1" min={1} value={aioQty} onFocus={selectAllOnFocus} onChange={(e) => setAioQty(Math.max(1, parseInt(e.target.value, 10) || 1))} />
            </div>
          </div>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="aioDetails">Model details</label>
              <textarea id="aioDetails" className={styles.formControl} rows={4} readOnly value={`${aioModel.details}\nSize: ${aioModel.diagonalInches}"\nResolution: ${aioModel.resolutionClass}\nUnit price: ${formatMoney(aioModel.price)}`} />
            </div>
          </div>
        </>
      ) : model && selection && spec ? (
        <>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ledHeight">Height</label>
          <input id="ledHeight" className={styles.formControl} type="number" step="any" min={0} value={height} onFocus={selectAllOnFocus} onChange={(e) => setHeight(parseFloat(e.target.value) || 0)} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ledWidth">Width</label>
          <input id="ledWidth" className={styles.formControl} type="number" step="any" min={0} value={width} onFocus={selectAllOnFocus} onChange={(e) => setWidth(parseFloat(e.target.value) || 0)} />
        </div>
      </div>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ledAspectMode">Aspect ratio</label>
          <select id="ledAspectMode" className={styles.formControl} value={aspectMode} onChange={(e) => setAspectMode(e.target.value as 'auto' | 'custom')}>
            <option value="auto">Auto (detect from height/width)</option>
            <option value="custom">Custom (pick or enter a ratio)</option>
          </select>
        </div>
        {aspectMode === 'custom' && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ledAspectPreset">Target ratio</label>
            <select id="ledAspectPreset" className={styles.formControl} value={aspectPreset} onChange={(e) => setAspectPreset(e.target.value)}>
              <option value="16:9">16:9 (Widescreen)</option>
              <option value="4:3">4:3 (Standard)</option>
              <option value="21:9">21:9 (Cinematic)</option>
              <option value="1:1">1:1 (Square)</option>
              <option value="3:2">3:2</option>
              <option value="custom">Custom W:H…</option>
            </select>
          </div>
        )}
      </div>
      {aspectMode === 'custom' && aspectPreset === 'custom' && (
        <div className={`${styles.row} ${styles.columns}`}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ledAspectCustom">Custom ratio (W:H)</label>
            <input id="ledAspectCustom" className={styles.formControl} type="text" placeholder="e.g. 32:9" value={aspectCustom} onChange={(e) => setAspectCustom(e.target.value)} />
          </div>
        </div>
      )}
      <div className={styles.row}>
        <div className={styles.field}>
          <div className={styles.small}>{aspectSuggestion ? aspectSuggestion.text : 'Enter height and width to see an aspect ratio suggestion.'}</div>
          <button
            type="button"
            className={`${styles.secondaryButton} ${styles.mt8}`}
            onClick={() => {
              if (aspectSuggestion) setHeight(Number(aspectSuggestion.suggestedHeight.toFixed(2)));
            }}
          >
            Apply suggested height
          </button>
        </div>
      </div>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ledUnit">Dimension unit</label>
          <select id="ledUnit" className={styles.formControl} value={unit} onChange={(e) => handleUnitChange(e.target.value as LedUnit)}>
            <option value="ft">Feet</option>
            <option value="m">Meters</option>
            <option value="in">Inches</option>
            <option value="mm">Millimeters (cabinet sizing)</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ledCategory">Environment</label>
          <select id="ledCategory" className={styles.formControl} value={category} onChange={(e) => setCategory(e.target.value as 'indoor' | 'outdoor')}>
            <option value="indoor">Indoor</option>
            <option value="outdoor">Outdoor</option>
          </select>
        </div>
      </div>
      {unit === 'mm' && (
        <>
          <div className={`${styles.row} ${styles.columns}`}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="ledPixelPitch">Pixel pitch (mm)</label>
              <select id="ledPixelPitch" className={styles.formControl} value={pixelPitch} onChange={(e) => setPixelPitch(parseFloat(e.target.value))}>
                {pitchesForCategory(category).map((p) => (
                  <option key={p} value={p}>{p} mm</option>
                ))}
              </select>
            </div>
            {cabinetInfo && (
              <div className={styles.field}>
                <div className={styles.small}>Cabinet size for this pitch: {cabinetInfo.cabinet.width}×{cabinetInfo.cabinet.height}mm</div>
              </div>
            )}
          </div>
          {cabinetInfo && chosenGrid && (
            <div className={`${styles.row} ${styles.columns}`}>
              {(['down', 'up'] as const).map((dir) => {
                const opt = cabinetInfo.grid[dir];
                return (
                  <label
                    key={dir}
                    className={styles.field}
                    style={{ border: cabinetChoice === dir ? '2px solid var(--mx-brand)' : '1px solid var(--mx-border)', borderRadius: 8, padding: 10, cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                      <input type="radio" name="cabinetChoice" checked={cabinetChoice === dir} onChange={() => setCabinetChoice(dir)} />
                      {dir === 'down' ? 'Round down (nearest smaller)' : 'Round up (nearest larger)'}
                    </div>
                    <div className={styles.small}>
                      {opt.cols}×{opt.rows} cabinets ({opt.cabinetCount} nos) — actual size {opt.actualWidthMm}×{opt.actualHeightMm}mm
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ledModel">LED model</label>
          <select id="ledModel" className={styles.formControl} value={modelKey} onChange={(e) => setModelKey(e.target.value)}>
            {modelKeys
              .filter((key) => (category === 'indoor' ? ['indoor', 'cob'] : [category]).includes(effectiveModels[key]?.category))
              .map((key) => (
                <option key={key} value={key}>{key}</option>
              ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ledPriceTier">Price tier</label>
          <select id="ledPriceTier" className={styles.formControl} value={priceTier} onChange={(e) => setPriceTier(e.target.value as 'b2b' | 'b2c')}>
            <option value="b2b">B2B (Partner price)</option>
            <option value="b2c">B2C (End-user price)</option>
          </select>
        </div>
      </div>
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ledControlMode">Controller mode</label>
          <select id="ledControlMode" className={styles.formControl} value={controlMode} onChange={(e) => setControlMode(e.target.value)}>
            <option value="Synchronous">Synchronous (video wall, fixed live source)</option>
            <option value="Asynchronous">Asynchronous (PC-free, cloud/standalone signage)</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ledRedundancy">Redundancy</label>
          <select id="ledRedundancy" className={styles.formControl} value={redundancy} onChange={(e) => setRedundancy(e.target.value as LedRedundancyMode)}>
            <option value="auto">Auto (per engineering rules)</option>
            <option value="yes">Force redundant (dual controller)</option>
            <option value="no">No redundancy</option>
          </select>
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ledDetails">Model details</label>
          <textarea
            id="ledDetails"
            className={styles.formControl}
            rows={4}
            readOnly
            value={`${model.details}\nSize: ${area.toFixed(1)} sq ft\nTier: ${priceTier === 'b2b' ? 'B2B (Partner price)' : 'B2C (End-user price)'}\nController: ${selection.matched ? selection.name : 'Unmatched — see controller panel'}\nSpecs: ${model.pitch} pitch, ${model.category.toUpperCase()} LED`}
          />
          <div className={styles.small}>LED controller pricing loads from the AV/led-controller-data dataset.</div>
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ledControllerDetails">Controller selection (auto-computed)</label>
          <textarea
            id="ledControllerDetails"
            className={styles.formControl}
            rows={8}
            readOnly
            value={
              !selection.matched
                ? `Resolution: ${spec.horizontalPixels} x ${spec.verticalPixels} px (${(spec.totalPixels / 1e6).toFixed(2)} MP)\nPixel pitch: ${spec.pitchMm} mm (band ${spec.pitchBand}) | Install: ${spec.installationType} | Mode: ${spec.controlMode}\n\n${selection.reason}`
                : [
                    `Recommended controller: ${selection.name}${selection.specSheet?.series ? ' (' + selection.specSheet.series + ')' : ''}`,
                    `Units required: ${selection.units}${selection.redundant ? ` (includes redundancy x2 — ${selection.redundancyReason})` : ''}`,
                    `Selection confidence: ${selection.confidence}%`,
                    `Unit price: ${formatMoney(selection.unitPrice)}${selection.units > 1 ? ` × ${selection.units} = ${formatMoney(selection.totalPrice)}` : ''}`,
                    '',
                    `Display resolution: ${spec.horizontalPixels} x ${spec.verticalPixels} px (${(spec.totalPixels / 1e6).toFixed(2)} MP)`,
                    `Pixel pitch: ${spec.pitchMm} mm (band ${spec.pitchBand}) | Install: ${spec.installationType} | Mode: ${spec.controlMode}`,
                    ...(selection.specSheet
                      ? [
                          `Controller capacity: ${selection.specSheet.maxPixels.toLocaleString('en-IN')} px | ${selection.specSheet.ethPorts}x 1G Ethernet, ${selection.specSheet.fiberPorts}x fiber`,
                          ...(selection.specSheet.type ? [`Type: ${selection.specSheet.type}`] : []),
                          ...(selection.specSheet.recommendedSize ? [`Recommended for: ${selection.specSheet.recommendedSize}`] : []),
                          ...(selection.specSheet.inputInterfaces ? [`I/O: ${selection.specSheet.inputInterfaces}`] : []),
                          ...(selection.specSheet.notes ? [`Notes: ${selection.specSheet.notes}`] : []),
                          ...(selection.specSheet.productUrl ? [`Product: ${selection.specSheet.productUrl}`] : [])
                        ]
                      : []),
                    '',
                    selection.reason
                  ].join('\n')
            }
          />
        </div>
      </div>
        </>
      ) : null}
    </section>
  );
}
