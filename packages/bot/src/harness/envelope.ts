import { PROTOCOL_VERSION } from '@shaatir-shakuni/socket-api';

/**
 * Minimal envelope builder mirroring `packages/web/src/lib/envelope.ts`.
 * Duplicated here (rather than imported) because that file lives under the
 * web app's `src/`, not a shared package.
 */
export function buildEnvelope<TPayload>(
  payload: TPayload,
  opts: { readonly sequence: number; readonly stateVersion: number },
): {
  protocolVersion: typeof PROTOCOL_VERSION;
  actionUuid: string;
  sequence: number;
  stateVersion: number;
  payload: TPayload;
} {
  return {
    protocolVersion: PROTOCOL_VERSION,
    actionUuid: crypto.randomUUID(),
    sequence: opts.sequence,
    stateVersion: opts.stateVersion,
    payload,
  };
}
