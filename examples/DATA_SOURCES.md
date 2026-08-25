# Sample Data Sources and Credits

All four examples in this directory — `basic-viewer`, `advanced-viewer`, `react-viewer`, and `react-resium-viewer` — draw from the same list of ten public COPC (Cloud Optimized Point Cloud) sample datasets (identical URLs and labels; only the surrounding application code differs).

This document credits the origin of each dataset to the extent it could be determined, and records the verification method used. Where the original capturing organization could not be confirmed, that is stated explicitly rather than left ambiguous.

## Datasets

| Dataset | URL | Source |
|---|---|---|
| Autzen Stadium | https://s3.amazonaws.com/hobu-lidar/autzen-classified.copc.laz | [PDAL/data — autzen/README.md](https://github.com/PDAL/data/tree/main/autzen) (CC-BY-4.0). Captured by Watershed Sciences, Inc. (Aaron Reyna), 2010, Eugene, OR; reclassified in 2021 by Hobu, Inc. Header CRS (Oregon Lambert, EPSG:2992) matches this location. |
| Red Rocks (Large) | https://s3.amazonaws.com/hobu-lidar/redrocks.large.copc.laz | Location confirmed; original capturing organization not stated. The COPC center coordinate resolves to 39.6653°N, 105.2050°W — [Red Rocks Amphitheatre, Morrison, CO](https://en.wikipedia.org/wiki/Red_Rocks_Amphitheatre). Converted to COPC by Hobu, Inc. (`las2copc`) in February 2025. |
| Kate | https://s3.amazonaws.com/hobu-lidar/kate.copc.laz | Original capturing organization unconfirmed. The COPC center coordinate resolves to roughly 44.98°N, 71.95°W, near the Vermont/Québec border. Converted to COPC with PDAL 2.6.2 in December 2023. |
| Niagara Region | https://canelevation-lidar-point-clouds.s3.ca-central-1.amazonaws.com/pointclouds_nuagespoints/NRCAN/Hamilton_Niagara_2021_2/ON_Niagara_20210525_NAD83CSRS_UTM17N_1km_E656_N4771_CLASS.copc.laz | [Natural Resources Canada — CanElevation Series, LiDAR Point Clouds](https://open.canada.ca/data/en/dataset/7069387e-9986-4297-9f55-0288e9676947) (Open Government Licence — Canada), Hamilton–Niagara 2021 survey. Header CRS matches Ontario, Canada. |
| Trestle Bridge | https://s3.amazonaws.com/grid-public-ept/20210421-FLW-Trestle-low-attitude.copc.laz | [NGA and U.S. Army TPO-GEO demonstration](https://www.army.mil/article/250090/fort_leonard_wood_geospatial_engineers_partner_with_nga_test_laser_based_surveying_technology) at Fort Leonard Wood, MO: a nearby railroad trestle scanned by sUAS- and truck-mounted lidar. Date in the filename/header (2021-04-21) predates the August 2021 write-up; no catalog page for this file. Coordinates resolve to Devils Elbow, MO, adjacent to the fort. |
| Millsite Reservoir | https://s3.amazonaws.com/hobu-lidar/millsite.copc.laz | USGS 3D Elevation Program (3DEP) — [3DEP LiDAR over Millsite Reservoir, UT](https://www.usgs.gov/media/images/3dep-lidar-over-millsite-reservoir-ut). Commonly described as a 2017 joint UGRC/NRCS/UGS survey, flown while the reservoir was drained. Header CRS matches Utah, USA. |
| SoFi Stadium | https://s3.amazonaws.com/hobu-lidar/sofi.copc.laz | Location confirmed; original capturing organization not stated. The COPC center coordinate resolves to 33.9537°N, 118.3377°W — [SoFi Stadium, Inglewood, CA](https://en.wikipedia.org/wiki/SoFi_Stadium). |
| Iowa 3DEP (2019–2020) | https://s3.amazonaws.com/hobu-lidar/iowa-50m-3dep-2019-2020.copc.laz | USGS 3D Elevation Program (3DEP), Eastern Iowa airborne lidar (Dec 2019–Nov 2020). Commonly described as supported by USDA-NRCS and the Iowa Department of Agriculture and Land Stewardship. Resampled to roughly 50 m spacing and converted to COPC by Hobu, Inc. in February 2023. |
| New York City | https://s3.amazonaws.com/hobu-lidar/nyc.copc.laz | [2013–2014 USGS CMGP LiDAR: Post Sandy (New York City)](https://portal.opentopography.org/noaaDataset?noaaID=4920). Acquired by Woolpert under an NGA task order (including Manhattan cross-flights, August 2013) and reused by USGS for its Post-Sandy program. Header CRS and coordinates both match lower Manhattan. |
| Montréal | https://s3.amazonaws.com/hobu-lidar/montreal-2015.copc.laz | [Ville de Montréal — LiDAR aérien 2015](https://donnees.montreal.ca/dataset/lidar-aerien-2015) (CC-BY-4.0). Flown by XEOS Imaging, Inc., 2015-11-24–12-08. Official release is tiled LAZ, also mirrored on [Données Québec](https://www.donneesquebec.ca/recherche/dataset/vmtl-lidar-aerien-2015) and [open.canada.ca](https://open.canada.ca/data/en/dataset/9ae61fa2-c852-464b-af7f-82b169b970d7). This file is a COPC rehost (Hobu). Header CRS (NAD83(CSRS) MTM zone 8) matches Montréal. |

## Hosting

Most files above are rehosted, in COPC form, in the `hobu-lidar` S3 bucket — a public bucket operated by **Hobu, Inc.**, which develops and maintains PDAL, COPC, and Entwine, and stewards the COPC specification as part of the broader copc.io ecosystem. The bucket is publicly listable and also carries other geospatial demo data (satellite imagery COGs, DEMs), consistent with general-purpose use for Hobu's own demos and research.

`grid-public-ept` (Trestle Bridge) is a separate bucket; its operator was not confirmed.

## Verification method

Coordinate reference systems were confirmed by issuing HTTP `Range` requests for each file's first 375 bytes (the fixed LAS 1.4 header) and its VLR region — using `header_size`/`offset_to_point_data` to locate the VLR block, then reading the WKT string from the `LASF_Projection` VLR (record ID 2112). The COPC info VLR (`user_id: copc`, record ID 1) was also parsed for its `center_x`/`center_y` fields, which were converted from their native projected CRS (UTM, etc.) back to latitude/longitude to cross-check against known locations. Neither the COPC info VLR nor the EPT Hierarchy EVLR carries any attribution information (capturing organization, licence, etc.) beyond coordinate reference system and spatial extent.
