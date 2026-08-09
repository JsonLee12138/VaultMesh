import { z } from 'zod';

export const ApiEnvironmentKindSchema = z.enum(['production', 'staging', 'development', 'local', 'other']);
export const ApiCredentialItemKindSchema = z.enum(['login', 'secret']);
export const ApiCredentialFieldSchema = z.enum(['login-username', 'login-password', 'secret-value']);
export const ApiExpectedSecretKindSchema = z.enum([
  'api-key', 'access-token', 'authenticator-key', 'client-secret', 'webhook-secret',
  'database-credential', 'recovery-codes', 'certificate', 'software-license',
  'identity-document', 'secure-note', 'crypto-wallet', 'other',
]);
export const ApiCredentialRefSchema = z.object({
  itemKind: ApiCredentialItemKindSchema,
  itemId: z.uuid(),
  field: ApiCredentialFieldSchema,
  expectedSecretKind: ApiExpectedSecretKindSchema.nullable(),
}).strict();
export const ApiEnvironmentAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('bearer'), credential: ApiCredentialRefSchema }).strict(),
  z.object({
    type: z.literal('basic'), username: ApiCredentialRefSchema, password: ApiCredentialRefSchema,
  }).strict(),
  z.object({
    type: z.literal('api-key'), location: z.enum(['header', 'query']),
    name: z.string().trim().min(1).max(128), credential: ApiCredentialRefSchema,
  }).strict(),
]);
export const ApiFixedHeaderSchema = z.object({
  name: z.string().trim().min(1).max(64),
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('literal'), value: z.string().trim().min(1).max(1_024) }).strict(),
    z.object({ type: z.literal('protected'), credential: ApiCredentialRefSchema }).strict(),
  ]),
}).strict();
export const ApiEnvironmentInputSchema = z.object({
  serviceId: z.uuid(),
  name: z.string().trim().min(1).max(128),
  kind: ApiEnvironmentKindSchema,
  origin: z.url().max(2_048).refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), '仅支持 HTTP(S) origin'),
  basePath: z.string().trim().max(2_048).nullable(),
  openapiUrl: z.url().max(2_048).refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), '仅支持 HTTP(S) OpenAPI URL').nullable(),
  auth: ApiEnvironmentAuthSchema,
  fixedHeaders: z.array(ApiFixedHeaderSchema).max(32),
}).strict();
export const ApiEnvironmentUpdateSchema = ApiEnvironmentInputSchema.extend({ id: z.uuid() });
export const ApiEnvironmentSummarySchema = z.object({
  id: z.uuid(), serviceId: z.uuid(), name: z.string(), kind: ApiEnvironmentKindSchema,
  authKind: z.enum(['none', 'bearer', 'basic', 'api-key']), fixedHeaderCount: z.number().int().min(0).max(32),
  revision: z.number().int().positive(), policyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}).strict();
export const ApiEnvironmentDetailSchema = ApiEnvironmentInputSchema.extend({
  id: z.uuid(), revision: z.number().int().positive(), policyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}).strict();
export const ApiEnvironmentTrashSummarySchema = z.object({
  trashId: z.uuid(), environmentId: z.uuid(), serviceId: z.uuid(), name: z.string(),
  deletedAt: z.number().int().nonnegative(),
}).strict();
export const ApiEnvironmentRevisionSummarySchema = z.object({
  revisionId: z.uuid(), environmentId: z.uuid(), name: z.string(), revision: z.number().int().positive(),
  savedAt: z.number().int().nonnegative(),
}).strict();

export type ApiCredentialRef = z.infer<typeof ApiCredentialRefSchema>;
export type ApiEnvironmentAuth = z.infer<typeof ApiEnvironmentAuthSchema>;
export type ApiFixedHeader = z.infer<typeof ApiFixedHeaderSchema>;
export type ApiEnvironmentInput = z.infer<typeof ApiEnvironmentInputSchema>;
export type ApiEnvironmentUpdate = z.infer<typeof ApiEnvironmentUpdateSchema>;
export type ApiEnvironmentSummary = z.infer<typeof ApiEnvironmentSummarySchema>;
export type ApiEnvironmentDetail = z.infer<typeof ApiEnvironmentDetailSchema>;
export type ApiEnvironmentTrashSummary = z.infer<typeof ApiEnvironmentTrashSummarySchema>;
export type ApiEnvironmentRevisionSummary = z.infer<typeof ApiEnvironmentRevisionSummarySchema>;

export const ApiRequestMethodSchema = z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
export const ApiRequestPairSchema = z.object({
  name: z.string().trim().min(1).max(128), value: z.string().max(2_048),
}).strict();
export const ApiRequestBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('json'), value: z.string().max(256 * 1_024) }).strict(),
  z.object({ type: z.literal('text'), value: z.string().max(256 * 1_024) }).strict(),
]);
export const ApiRequestInputSchema = z.object({
  environmentId: z.uuid(), method: ApiRequestMethodSchema,
  path: z.string().min(1).max(2_048),
  query: z.array(ApiRequestPairSchema).max(32),
  headers: z.array(ApiRequestPairSchema).max(32),
  body: ApiRequestBodySchema,
}).strict();
export const ApiRequestPreviewSchema = z.object({
  executionRef: z.uuid(), expiresAt: z.number().int().positive(), method: ApiRequestMethodSchema,
  origin: z.string().url(), basePath: z.string().nullable(), path: z.string(),
  bodyType: z.enum(['none', 'json', 'text']), queryCount: z.number().int().min(0).max(32),
  requestHeaderCount: z.number().int().min(0).max(32), fixedHeaderCount: z.number().int().min(0).max(32),
  authType: z.enum(['none', 'bearer', 'basic', 'api-key']),
  targetClass: z.enum(['public', 'private', 'loopback']), mutation: z.boolean(),
  requiresNativeConfirmation: z.boolean(),
}).strict();
export const ApiResponseHeaderSchema = z.object({ name: z.string(), value: z.string() }).strict();
export const ApiResponseBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('empty') }).strict(),
  z.object({ type: z.literal('json'), value: z.unknown() }).strict(),
  z.object({ type: z.literal('text'), value: z.string() }).strict(),
]);
export const ApiRequestExecutionResultSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('completed'), response: z.object({
      status: z.number().int().min(100).max(599), statusClass: z.string().regex(/^[1-5]xx$/),
      headers: z.array(ApiResponseHeaderSchema).max(64), body: ApiResponseBodySchema,
    }).strict(),
  }).strict(),
  z.object({
    state: z.enum(['failed', 'cancelled', 'execution-unknown']),
    error: z.object({
      code: z.string().min(1).max(64), message: z.string().min(1).max(512),
      retryable: z.literal(false), executionUnknown: z.boolean(),
    }).strict(),
  }).strict(),
]);
export const ApiRequestCancelResultSchema = z.object({ cancelled: z.boolean() }).strict();

export type ApiRequestInput = z.infer<typeof ApiRequestInputSchema>;
export type ApiRequestPreview = z.infer<typeof ApiRequestPreviewSchema>;
export type ApiRequestExecutionResult = z.infer<typeof ApiRequestExecutionResultSchema>;
