# Open Climate Service — GeoLibre plugin

A [GeoLibre](https://geolibre.app/) plugin that browses an **Open Climate Service** (OCS) STAC catalog and renders its published climate datasets and boundary layers — taking the CRS, time axis, variable and style straight from the metadata, so nothing has to be entered by hand.

Learn more about Open Climate Service: **<https://dhis2.github.io/open-climate-service/>**

![The plugin rendering a daily mean temperature anomaly over Norway in GeoLibre](docs/ocs-plugin.png)

## Features

- Point at any OCS instance and browse its published datasets.
- Render a climate dataset (GeoZarr) as a map layer, listed in GeoLibre's Layers panel.
- Overlay the instance's boundary layers (OCS feature collections, such as country,
  provinces and districts) as outlines on top of the climate data, drawn by GeoLibre from
  their PMTiles archives in the line colour OCS publishes. Each boundary layer is a separate
  entry in the Layers panel; the Style panel can add a fill.
- CRS, the time slider, variable, colormap, and value range are all taken from the dataset — projected national grids land in the right place automatically.
- Deep-linkable via `?ocsUrl=…&dataset=…&features=…`, and your selection is saved with the GeoLibre project.

## Install

Requires GeoLibre 2.4 or later: the plugin draws climate datasets with GeoLibre's own Zarr
renderer and binds their time axis to GeoLibre's Time Slider.

Download the latest `open-climate-service-<version>.zip` from the
[**Releases**](https://github.com/dhis2/open-climate-service-geolibre-plugin/releases) page, then in
GeoLibre go to **Settings → Manage Plugins → Install from file** and select the zip.

## Usage

1. Activate **Open Climate Service** from GeoLibre's **Plugins** menu.
2. In the panel, enter your OCS instance URL and click **Connect** — the map frames the
   instance's region. To try the plugin without your own instance, click **Try Nepal demo**,
   which connects to the public demo at <https://ocs-demo-nepal.dhis2.org/>.
3. Pick a dataset to draw it as a layer.
4. Tick one or more layers under **Vector data** to draw them on the map.
5. Step through periods with the **time slider** at the bottom of the map, and adjust the
   **colormap** and **value range** in the panel.

A link that opens GeoLibre with the demo, monthly precipitation anomalies and Nepal's
districts:

```
?ocsUrl=https://ocs-demo-nepal.dhis2.org&dataset=chirps3_precipitation_monthly_anomaly_1991_2020&features=nepal_districts
```

`features` takes a comma-separated list of feature collection ids. Boundary layers need a
recent GeoLibre, whose plugin API can register a PMTiles layer for GeoLibre to draw; the
climate datasets work either way.

## Build from source

```bash
npm install
npm run package:geolibre   # typecheck + build + zip → geolibre-plugin/open-climate-service-<version>.zip
```

Then install the generated zip as above, or point GeoLibre at the unpacked `geolibre-plugin/` directory.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # typecheck + bundle to geolibre-plugin/dist
```

## Releases

Releases are automated, with `package.json` as the single source of truth for the version.
Bump the version in a pull request and merge it to `main`: CI builds the plugin and publishes a
GitHub Release (tag `v<version>`) with the installable zip attached. A merge that doesn't change
the version doesn't create a release, so the same version is never published twice.

## Status

Under active development — see the tracking issue
[dhis2/open-climate-service#301](https://github.com/dhis2/open-climate-service/issues/301).

## License

[BSD-3-Clause](LICENSE).
