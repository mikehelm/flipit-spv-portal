/**
 * The compliance gate. BUILD_SPEC §8.2 and §8.3.
 *
 * One import for everything else in the application:
 *
 *   getCurrentApproval(kind)   the newest approval that has not been voided
 *   checkTemplateDrift(kind)   live hash vs approved hash, with a diff
 *   isJurisdictionApproved()   one code against one approval
 *   assertCompliant(offer)     refuse one recipient, specifically
 *   gateBatch(offers, ...)     one refusal never touches another decision
 *
 * Writes are not here. Recording, amending and voiding an approval, and
 * clearing an individual recipient, all live in `src/actions/compliance.ts`
 * behind an owner check and an audit entry. Keeping them out of this module
 * means nothing can reach a write by importing the gate.
 */

export {
  findSourceByHash,
  getCurrentApproval,
  listApprovals,
  type ComplianceApprovalRecord,
} from './approvals'

export {
  authorizeComplianceAction,
  canManageCompliance,
  complianceActionLabel,
  ComplianceAuthorityError,
  COMPLIANCE_ACTIONS,
  type ComplianceAction,
  type ComplianceAuthorityDecision,
} from './authority'

export { BLOCS, lookupBloc, type BlocDefinition } from './blocs'

export {
  diffTemplateSource,
  partLabel,
  type DiffLine,
  type PartDiff,
  type TemplateDiff,
  type TemplatePart,
  type TemplateSourceParts,
} from './diff'

export {
  checkTemplateDrift,
  evaluateDrift,
  type DriftEvaluation,
  type DriftState,
  type TemplateDriftReport,
} from './drift'

export {
  explainJurisdictionBlock,
  NOT_LEGAL_ADVICE,
  shortBlockReason,
  type BlockExplanation,
} from './explain'

export {
  assertCompliant,
  checkOfferCompliance,
  ComplianceBlockedError,
  evaluateOfferCompliance,
  gateBatch,
  loadGateContext,
  type BatchGateResult,
  type ComplianceDecision,
  type ComplianceRefusalReason,
  type GateableOffer,
  type OfferBlockReason,
  type OfferComplianceInput,
} from './gate'

export {
  hasRecordedOverride,
  isJurisdictionApproved,
  jurisdictionLabel,
  MIN_APPROVAL_REFERENCE_LENGTH,
  normaliseJurisdiction,
  parseApprovedJurisdictions,
  type JurisdictionAuthority,
  type JurisdictionParseResult,
} from './jurisdictions'
