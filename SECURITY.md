# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| v1.0    | yes |

## Reporting a Vulnerability

If you discover a security vulnerability in the OSINT Center project, please do not open a public GitHub issue. Instead, email us directly at:

agiprogrammer@gmail.com

Please include as much detail as possible, such as:
- Description of the vulnerability
- Steps to reproduce
- Affected components (map rendering, tile layers, API endpoints, etc.)
- Suggested fix or mitigation

## Map and Tiles Rendering Review

Any changes related to map rendering, tile layer configuration, or geographic data sources must be reviewed by the project maintainer before being merged into the main branch. This includes:

- Changes to Leaflet map configuration (engine.js, layers.js, overlays.js)
- Updates to map tile providers or basemap sources
- Modifications to coordinate handling or projection logic
- Changes to map markers, clusters, or overlays
- Updates to offline map tile presets or manifest files

Please contact agiprogrammer@gmail.com to request a review of any map or tiles-related changes.

## Response Timeline

We will acknowledge receipt of your report within 48 hours and provide a timeline for resolution.
