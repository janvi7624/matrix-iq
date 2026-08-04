'use client';

import { useEffect, useMemo, useState } from 'react';
import { LED_INSTALLATION_RATE_PER_SQFT, ledModels } from '@/lib/data/ledModels';
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
import { formatMoney } from '@/lib/format';
import { selectAllOnFocus } from '@/lib/numberInputHelpers';
import { CostInputs, DomainResult, LineItem } from '@/lib/types';
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
}

function firstModelForCategory(category: 'indoor' | 'outdoor'): string {
  const categoriesToShow = category === 'indoor' ? ['indoor', 'cob'] : [category];
  return Object.keys(ledModels).find((key) => categoriesToShow.includes(ledModels[key].category)) || '';
}

export default function LedEstimator({ active, costInputs, onResultChange, presetModel }: LedEstimatorProps) {
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

  useEffect(() => {
    const categoriesToShow = category === 'indoor' ? ['indoor', 'cob'] : [category];
    if (!categoriesToShow.includes(ledModels[modelKey]?.category)) {
      setModelKey(firstModelForCategory(category));
    }
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

  const model = ledModels[modelKey];
  const dimensions = { height, width, unit };

  // Preserve physical size when the unit changes — convert the entered
  // numbers instead of silently reinterpreting them under the new unit.
  function handleUnitChange(newUnit: LedUnit) {
    setHeight(Number(convertLedLength(height, unit, newUnit).toFixed(3)));
    setWidth(Number(convertLedLength(width, unit, newUnit).toFixed(3)));
    setUnit(newUnit);
  }

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
    if (!model || !selection) return null;
    const area = getAreaSqFt(dimensions);
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

    return { label: `LED Display — ${modelKey}`, domainKey: 'av', lineItems, subtotal, summary };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, selection, modelKey, priceTier, height, width, unit, costInputs]);

  useEffect(() => {
    if (active && result) onResultChange(result);
  }, [active, result, onResultChange]);

  if (!model || !selection) return null;

  const spec = selection.spec;
  const area = getAreaSqFt(dimensions);

  return (
    <section className={`${styles.sectionPanel} ${active ? '' : styles.hidden}`}>
      <h2 className={styles.h2}>LED Display Estimator</h2>
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
            className={styles.secondaryButton}
            style={{ marginTop: 8 }}
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
      <div className={`${styles.row} ${styles.columns}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ledModel">LED model</label>
          <select id="ledModel" className={styles.formControl} value={modelKey} onChange={(e) => setModelKey(e.target.value)}>
            {Object.keys(ledModels)
              .filter((key) => (category === 'indoor' ? ['indoor', 'cob'] : [category]).includes(ledModels[key].category))
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
    </section>
  );
}
