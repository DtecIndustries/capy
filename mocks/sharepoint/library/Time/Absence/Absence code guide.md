# Absence code guide

| Owner | Team | Version | Date |
|---|---|---|---|
| Emma Wouters | Time team | 1.0 | 15 January 2026 |

*Internal use · Knowledge Hub · Time*

This guide lists the absence codes available in Time and when to open them for a client. It applies to all clients. Client-specific configuration notes are kept in the *Clients* folder of this library.

## 1. How codes flow to Pay

Absence codes registered in Time are exported to Pay at the end of each month. Pay decides how an absence is paid (guaranteed salary, unpaid, sickness fund). **Time does not decide on pay rules**; when in doubt about which code to use for a pay-relevant absence, ask the Pay team.

## 2. Standard code set

| Code | Description | Pay-relevant | Notes |
|---|---|---|---|
| AB-01 | Unpaid absence | Yes | Legacy use for the sickness waiting day; **do not use for new sickness configurations** |
| AB-10 | Sickness, guaranteed salary | Yes | From the first day of sickness |
| AB-11 | Sickness, relapse | Yes | Within 14 days after previous period |
| AB-20 | Work accident | Yes | |
| AB-30 | Small leave (family events) | Yes | Not for contracts shorter than one month |
| AB-40 | Holiday | Yes | |
| AB-50 | Training | No | |
| AB-90 | To be regularised | — | Temporary code while documents are missing |

## 3. Setting up a new client

1. Open the standard code set.
2. Check the client addenda in the Pay library for exceptions.
3. Record any client-specific configuration in a configuration note in *Clients/<client>*.
4. Have the configuration note approved by the Time team lead.

## 4. Table 4 – reduced list for short contracts

For contracts shorter than one month (seasonal and temporary work) only the following codes are opened: AB-10, AB-11, AB-20, AB-40, AB-90. Small leave (AB-30) is not available.

## 5. Monthly close

Timesheets are closed on the last working Monday of the month at 18:00. After that, corrections go through the manual correction flow.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 15/01/2026 | E. Wouters | First version, replaces the code list on the old intranet |

---
*For internal use only.*
