# Part-time sickness: absence configuration – Scheldemond Logistics NV

| Client | Owner | Version | Date |
|---|---|---|---|
| Scheldemond Logistics NV (client-x) | Lucas Jacobs | 1.0 | 1 September 2026 |

*Internal use · Knowledge Hub · Time · Client-specific*

Configuration note for registering sickness of part-time employees at Scheldemond Logistics in Time, ahead of the September run.

## 1. Background

The client asked how the first day of sickness of part-time employees should be registered. Confirmed by Pay (T. Maes, 1 September 2026, with reference to the sick leave procedure section 3.2).

## 2. Configuration

| Day of sickness | Code | Meaning |
|---|---|---|
| Day 1 | **AB-01** | Unpaid waiting day |
| Day 2 onwards | AB-10 | Sickness, guaranteed salary |
| Sickness ≥ 14 days | AB-10 for day 1 as well | Day 1 regularised in the next run |

Full-time employees: AB-10 from day 1 (no change).

## 3. Implementation

- Rule created in the Scheldemond absence profile *PT-SICK* on 1 September 2026.
- Applies to all part-time contracts at the three sites (Antwerp, Ghent, Zeebrugge).
- The client's HR portal sends the sickness notification; Time applies the rule automatically.

## 4. Test cases

| Case | Expected result |
|---|---|
| Part-timer sick Monday–Wednesday | Mon AB-01, Tue–Wed AB-10 |
| Part-timer sick 16 days | All days AB-10 after regularisation |
| Full-timer sick 2 days | Both days AB-10 |

All three test cases passed on the acceptance environment on 1 September 2026.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 01/09/2026 | L. Jacobs | First version |

---
*For internal use only. Client-specific information must not be shared with other clients.*
