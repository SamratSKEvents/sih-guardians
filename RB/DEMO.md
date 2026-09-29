# GUARDIANS static prototype

Run `run.bat` to open http://localhost:5199. The prototype ships 20 static slick records and uses bundled incident files plus clearly marked mock data for supporting views. At least 14 records are within 25 km of the bundled shoreline; two carry assigned demo locations. There is no API, database, or planner service to start.

## Walkthrough

1. **Landing** (`#/`): the product overview and observed / reconstructed / predicted rule. Choose **Walk through a live incident**.
2. **Detection**: the Gulf of Kutch record opens with its bundled outline and SAR scene. Use the left rail to switch between geometry, vessel context, look-alike analysis, and provenance.
3. **Spills** (`#/spills`): browse the 20 static slicks on the globe. Select a feature to open its investigation.
4. **Dashboard** (`#/dashboard`): see the shift overview and open a detection from the queue.

## Data

- **Bundled:** 20 slick geometries, the flagship SAR scene and incident artifacts, and Natural Earth shoreline data.
- **Mock:** vessel tracks, look-alike comparisons, and supporting analysis for records without bundled inputs. These are labeled in the interface.

The drift scenario runs to 24 hours. The flagship record also carries a bundled 24-hour Lagrangian backtrack across four windage cases. `npm test` checks catalog geometry, near-shore coverage, vessel routes, source-hypothesis selection, and the forecast horizon.

The prototype does not seed a database or connect to backend services.
