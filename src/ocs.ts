// Open Climate Service STAC client: list a catalog's collections and turn a
// collection document into everything zarr-layer (rasters) or GeoLibre's PMTiles
// rendering (feature collections) needs to draw it. Mirrors the logic in the OCS
// `/map` viewer so behaviour stays consistent across clients.

// STAC/JSON documents are dynamic; type them loosely at the boundary.
type StacJson = Record<string, any>;

export type CollectionKind = "raster" | "vector";

export interface OcsCollectionSummary {
  id: string;
  title: string;
  href: string;
  /** Raster (GeoZarr) dataset or vector feature collection (GeoParquet + PMTiles). */
  kind: CollectionKind;
}

/** Flat vector paint, in the shape of GeoLibre's per-layer style. */
export interface VectorStyle {
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeWidth: number;
}

/** Everything needed to draw an OCS feature collection from its PMTiles archive. */
export interface VectorSpec {
  id: string;
  title: string;
  pmtilesHref: string;
  sourceLayers: string[];
  style: VectorStyle;
  bbox: [number, number, number, number] | null;
  featureCount: number | null;
  attribution: string | null;
}

export type DimControl = "slider" | "dropdown";

export interface DimState {
  key: string;
  label: string;
  control: DimControl;
  steps: Array<string | number>;
  count: number;
  index: number;
  /** True for a real date axis — driven by GeoLibre's native Time Slider, not our panel. */
  isTemporal: boolean;
}

export interface RenderSpec {
  datasetId: string;
  zarrHref: string;
  variable: string;
  clim: [number, number];
  colormapName: string;
  fillValue: number | null;
  crs: string;
  proj4: string | null;
  bounds: [number, number, number, number] | null;
  zarrVersion: number | null;
  units: string;
  source: string | null;
  temporalResolution: string | null;
  dims: DimState[];
}

/** The instance's configured spatial extent (`<ocsUrl>/extent`). */
export interface InstanceExtent {
  name: string | null;
  bbox: [number, number, number, number];
}

const MAX_STEPS = 20000;

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/** CRS84 aliases (CRS84, OGC:CRS84, CRS:84, CRS84 URIs) are geographic WGS84. zarr-layer
 * only resolves EPSG:4326/EPSG:3857 by code, so normalize the alias to EPSG:4326. */
export function normalizeCrs(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "").endsWith("CRS84") ? "EPSG:4326" : code;
}

interface Duration {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function parseDuration(iso: string): Duration | null {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
    iso
  );
  if (!m) return null;
  const n = (v: string | undefined): number => (v ? Number(v) : 0);
  const d: Duration = {
    years: n(m[1]),
    months: n(m[2]),
    weeks: n(m[3]),
    days: n(m[4]),
    hours: n(m[5]),
    minutes: n(m[6]),
    seconds: n(m[7]),
  };
  if (Object.values(d).every((x) => x === 0)) return null;
  return d;
}

function advance(date: Date, d: Duration): Date {
  const dt = new Date(date.getTime());
  if (d.years) dt.setUTCFullYear(dt.getUTCFullYear() + d.years);
  if (d.months) dt.setUTCMonth(dt.getUTCMonth() + d.months);
  if (d.weeks || d.days) dt.setUTCDate(dt.getUTCDate() + d.weeks * 7 + d.days);
  if (d.hours) dt.setUTCHours(dt.getUTCHours() + d.hours);
  if (d.minutes) dt.setUTCMinutes(dt.getUTCMinutes() + d.minutes);
  if (d.seconds) dt.setUTCSeconds(dt.getUTCSeconds() + d.seconds);
  return dt;
}

/** Expand a temporal extent [start, end] by an ISO-8601 step into labelled dates. */
export function iterateTemporal(startISO: string, endISO: string, stepISO: string): string[] {
  const dur = parseDuration(stepISO);
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (!dur || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const subDaily = dur.hours > 0 || dur.minutes > 0 || dur.seconds > 0;
  const out: string[] = [];
  let cur = start;
  while (cur.getTime() <= end.getTime() && out.length < MAX_STEPS) {
    out.push(subDaily ? cur.toISOString().slice(0, 16).replace("T", " ") : cur.toISOString().slice(0, 10));
    const next = advance(cur, dur);
    if (next.getTime() <= cur.getTime()) break;
    cur = next;
  }
  return out;
}

/** Non-spatial dimensions the user steps through (skip the synthetic `bands` axis). */
function steppingDimKeys(dimensions: StacJson): string[] {
  return Object.entries(dimensions)
    .filter(([, v]) => {
      const dim = v as StacJson;
      return dim.type !== "spatial" && dim.type !== "bands" && (Array.isArray(dim.values) || dim.extent);
    })
    .map(([key]) => key);
}

function controlForDim(dim: StacJson): DimControl {
  const hint = dim["open_climate_service:control"];
  if (hint === "slider" || hint === "dropdown") return hint;
  if (dim.type === "temporal" || typeof dim.step === "number") return "slider";
  return "dropdown";
}

function dimLabel(key: string, dim: StacJson): string {
  if (dim.type === "temporal") return "Time step";
  if (key === "dayofyear") return "Day of year";
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
}

function buildSteps(dim: StacJson): Array<string | number> {
  if (Array.isArray(dim.values)) return dim.values;
  const ext = dim.extent;
  if (Array.isArray(ext) && ext.length === 2 && dim.step != null) {
    return iterateTemporal(String(ext[0]), String(ext[1]), String(dim.step));
  }
  return [];
}

const _ISO_STEP_LABELS: Record<string, string> = {
  PT1H: "Hourly",
  P1D: "Daily",
  P7D: "Weekly",
  P1M: "Monthly",
  P3M: "Seasonal",
  P1Y: "Yearly",
};

/** Human label for a dataset's temporal resolution, from its temporal dimension's ISO step. */
function temporalResolutionLabel(dimensions: StacJson): string | null {
  for (const v of Object.values(dimensions)) {
    const dim = v as StacJson;
    if (dim.type === "temporal" && typeof dim.step === "string" && dim.step) {
      return _ISO_STEP_LABELS[dim.step] ?? dim.step;
    }
  }
  return null;
}

/** Fetch the instance's configured extent from `<ocsUrl>/extent`; null if unavailable. */
export async function fetchInstanceExtent(ocsUrl: string): Promise<InstanceExtent | null> {
  try {
    const res = await fetch(`${stripTrailingSlashes(ocsUrl)}/extent`);
    if (!res.ok) return null;
    const data = (await res.json()) as StacJson;
    const bbox = data.bbox;
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((n) => typeof n === "number")) return null;
    const name = typeof data.name === "string" && data.name ? data.name : null;
    return { name, bbox: [bbox[0], bbox[1], bbox[2], bbox[3]] };
  } catch {
    return null;
  }
}

/** Ids of the instance's feature collections, from `<ocsUrl>/features`. Empty when the
 * instance predates feature collections or the request fails. */
export async function fetchFeatureCollectionIds(ocsUrl: string): Promise<Set<string>> {
  try {
    const res = await fetch(`${stripTrailingSlashes(ocsUrl)}/features`);
    if (!res.ok) return new Set();
    const data = (await res.json()) as StacJson;
    const items: StacJson[] = Array.isArray(data.items) ? data.items : [];
    return new Set(items.map((i) => i.id).filter((id): id is string => typeof id === "string" && id.length > 0));
  } catch {
    return new Set();
  }
}

/** Fetch a catalog's published collections from `<ocsUrl>/stac`. The STAC catalog lists
 * rasters and feature collections alike as `child` links; `/features` says which are
 * vector, so the panel can offer them separately without fetching every collection. */
export async function fetchCatalog(ocsUrl: string): Promise<OcsCollectionSummary[]> {
  const base = stripTrailingSlashes(ocsUrl);
  const [res, featureIds] = await Promise.all([fetch(`${base}/stac`), fetchFeatureCollectionIds(base)]);
  if (!res.ok) throw new Error(`STAC catalog fetch failed (HTTP ${res.status})`);
  const cat = (await res.json()) as StacJson;
  const links: StacJson[] = Array.isArray(cat.links) ? cat.links : [];
  return links
    .filter((l) => l.rel === "child")
    .map((l): OcsCollectionSummary => {
      const id = stripTrailingSlashes(String(l.href)).split("/").pop() ?? "";
      return {
        id,
        title: typeof l.title === "string" && l.title ? l.title : id,
        href: String(l.href),
        kind: featureIds.has(id) ? "vector" : "raster",
      };
    })
    .filter((c) => c.id.length > 0);
}

/** A feature collection has no Zarr asset and declares the STAC table extension or a
 * PMTiles/style asset; a raster has a `zarr` asset. */
export function isVectorCollection(collection: StacJson): boolean {
  const assets: StacJson = collection.assets ?? {};
  if (assets.zarr) return false;
  return Boolean(assets.tiles || assets.style || collection["table:row_count"] != null);
}

const DEFAULT_VECTOR_STYLE: VectorStyle = {
  fillColor: "#0066cc",
  fillOpacity: 0.15,
  strokeColor: "#1e3a5f",
  strokeWidth: 1,
};

/** Read flat fill/line paint from an OCS MapLibre style document. Only literal values are
 * taken; data-driven expressions fall back to the default, since GeoLibre's per-layer
 * style is flat. */
export function vectorStyleFromMapLibre(style: StacJson | null): VectorStyle {
  const out: VectorStyle = { ...DEFAULT_VECTOR_STYLE };
  const layers: StacJson[] = Array.isArray(style?.layers) ? style.layers : [];
  const fill: StacJson = layers.find((l) => l.type === "fill")?.paint ?? {};
  const line: StacJson = layers.find((l) => l.type === "line")?.paint ?? {};
  if (typeof fill["fill-color"] === "string") out.fillColor = fill["fill-color"];
  if (typeof fill["fill-opacity"] === "number") out.fillOpacity = fill["fill-opacity"];
  if (typeof line["line-color"] === "string") out.strokeColor = line["line-color"];
  if (typeof line["line-width"] === "number") out.strokeWidth = line["line-width"];
  return out;
}

/** Fetch a feature collection's default MapLibre style; null if it has none or it fails. */
export async function fetchVectorStyle(collection: StacJson): Promise<StacJson | null> {
  const href = collection.assets?.style?.href;
  if (typeof href !== "string" || !href) return null;
  try {
    const res = await fetch(href);
    return res.ok ? ((await res.json()) as StacJson) : null;
  } catch {
    return null;
  }
}

/** Turn a feature collection's STAC document (and its style, if fetched) into a spec for
 * GeoLibre's native PMTiles rendering. */
export function buildVectorSpec(collection: StacJson, style: StacJson | null = null): VectorSpec {
  const links: StacJson[] = Array.isArray(collection.links) ? collection.links : [];
  const pmtilesLink = links.find((l) => l.rel === "pmtiles" && typeof l.href === "string");
  const pmtilesHref: unknown = collection.assets?.tiles?.href ?? pmtilesLink?.href;
  if (typeof pmtilesHref !== "string" || !pmtilesHref) {
    throw new Error("No PMTiles asset found in this feature collection");
  }
  // web-map-links names the archive's layers; OCS writes every collection to one
  // source layer called "features".
  const declared = pmtilesLink?.["pmtiles:layers"];
  const sourceLayers: string[] =
    Array.isArray(declared) && declared.length > 0 && declared.every((s) => typeof s === "string")
      ? declared
      : ["features"];
  const rawBbox = collection.extent?.spatial?.bbox?.[0];
  const bbox: [number, number, number, number] | null =
    Array.isArray(rawBbox) && rawBbox.length === 4 && rawBbox.every((n) => typeof n === "number")
      ? [rawBbox[0], rawBbox[1], rawBbox[2], rawBbox[3]]
      : null;
  const featureCount = typeof collection["table:row_count"] === "number" ? collection["table:row_count"] : null;
  const sources: StacJson[] = Object.values((style?.sources ?? {}) as StacJson);
  const attribution = sources.find((s) => typeof s?.attribution === "string")?.attribution ?? null;
  return {
    id: String(collection.id),
    title: typeof collection.title === "string" && collection.title ? collection.title : String(collection.id),
    pmtilesHref,
    sourceLayers,
    style: vectorStyleFromMapLibre(style),
    bbox,
    featureCount,
    attribution,
  };
}

/** Fetch a single collection document from `<ocsUrl>/stac/collections/<id>`. */
export async function fetchCollection(ocsUrl: string, datasetId: string): Promise<StacJson> {
  const base = stripTrailingSlashes(ocsUrl);
  const res = await fetch(`${base}/stac/collections/${encodeURIComponent(datasetId)}`);
  if (!res.ok) throw new Error(`Collection '${datasetId}' fetch failed (HTTP ${res.status})`);
  return (await res.json()) as StacJson;
}

/** Turn a STAC collection into a render spec for zarr-layer. */
export function buildRenderSpec(collection: StacJson): RenderSpec {
  const renders: StacJson = collection.renders?.default ?? {};
  const zarr: StacJson | undefined = collection.assets?.zarr;
  if (!zarr?.href) throw new Error("No Zarr asset found in this collection");

  const clim: [number, number] = Array.isArray(renders.rescale?.[0])
    ? (renders.rescale[0] as [number, number])
    : [0, 100];
  const colormapName: string = renders.colormap_name ?? "viridis";
  const fillValue: number | null = renders.nodata ?? null;
  const variable: string =
    renders["open_climate_service:variable"] ?? Object.keys(collection["cube:variables"] ?? {})[0] ?? "data";

  const dimensions: StacJson = collection["cube:dimensions"] ?? {};
  const dims: DimState[] = steppingDimKeys(dimensions)
    .map((key): DimState => {
      const dim = dimensions[key] as StacJson;
      const steps = buildSteps(dim);
      const control = controlForDim(dim);
      const count = steps.length;
      // Sliders default to the last step (latest time); dropdowns to the first.
      const index = control === "slider" ? Math.max(0, count - 1) : 0;
      return { key, label: dimLabel(key, dim), control, steps, count, index, isTemporal: dim.type === "temporal" };
    })
    .filter((d) => d.count >= 1);

  const crs = normalizeCrs(collection["proj:code"] ?? "EPSG:4326");
  const proj4: string | null = collection["open_climate_service:proj4"] ?? null;
  // proj:bbox is the native-CRS extent; passing it as zarr-layer `bounds` avoids a
  // render-time fetch of the x/y coordinate arrays to derive them.
  const rawBbox = collection["proj:bbox"];
  const bounds: [number, number, number, number] | null =
    Array.isArray(rawBbox) && rawBbox.length === 4 && rawBbox.every((n) => typeof n === "number")
      ? [rawBbox[0], rawBbox[1], rawBbox[2], rawBbox[3]]
      : null;
  const zarrVersion: number | null = zarr["zarr:zarr_format"] ?? null;
  // Units come from the datacube-standard cube:variables[<var>].unit (OCS no longer
  // emits a custom open_climate_service:units render field).
  const units: string = collection["cube:variables"]?.[variable]?.unit ?? "";
  const keywords: string[] = Array.isArray(collection.keywords) ? collection.keywords : [];
  const source =
    keywords.find((k) => k !== "zarr" && k !== "stac" && k !== variable && k !== collection.id) ?? null;
  const temporalResolution = temporalResolutionLabel(dimensions);

  return { datasetId: collection.id, zarrHref: zarr.href, variable, clim, colormapName, fillValue, crs, proj4, bounds, zarrVersion, units, source, temporalResolution, dims };
}
