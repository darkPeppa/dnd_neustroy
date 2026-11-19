# Open SRD snapshots

The complete texts are extracted from the official English CC-BY-4.0 editions:

- SRD 5.1 (403 pages): https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf
- SRD 5.2.1 (364 pages): https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf

Structured catalogs are snapshots of https://api.open5e.com/v2/ filtered strictly to documents `srd-2014` and `srd-2024`. The latter is labeled SRD 5.2 by Open5e; the exact 5.2.1 text is provided separately in the full-text reader. The structured conversion may have differences; consult the original PDF for authoritative wording and table layout. Do not merge spell versions across editions. Retrieved November 19, 2026.

Counts: 48 class/subclass records, 22 species records, 5 backgrounds, 18 feats, 658 spells, 75 weapons, 25 armor records, 440 items, 1259 magic items and 656 creatures. Total: 3206 records. Counts include both source editions. Conditions and general rules are present in the complete text reader rather than separate structured endpoints.

`vendored/*.json.gz` contains the complete snapshots, committed in compressed form. `npm run build` restores JSON files to ignored working directories before compilation; the app includes them in its offline cache. No network request to Open5e is made during a normal build or game.

Attribution required by the original documents:

This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

Russian interface text, selected short names, arithmetic adapters, and page-text extraction are adaptations. This is not an official Wizards of the Coast product. Closed rulebooks and third-party settings are not bundled. SQLite is public domain; sql.js is MIT-licensed.
