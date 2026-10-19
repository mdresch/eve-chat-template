# SMA Working Group Charters: Notion & Linear Import Package

This document contains pre-formatted copy-paste blocks for instant migration into **Notion** databases and **Linear** Epics/Issues.

---

## Part 1: Linear Import Schema (Epics & Key Issues)

### Epic 1: [WG-1] Cryptographic TCB & Attestation Profiles
* **Team**: Security / TEE (`SEC`)
* **Priority**: Urgent (P1)
* **Target Cycle**: Q1 2027 (12-week sprint)
* **Summary**: Define, validate, and maintain hardware-enforced TEE attestation profiles (Intel TDX, AMD SEV-SNP, NVIDIA CC), AVS verification service, and cross-vendor CI testbeds.
* **Child Issues**:
  1. `[SEC-101]` Define Canonical `accepted_measurements` JSON Schema and PCR register mapping.
  2. `[SEC-102]` Specify Attestation Verification Service (AVS) REST/gRPC API with 300s fingerprint caching.
  3. `[SEC-103]` Implement Tier-1 Session Ratchet + Merkle turn transcript hashing protocol.
  4. `[SEC-104]` Build automated hardware interop CI pipeline for NVIDIA H100 CC and AMD SEV-SNP.

### Epic 2: [WG-2] SLA Definitions, Verification & Telemetry
* **Team**: Observability / SLM (`OPS`)
* **Priority**: High (P2)
* **Target Cycle**: Q1–Q2 2027
* **Summary**: Formalize SLA performance metrics (TTFT, ITL, CWR), Dynamic Difficulty Adjustment (DDA), and OpenTelemetry semantic conventions.
* **Child Issues**:
  1. `[OPS-201]` Standardize TTFT, ITL, and CWR mathematical measurement specifications.
  2. `[OPS-202]` Implement Dynamic Difficulty Adjustment (DDA) calibration algorithm: `CWR_allowed = min(0.10 * (1 + 0.5 * ln(k)), 0.18)`.
  3. `[OPS-203]` Author OpenTelemetry (OTel) semantic convention schema for IDU execution telemetry.
  4. `[OPS-204]` Define cryptographically signed dispute evidence collection formats for SLA arbitration.

### Epic 3: [WG-3] Protocols, gRPC Interfaces & FSM
* **Team**: Platform / Protocols (`PROTO`)
* **Priority**: Urgent (P1)
* **Target Cycle**: Q1 2027
* **Summary**: Standardize `sidpa.ipc.v1` Protobuf v3 definitions, encrypted streaming envelopes, seven-phase FSM, and multi-language SDKs.
* **Child Issues**:
  1. `[PROTO-301]` Finalize `proto/sidpa/ipc/v1/ipc_service.proto` schema and publish buf registry module.
  2. `[PROTO-302]` Specify end-to-end encrypted streaming envelope and session key ratchet headers.
  3. `[PROTO-303]` Formalize seven-phase FSM transition invariants (DRAFT -> SETTLED) with concurrency tests.
  4. `[PROTO-304]` Build TypeScript and Go reference client SDKs with automated FSM conformance harness.

### Epic 4: [WG-4] Accounting, Settlement & Three-Ledger Postings
* **Team**: Finance & Settlement (`FIN`)
* **Priority**: High (P2)
* **Target Cycle**: Q1–Q2 2027
* **Summary**: Formulate Standardized Intelligence Accounting (SIA), Three-Ledger double-entry journal postings, automated escrow liquidation, and SII benchmark index.
* **Child Issues**:
  1. `[FIN-401]` Author `SMA-GAAP-2026`: Principles of Standardized Intelligence Accounting.
  2. `[FIN-402]` Define double-entry journal entry schemas for Ledger 1 (Capacity), Ledger 2 (Delivery), and Ledger 3 (Yield).
  3. `[FIN-403]` Specify automated multi-cloud escrow smart contracts with programmatic SLA breach penalty liquidation.
  4. `[FIN-404]` Build reference Clearinghouse Settlement Simulator and accounting test vectors.

---

## Part 2: Notion Team Workspace Template (Page Copy)

```markdown
# 🏛️ SIDPA Measurement Authority (SMA) — Standards Council

> The open standards authority establishing measurement, cryptographic attestation, and double-entry accounting for intelligence capital.

## 📌 Working Groups Hub

| Working Group | Focus Area | Co-Chairs | 12-Week Deliverables | Status |
| :--- | :--- | :--- | :--- | :--- |
| **WG-1** | **Cryptographic TCB & Attestation** | Security Lead (Consumer) + TEE Architect (Vendor) | `SMA-STD-003` (Attestation Profile), AVS Spec | 🟡 Sprint Active |
| **WG-2** | **SLA Definitions & Verification** | SLM Lead + Telemetry Architect | `SMA-STD-002` (SLA Spec), OTel Telemetry Schema | 🟡 Sprint Active |
| **WG-3** | **Protocols, gRPC & FSM** | API Architect + Protocol Lead | `SMA-PROTO-001` (Protobuf v3), Multi-Lang SDKs | 🟡 Sprint Active |
| **WG-4** | **Accounting & Three-Ledger Postings** | Enterprise CFO + Clearing Engineer | `SMA-GAAP-2026` (Intelligence GAAP), Escrow Rails | 🟡 Sprint Active |

## 🔑 Governing Principles & Invariants
- **Hardware Root of Trust**: Zero unverified cycles; all capitalized IDUs must trace to certified TEE enclaves.
- **Dynamic Waste Attribution (DDA)**: Strict 10% static baseline for single-turn, scaling up to 15-20% for deep reasoning DAGs.
- **Three-Ledger Integrity**: Double-entry reconciliation across Capacity (L1), Delivery (L2), and Yield (L3).
- **Consensus Rule**: Two-thirds (66.7%) supermajority for normative standard elevation.
```

