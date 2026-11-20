import { describe, expect, it } from "vitest";
import { buildRenderSpec, iterateTemporal, normalizeCrs } from "../src/ocs";

describe("normalizeCrs", () => {
  it("collapses CRS84 aliases to EPSG:4326", () => {
    for (const c of ["CRS84", "OGC:CRS84", "CRS:84", "urn:ogc:def:crs:OGC:1.3:CRS84"]) {
      expect(normalizeCrs(c)).toBe("EPSG:4326");
    }
  });
  it("passes projected codes through unchanged", () => {
    expect(normalizeCrs("EPSG:32633")).toBe("EPSG:32633");
    expect(normalizeCrs("EPSG:4326")).toBe("EPSG:4326");
  });
});

describe("iterateTemporal", () => {
  it("expands a daily extent into ISO dates", () => {
    const steps = iterateTemporal("2026-01-01", "2026-01-04", "P1D");
    expect(steps).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  });
  it("expands a monthly extent", () => {
    const steps = iterateTemporal("2026-01-01", "2026-03-01", "P1M");
    expect(steps).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });
  it("returns empty for an unparseable step", () => {
    expect(iterateTemporal("2026-01-01", "2026-02-01", "nope")).toEqual([]);
  });
});

describe("buildRenderSpec", () => {
  const collection = {
    id: "era5land_temperature_daily",
    keywords: ["stac", "zarr", "ERA5-Land", "t2m"],
    assets: { zarr: { href: "http://host/zarr/era5land_temperature_daily/", "zarr:zarr_format": 3 } },
    "proj:code": "EPSG:4326",
    renders: {
      default: {
        rescale: [[-30, 40]],
        colormap_name: "RdBu_r",
        "ogs:variable": "t2m",
      },
    },
    // t2m is not first, so the variable must come from ogs:variable, not the fallback.
    "cube:variables": { d2m: { unit: "K" }, t2m: { unit: "degC" } },
    "cube:dimensions": {
      x: { type: "spatial", axis: "x" },
      y: { type: "spatial", axis: "y" },
      t: { type: "temporal", extent: ["2026-01-01", "2026-01-05"], step: "P1D" },
      // A non-temporal dimension defaults to a dropdown, so a slider here must come from ogs:control.
      member: { type: "other", values: ["a", "b", "c"], "ogs:control": "slider" },
    },
  };

  it("derives variable, clim, crs, units and the dimension controls", () => {
    const spec = buildRenderSpec(collection);
    expect(spec.variable).toBe("t2m");
    expect(spec.clim).toEqual([-30, 40]);
    expect(spec.crs).toBe("EPSG:4326");
    expect(spec.units).toBe("degC");
    expect(spec.zarrVersion).toBe(3);
    expect(spec.source).toBe("ERA5-Land");
    const t = spec.dims.find((d) => d.key === "t");
    expect(t?.control).toBe("slider");
    expect(t?.count).toBe(5);
    expect(t?.index).toBe(4); // slider defaults to the latest step
    expect(spec.dims.find((d) => d.key === "member")?.control).toBe("slider");
  });

  it("passes a projected store's proj:code through as its CRS", () => {
    const spec = buildRenderSpec({ ...collection, "proj:code": "EPSG:32633" });
    expect(spec.crs).toBe("EPSG:32633");
  });

  it("throws when the collection has no zarr asset", () => {
    const noAsset = { ...collection, assets: {} };
    expect(() => buildRenderSpec(noAsset)).toThrow(/Zarr asset/);
  });
});
