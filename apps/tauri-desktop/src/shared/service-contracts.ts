import { z } from 'zod';

export const ServiceItemKindSchema = z.enum(['login', 'secret', 'ssh', 'identity']);
export const ServiceRelationshipSourceSchema = z.enum(['manual', 'automatic-exact-host-v1']);
export const ServiceRelationshipSchema = z.object({
  itemKind: ServiceItemKindSchema,
  itemId: z.uuid(),
  source: ServiceRelationshipSourceSchema,
}).strict();
export const ServiceInputSchema = z.object({
  name: z.string().trim().min(1).max(256),
  description: z.string().trim().max(10_000).nullable(),
  tags: z.array(z.string().trim().min(1).max(128)).max(50),
  sites: z.array(z.url().max(2_048).refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), '仅支持 HTTP(S) 地址')).min(1).max(20),
}).strict();
export const ServiceUpdateSchema = ServiceInputSchema.extend({ id: z.uuid() });
export const ServiceItemCountsSchema = z.object({
  login: z.number().int().nonnegative(), secret: z.number().int().nonnegative(),
  ssh: z.number().int().nonnegative(), identity: z.number().int().nonnegative(),
}).strict();
export const ServiceSummarySchema = z.object({
  id: z.uuid(), name: z.string(), description: z.string().nullable(), tags: z.array(z.string()),
  siteCount: z.number().int().nonnegative(), counts: ServiceItemCountsSchema,
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}).strict();
export const ServiceDetailSchema = z.object({
  id: z.uuid(), name: z.string(), description: z.string().nullable(), tags: z.array(z.string()),
  sites: z.array(z.string()), relationships: z.array(ServiceRelationshipSchema), counts: ServiceItemCountsSchema,
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}).strict();
export const ServiceTrashSummarySchema = z.object({
  trashId: z.uuid(), serviceId: z.uuid(), name: z.string(), deletedAt: z.number().int().nonnegative(),
}).strict();
export const ServiceRevisionSummarySchema = z.object({
  revisionId: z.uuid(), serviceId: z.uuid(), name: z.string(), savedAt: z.number().int().nonnegative(),
}).strict();
export const ServiceAggregationClusterSchema = z.object({
  serviceKey: z.string().startsWith('host-v1:'), suggestedName: z.string(), suggestedSite: z.string().url(),
  existingServiceId: z.uuid().nullable(), reason: z.literal('exact canonical host'),
  relationships: z.array(ServiceRelationshipSchema),
}).strict();
export const ServiceAggregationReviewItemSchema = z.object({
  itemKind: ServiceItemKindSchema, itemId: z.uuid(), label: z.string().min(1).max(256),
  reason: z.enum(['conflicting-metadata', 'no-safe-key']),
}).strict();
export const ServiceAggregationPlanSchema = z.object({
  planId: z.string().regex(/^[a-f0-9]{64}$/), vaultNamespace: z.string().regex(/^[a-f0-9]{64}$/),
  catalogRevision: z.string().regex(/^[a-f0-9]{64}$/), ruleVersion: z.literal('exact-host-v1'),
  inputDigest: z.string().regex(/^[a-f0-9]{64}$/), clusters: z.array(ServiceAggregationClusterSchema).max(1_000),
  reviewItems: z.array(ServiceAggregationReviewItemSchema).max(1_000),
  highConfidenceItemCount: z.number().int().nonnegative(), conflictCount: z.number().int().nonnegative(),
  ungroupedCount: z.number().int().nonnegative(),
}).strict();
export const ServiceAggregationApplyResultSchema = z.object({
  batchId: z.uuid(), createdServiceCount: z.number().int().nonnegative(), linkedItemCount: z.number().int().nonnegative(),
  alreadyApplied: z.boolean(),
}).strict();
export const ServiceIgnoredSuggestionSchema = z.object({
  serviceKey: z.string().startsWith('host-v1:'), itemKind: ServiceItemKindSchema, itemId: z.uuid(),
}).strict();

export type ServiceItemKind = z.infer<typeof ServiceItemKindSchema>;
export type ServiceRelationship = z.infer<typeof ServiceRelationshipSchema>;
export type ServiceInput = z.infer<typeof ServiceInputSchema>;
export type ServiceUpdate = z.infer<typeof ServiceUpdateSchema>;
export type ServiceSummary = z.infer<typeof ServiceSummarySchema>;
export type ServiceDetail = z.infer<typeof ServiceDetailSchema>;
export type ServiceTrashSummary = z.infer<typeof ServiceTrashSummarySchema>;
export type ServiceRevisionSummary = z.infer<typeof ServiceRevisionSummarySchema>;
export type ServiceAggregationPlan = z.infer<typeof ServiceAggregationPlanSchema>;
export type ServiceAggregationApplyResult = z.infer<typeof ServiceAggregationApplyResultSchema>;
export type ServiceIgnoredSuggestion = z.infer<typeof ServiceIgnoredSuggestionSchema>;

export const AgentToolParameterSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(['string', 'string-array', 'integer', 'object']),
  required: z.boolean(),
  maxLength: z.number().int().positive().optional(),
  maxItems: z.number().int().positive().optional(),
  maxBytes: z.number().int().positive().optional(),
}).strict();

export const AgentToolDefinitionSchema = z.object({
  name: z.string().regex(/^vaultmesh_[a-z0-9_]+$/),
  version: z.union([z.literal(1), z.literal(2)]),
  capability: z.string().min(1).max(128),
  risk: z.enum(['R0', 'R1', 'R2', 'R3', 'R4']),
  requiresAccount: z.boolean(),
  confirmation: z.enum(['none', 'permission', 'session', 'first-target', 'fresh', 'privileged', 'risk-dependent']),
  parameters: z.array(AgentToolParameterSchema).max(64),
}).strict();

export const AgentClientActivitySchema = z.object({
  clientId: z.uuid(),
  processId: z.number().int().positive(),
  connectedAt: z.number().int().nonnegative(),
  activeSessionCount: z.number().int().nonnegative(),
}).strict();

export const AgentClientSummarySchema = z.object({
  clientId: z.string().min(1).max(128),
  clientKey: z.string().regex(/^[A-Za-z0-9_.:@-]{3,128}$/),
  pairingState: z.enum(['pending', 'paired']),
  activeSessionCount: z.number().int().nonnegative(),
  activities: z.array(AgentClientActivitySchema).max(32),
}).strict();

export const AgentAuthorizationRuleSchema = z.object({
  id: z.uuid(),
  clientKey: z.string().min(3).max(128),
  accountRef: z.uuid(),
  tool: z.string().regex(/^vaultmesh_[a-z0-9_]+$/),
  scope: z.enum(['exact', 'path', 'safe', 'all']),
  effect: z.enum(['allow', 'deny']),
  httpMethod: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']).nullable().optional(),
  pathPattern: z.string().min(1).max(2048).nullable().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict();


export const AgentPermissionRequestSchema = z.object({
  permissionRef: z.uuid(), clientId: z.uuid(), sessionId: z.uuid(), accountRef: z.uuid(),
  accountLabel: z.string().min(1).max(128), environment: z.string().min(1).max(128),
  tool: z.string().regex(/^vaultmesh_[a-z0-9_]+$/),
  operation: z.string().min(1).max(2048).nullable(),
  risk: z.enum(['R0', 'R1', 'R2', 'R3', 'R4']), approvedDisplay: z.string().min(1).max(256),
  actionDisplay: z.string().min(1).max(16_384),
  sourceItemRef: z.uuid().nullable(), sourceItemKind: z.enum(['login', 'ssh', 'secret']).nullable(),
  activationRequired: z.boolean(),
  availableScopes: z.array(z.enum(['exact', 'path', 'safe', 'all'])).min(1).max(4),
  availablePathPatterns: z.array(z.string().min(1).max(2048)).max(3).optional(),
  availableAllowDurations: z.array(z.enum(['once', 'connection', 'permanent'])).min(1).max(3),
  availableDenyDurations: z.array(z.enum(['once', 'connection', 'permanent'])).min(1).max(3),
  recommendedScope: z.enum(['exact', 'path', 'safe', 'all']),
  recommendedDuration: z.enum(['once', 'connection', 'permanent']),
  freshConfirmationRequired: z.boolean(),
  createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(),
}).strict();

export const AgentPermissionChoiceSchema = z.object({
  effect: z.enum(['allow', 'deny']),
  scope: z.enum(['exact', 'path', 'safe', 'all']),
  duration: z.enum(['once', 'connection', 'permanent']),
  pathPattern: z.string().min(1).max(2048).optional(),
}).strict();

export const AgentPermissionResolutionSchema = z.object({
  request: AgentPermissionRequestSchema,
  choice: AgentPermissionChoiceSchema,
}).strict();

export const AgentConfirmationSchema = z.object({
  confirmationRef: z.uuid(), clientId: z.uuid(), sessionId: z.uuid(),
  accountRef: z.uuid().nullable(), accountLabel: z.string().nullable(),
  tool: z.string().regex(/^vaultmesh_[a-z0-9_]+$/), risk: z.enum(['R0', 'R1', 'R2', 'R3', 'R4']),
  createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(), approved: z.boolean(),
}).strict();

export const AgentAuditEventSchema = z.object({
  eventId: z.uuid(), occurredAt: z.number().int().positive(), clientId: z.uuid(),
  clientKind: z.string().regex(/^[A-Za-z0-9_.:@-]{3,128}$/), sessionId: z.uuid(), accountRef: z.uuid(),
  accountLabel: z.string().min(1).max(128), environment: z.string().min(1).max(128),
  tool: z.string().regex(/^vaultmesh_[a-z0-9_]+$/), targetClass: z.string().min(1).max(128),
  approvedDisplay: z.string().min(1).max(256), risk: z.enum(['R0', 'R1', 'R2', 'R3', 'R4']),
  decision: z.enum(['allowed', 'denied']), confirmation: z.enum(['none', 'session', 'fresh', 'privileged']),
  durationMillis: z.number().int().nonnegative(),
  resultClass: z.enum(['succeeded', 'denied', 'failed', 'cancelled', 'unavailable']),
  statusClass: z.string().max(64).nullable(), itemCount: z.number().int().nonnegative(),
  byteCount: z.number().int().nonnegative(),
}).strict();

export const AgentAccessSettingsSchema = z.object({
  unlockScope: z.enum(['connection', 'client']),
  idleTimeoutMs: z.union([
    z.literal(5 * 60_000),
    z.literal(15 * 60_000),
    z.literal(30 * 60_000),
    z.literal(60 * 60_000),
  ]),
  maxUnlockDurationMs: z.union([
    z.literal(60 * 60_000),
    z.literal(4 * 60 * 60_000),
    z.literal(8 * 60 * 60_000),
    z.null(),
  ]),
}).strict();

export const AgentBrokerStatusSchema = z.object({
  protocolVersion: z.literal(2),
  shimPath: z.string().min(1).max(4096),
  shimAvailable: z.boolean(),
  confirmations: z.array(AgentConfirmationSchema).max(256),
  permissionRequests: z.array(AgentPermissionRequestSchema).max(256),
  authorizationRules: z.array(AgentAuthorizationRuleSchema).max(500),
  auditEvents: z.array(AgentAuditEventSchema).max(500),
  clients: z.array(AgentClientSummarySchema).max(64),
  access: z.object({
    hasVault: z.boolean(),
    runtimeUnlocked: z.boolean(),
    clientUnlocked: z.boolean(),
    activeLeaseCount: z.number().int().nonnegative(),
    settings: AgentAccessSettingsSchema,
  }).strict(),
  pin: z.object({
    enabled: z.boolean(),
    locked: z.boolean(),
    failureLimit: z.number().int().min(3).max(10),
    failedAttempts: z.number().int().nonnegative(),
    remainingAttempts: z.number().int().nonnegative(),
  }).strict(),
  tools: z.array(AgentToolDefinitionSchema).min(1),
}).strict();


export const EmailProviderSchema = z.enum([
  'gmail', 'outlook', 'qq', '163', '126', 'yeah', 'icloud', 'yahoo', 'zoho', 'fastmail', 'custom-imap',
]);

export const EmailAuthKindSchema = z.enum(['oauth', 'app-password']);

export const EmailAccountInputSchema = z.object({
  label: z.string().trim().min(1).max(128),
  address: z.email().max(320),
  provider: EmailProviderSchema,
  authKind: EmailAuthKindSchema,
  credential: z.string().min(1).max(10_000),
  imapHost: z.string().trim().min(1).max(253),
  imapPort: z.number().int().min(1).max(65_535),
  useTls: z.boolean(),
  enabled: z.boolean().default(true),
}).strict();

export const EmailAccountUpdateSchema = EmailAccountInputSchema.extend({
  id: z.uuid(),
  credential: z.string().min(1).max(10_000).nullable(),
}).strict();

export const EmailAccountSummarySchema = z.object({
  id: z.uuid(),
  label: z.string(),
  address: z.string(),
  provider: EmailProviderSchema,
  authKind: EmailAuthKindSchema,
  imapHost: z.string(),
  imapPort: z.number().int(),
  useTls: z.boolean(),
  enabled: z.boolean(),
  hasCredential: z.boolean(),
  status: z.enum(['untested', 'connected', 'error']),
  statusMessage: z.string().nullable(),
  lastTestedAt: z.number().int().nonnegative().nullable(),
});

export const EmailOtpSettingsSchema = z.object({
  enabled: z.boolean(),
  pollIntervalSeconds: z.number().int().min(5).max(300),
  messageLookbackMinutes: z.number().int().min(1).max(30),
  codeLifetimeSeconds: z.number().int().min(30).max(300),
  requireDomainMatch: z.boolean(),
  onlyUnreadMessages: z.boolean(),
}).strict();

export const DEFAULT_EMAIL_OTP_SETTINGS: z.infer<typeof EmailOtpSettingsSchema> = {
  enabled: false,
  pollIntervalSeconds: 10,
  messageLookbackMinutes: 5,
  codeLifetimeSeconds: 90,
  requireDomainMatch: false,
  onlyUnreadMessages: true,
};

export const EmailConnectionTestSchema = z.object({ id: z.uuid() }).strict();
export const EmailOtpCodeSchema = z.string().regex(/^(?=[A-Za-z0-9]{4,8}$)(?=.*[0-9])[A-Za-z0-9]+$/);
export const EmailOtpCopySchema = z.object({ code: EmailOtpCodeSchema }).strict();
export const EmailOAuthConnectSchema = z.object({
  provider: z.enum(['gmail', 'outlook']),
  label: z.string().trim().min(1).max(128),
}).strict();
export const EmailOAuthAvailabilitySchema = z.object({
  gmail: z.boolean(),
  outlook: z.boolean(),
});

export const EmailOtpCandidateSchema = z.object({
  accountId: z.uuid(),
  accountAddress: z.string(),
  code: EmailOtpCodeSchema,
  sender: z.string(),
  subject: z.string(),
  receivedAt: z.number().int().nonnegative(),
});

export const CopyResultSchema = z.object({
  clearsAt: z.number().int().positive(),
});

export const TotpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  period: z.literal(30),
  remainingSeconds: z.number().int().min(1).max(30),
});

export const ImportSourceSchema = z.enum([
  'chromium',
  'edge',
  'firefox',
  'safari',
  'onePassword',
  'bitwarden',
  'lastPass',
  'dashlane',
  'keepass',
  'csv',
]);

export const ImportSessionSchema = z.object({ sessionId: z.uuid() });

export const ImportPreviewItemSchema = z.object({
  type: z.enum(['login', 'paymentCard', 'sshCredential']),
  title: z.string(),
  detail: z.string(),
});

/** Deliberately excludes passwords and card numbers so previews never expose secrets to the renderer. */
export const ImportPreviewSchema = z.object({
  sessionId: z.uuid(),
  source: ImportSourceSchema,
  fileName: z.string(),
  importableCount: z.number().int().nonnegative(),
  loginCount: z.number().int().nonnegative(),
  paymentCardCount: z.number().int().nonnegative(),
  sshCredentialCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  items: z.array(ImportPreviewItemSchema).max(20),
});

export const ImportResultSchema = z.object({
  importedCount: z.number().int().nonnegative(),
  loginCount: z.number().int().nonnegative(),
  paymentCardCount: z.number().int().nonnegative(),
  sshCredentialCount: z.number().int().nonnegative(),
});

export type AgentToolDefinition = z.infer<typeof AgentToolDefinitionSchema>;
export type AgentClientActivity = z.infer<typeof AgentClientActivitySchema>;
export type AgentClientSummary = z.infer<typeof AgentClientSummarySchema>;
export type AgentBrokerStatus = z.infer<typeof AgentBrokerStatusSchema>;
export type AgentAccessSettings = z.infer<typeof AgentAccessSettingsSchema>;
export type AgentPermissionRequest = z.infer<typeof AgentPermissionRequestSchema>;
export type AgentPermissionChoice = z.infer<typeof AgentPermissionChoiceSchema>;
export type AgentAuthorizationRule = z.infer<typeof AgentAuthorizationRuleSchema>;
export type AgentPermissionResolution = z.infer<typeof AgentPermissionResolutionSchema>;
export type AgentConfirmation = z.infer<typeof AgentConfirmationSchema>;
export type AgentAuditEvent = z.infer<typeof AgentAuditEventSchema>;
export type EmailProvider = z.infer<typeof EmailProviderSchema>;
export type EmailAuthKind = z.infer<typeof EmailAuthKindSchema>;
export type EmailAccountInput = z.infer<typeof EmailAccountInputSchema>;
export type EmailAccountUpdate = z.infer<typeof EmailAccountUpdateSchema>;
export type EmailAccountSummary = z.infer<typeof EmailAccountSummarySchema>;
export type EmailOtpSettings = z.infer<typeof EmailOtpSettingsSchema>;
export type EmailOtpCandidate = z.infer<typeof EmailOtpCandidateSchema>;
export type EmailOAuthConnect = z.infer<typeof EmailOAuthConnectSchema>;
export type EmailOAuthAvailability = z.infer<typeof EmailOAuthAvailabilitySchema>;
export type CopyResult = z.infer<typeof CopyResultSchema>;
export type TotpCode = z.infer<typeof TotpCodeSchema>;
export type ImportSource = z.infer<typeof ImportSourceSchema>;
export type ImportPreviewItem = z.infer<typeof ImportPreviewItemSchema>;
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;
export type ImportResult = z.infer<typeof ImportResultSchema>;
