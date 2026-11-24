# Conditional Growth Calculator for English language proficiency

A free, open tool for schools and districts. It compares each multilingual learner's year-to-year change in English language proficiency with the change typical for students in the same grade, at the same prior level, in the same school year, estimated from the district's own records.

**Privacy:** everything runs in the user's browser. No file is uploaded, stored or transmitted.

## Use it
Open `index.html` (or the hosted page) and drop a CSV with one row per student per year:

| student_id | school_year | grade | overall_level |
|---|---|---|---|
| S0001 | 2022-23 | 3 | 2.4 |
| S0001 | 2023-24 | 4 | 2.9 |

Grade: PK, K or 1–12. Year: `2023-24` or `2024`. Level: ACCESS for ELLs Overall proficiency level, 1.0–6.0. Use de-identified IDs. `sample_data_synthetic.csv` contains synthetic records, not real students.

## Method
For each pair of consecutive years: `change ~ grade entered + prior level + prior level² + school year` (ordinary least squares). A student's conditional growth is the mean residual across their year pairs. Students whose mean residual falls below a chosen number of residual standard deviations (default −1.0) are marked "below expected."

Validated against the analysis code of Vieytes Cichero (under review): on the same records it reproduces the published model exactly (572 changes, R² = .366).

## Limits
- Annual changes contain substantial measurement error; single-year results are least reliable.
- In a prospective test with one district's data, conditional growth was associated with later state reading scores but did not add significantly beyond the prior reading score. Results are descriptive, not predictive or diagnostic.
- Not affiliated with or endorsed by WIDA.

## Cite
Vieytes Cichero, N. S. (2026). *Conditional Growth Calculator for English language proficiency* (Version 1.0) [Computer software]. DOI: see the Zenodo badge.

## License
MIT. Copyright © 2026 Nora S. Vieytes Cichero.
