// Rendered as a child of resium's <Viewer>, so `useCesium()` here resolves
// to the real Cesium.Viewer instance from context — the idiomatic resium way
// to reach imperative Cesium/copcesium APIs, in contrast to the ref-based
// escape hatch shown in examples/react-viewer.
import { useEffect, useRef, useState } from 'react';
import { useCesium } from 'resium';
import type { ColorMode } from 'copcesium';
import { CLASSES, SAMPLE_DATASETS } from './datasets';
import { useCopcDataSource } from './useCopcDataSource';

export default function ViewerContent() {
  const { viewer } = useCesium();
  const { dataSourceRef, load, status, error, loading, stats } = useCopcDataSource(viewer);

  const [datasetIndex, setDatasetIndex] = useState(0);
  const [url, setUrl] = useState(SAMPLE_DATASETS[0].url);
  const [pixelSize, setPixelSize] = useState(2);
  const [sseThreshold, setSseThreshold] = useState(250);
  const [colorMode, setColorMode] = useState<ColorMode>('rgb');
  const [checkedClasses, setCheckedClasses] = useState<Set<number>>(
    () => new Set(CLASSES.map(([code]) => code)),
  );

  const initialLoadTriggered = useRef(false);
  useEffect(() => {
    if (!viewer || initialLoadTriggered.current) return;
    initialLoadTriggered.current = true;
    const dataset = SAMPLE_DATASETS[0];
    void load(dataset.url, {
      ...dataset.options,
      pixelSize,
      sseThreshold,
      colorMode,
    });
    // Only the initial load reads the current slider/select state; every
    // later load or live edit goes through the handlers below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, load]);

  function readClassFilter(classes: Set<number>): number[] | undefined {
    // All boxes ticked means "no filter" rather than "these nine codes" — a
    // file may carry codes this panel doesn't list, and they shouldn't
    // vanish just because nothing was unticked.
    return classes.size === CLASSES.length ? undefined : [...classes];
  }

  function handleDatasetChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const index = Number(e.target.value);
    const dataset = SAMPLE_DATASETS[index];
    setDatasetIndex(index);
    setUrl(dataset.url);
    void load(dataset.url, {
      ...dataset.options,
      pixelSize,
      sseThreshold,
      colorMode,
      classificationFilter: readClassFilter(checkedClasses),
    });
  }

  function handleLoadClick() {
    void load(url.trim(), {
      pixelSize,
      sseThreshold,
      colorMode,
      classificationFilter: readClassFilter(checkedClasses),
    });
  }

  function handlePixelSizeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = Number(e.target.value);
    setPixelSize(value);
    if (dataSourceRef.current) dataSourceRef.current.pixelSize = value;
  }

  function handleSseThresholdChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = Number(e.target.value);
    setSseThreshold(value);
    if (dataSourceRef.current) dataSourceRef.current.sseThreshold = value;
  }

  function handleColorModeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value as ColorMode;
    setColorMode(value);
    if (dataSourceRef.current) dataSourceRef.current.colorMode = value;
  }

  function handleClassToggle(code: number) {
    setCheckedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      if (dataSourceRef.current) dataSourceRef.current.classificationFilter = readClassFilter(next);
      return next;
    });
  }

  function handleHomeClick() {
    void dataSourceRef.current?.zoomTo();
  }

  return (
    <aside className="sidebar">
      <header className="sidebarHeader">
        <h1>copcesium</h1>
        <span>react-resium-viewer</span>
      </header>

      <section className="panelSection">
        <h2>Data</h2>
        <label className="field">
          sample data
          <select value={datasetIndex} onChange={handleDatasetChange}>
            {SAMPLE_DATASETS.map((dataset, i) => (
              <option key={dataset.url} value={i}>
                {dataset.label}
              </option>
            ))}
          </select>
        </label>
        <input
          className="urlInput"
          type="text"
          placeholder="COPC URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <div className="buttonRow">
          <button disabled={loading} onClick={handleLoadClick}>
            Load
          </button>
          <button disabled={loading || !dataSourceRef.current} onClick={handleHomeClick}>
            Zoom to
          </button>
        </div>
      </section>

      <section className="panelSection">
        <h2>Appearance</h2>
        <label className="field">
          pixelSize <span className="fieldValue">{pixelSize}</span>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={pixelSize}
            onChange={handlePixelSizeChange}
          />
        </label>
        <label className="field">
          sseThreshold <span className="fieldValue">{sseThreshold}</span>
          <input
            type="range"
            min={50}
            max={1000}
            step={10}
            value={sseThreshold}
            onChange={handleSseThresholdChange}
          />
        </label>
        <label className="field">
          colorMode
          <select value={colorMode} onChange={handleColorModeChange}>
            <option value="rgb">rgb</option>
            <option value="intensity">intensity</option>
            <option value="classification">classification</option>
            <option value="elevation">elevation</option>
          </select>
        </label>
      </section>

      <section className="panelSection">
        <h2>Filter</h2>
        <div className="classChecks">
          {CLASSES.map(([code, name]) => (
            <label key={code}>
              <input
                type="checkbox"
                checked={checkedClasses.has(code)}
                onChange={() => handleClassToggle(code)}
              />
              {code} {name}
            </label>
          ))}
        </div>
      </section>

      <section className="panelSection">
        <h2>Info</h2>
        <dl className="stats">
          <dt>status</dt>
          <dd>{status || '—'}</dd>
          <dt>maxDepth</dt>
          <dd>{stats?.maxDepth ?? '—'}</dd>
          <dt>nodeCount</dt>
          <dd>{stats?.nodeCount ?? '—'}</dd>
          <dt>cacheSize</dt>
          <dd>{stats?.cacheSize ?? '—'}</dd>
        </dl>
        {error && <div className="error">{error}</div>}
      </section>
    </aside>
  );
}
