import { afterEach, describe, expect, it, vi } from "vitest";
import { buildVectorSpec, fetchCatalog, isVectorCollection, vectorStyleFromMapLibre } from "../src/ocs";

const BASE = "https://ocs-demo-nepal.dhis2.org";

// Trimmed from the Nepal demo's /stac/collections/nepal_districts.
const districts = {
  id: "nepal_districts",
  title: "Districts (Overture Maps)",
  "proj:code": "EPSG:4326",
  "table:row_count": 77,
  extent: { spatial: { bbox: [[80.0570812, 26.3477581, 88.2015257, 30.446945]] } },
  assets: {
    data: { href: `${BASE}/features/nepal_districts/data.parquet`, type: "application/vnd.apache.parquet" },
    tiles: { href: `${BASE}/features/nepal_districts/data.pmtiles`, type: "application/vnd.pmtiles" },
    style: { href: `${BASE}/features/nepal_districts/styles/default.json`, type: "application/vnd.mapbox.style+json" },
  },
  links: [
    {
      rel: "pmtiles",
      href: `${BASE}/features/nepal_districts/data.pmtiles`,
      type: "application/vnd.pmtiles",
      "pmtiles:layers": ["features"],
    },
  ],
};

// The default style OCS serves for a polygon collection.
const style = {
  version: 8,
  sources: {
    features: {
      type: "vector",
      url: `pmtiles://${BASE}/features/nepal_districts/data.pmtiles`,
      attribution: "© OpenStreetMap contributors, © Overture Maps Foundation",
    },
  },
  layers: [
    { id: "features-fill", type: "fill", paint: { "fill-color": "#0066cc", "fill-opacity": 0.15 } },
    { id: "features-line", type: "line", paint: { "line-color": "#1e3a5f", "line-width": 1 } },
    { id: "features-point", type: "circle", paint: { "circle-radius": 4 } },
  ],
};

describe("isVectorCollection", () => {
  it("recognises a feature collection by its PMTiles/table metadata", () => {
    expect(isVectorCollection(districts)).toBe(true);
  });
  it("treats anything with a zarr asset as a raster", () => {
    expect(isVectorCollection({ ...districts, assets: { zarr: { href: "x" } } })).toBe(false);
  });
});

describe("vectorStyleFromMapLibre", () => {
  it("reads literal fill and line paint", () => {
    expect(vectorStyleFromMapLibre(style)).toEqual({
      fillColor: "#0066cc",
      fillOpacity: 0.15,
      strokeColor: "#1e3a5f",
      strokeWidth: 1,
    });
  });
  it("falls back to defaults for data-driven paint or no style", () => {
    const driven = { layers: [{ type: "fill", paint: { "fill-color": ["get", "colour"] } }] };
    expect(vectorStyleFromMapLibre(driven).fillColor).toBe("#0066cc");
    expect(vectorStyleFromMapLibre(null).strokeWidth).toBe(1);
  });
});

describe("buildVectorSpec", () => {
  it("takes the PMTiles href, source layers, bbox and attribution", () => {
    const spec = buildVectorSpec(districts, style);
    expect(spec.pmtilesHref).toBe(`${BASE}/features/nepal_districts/data.pmtiles`);
    expect(spec.sourceLayers).toEqual(["features"]);
    expect(spec.bbox).toEqual([80.0570812, 26.3477581, 88.2015257, 30.446945]);
    expect(spec.featureCount).toBe(77);
    expect(spec.title).toBe("Districts (Overture Maps)");
    expect(spec.attribution).toContain("OpenStreetMap");
  });
  it("defaults the source layer to OCS's 'features' when the link does not name it", () => {
    const spec = buildVectorSpec({ ...districts, links: [] });
    expect(spec.sourceLayers).toEqual(["features"]);
    expect(spec.attribution).toBeNull();
  });
  it("throws without a PMTiles asset", () => {
    expect(() => buildVectorSpec({ ...districts, assets: {}, links: [] })).toThrow(/PMTiles/);
  });
});

describe("fetchCatalog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("marks the collections /features lists as vector", async () => {
    const responses: Record<string, unknown> = {
      [`${BASE}/stac`]: {
        links: [
          { rel: "self", href: `${BASE}/stac` },
          { rel: "child", href: `${BASE}/stac/collections/chirps3_precipitation_monthly`, title: "CHIRPS3" },
          { rel: "child", href: `${BASE}/stac/collections/nepal_districts`, title: "Districts" },
        ],
      },
      [`${BASE}/features`]: { kind: "FeatureCollectionList", items: [{ id: "nepal_districts" }] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({ ok: url in responses, status: 200, json: async () => responses[url] })),
    );
    const catalog = await fetchCatalog(`${BASE}/`);
    expect(catalog.map((c) => [c.id, c.kind])).toEqual([
      ["chirps3_precipitation_monthly", "raster"],
      ["nepal_districts", "vector"],
    ]);
  });

  it("lists everything as raster when the instance has no /features route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/stac")
          ? { ok: true, status: 200, json: async () => ({ links: [{ rel: "child", href: `${BASE}/stac/collections/a` }] }) }
          : { ok: false, status: 404, json: async () => ({}) },
      ),
    );
    const catalog = await fetchCatalog(BASE);
    expect(catalog).toEqual([{ id: "a", title: "a", href: `${BASE}/stac/collections/a`, kind: "raster" }]);
  });
});
