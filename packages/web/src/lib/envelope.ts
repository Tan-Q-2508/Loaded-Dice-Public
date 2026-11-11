import { PROTOCOL_VERSION } from '@shaatir-shakuni/socket-api';

export type EnvelopeFields = {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly actionUuid: string;
  readonly sequence: number;
  readonly stateVersion: number;
};

export type Envelope<TPayload> = EnvelopeFields & {
  readonly payload: TPayload;
};

export function newActionUuid(): string {
  return crypto.randomUUID();
}

export function buildEnvelope<TPayload>(
  payload: TPayload,
  opts: { readonly sequence: number; readonly stateVersion: number },
): Envelope<TPayload> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    actionUuid: newActionUuid(),
    sequence: opts.sequence,
    stateVersion: opts.stateVersion,
    payload,
  };
}
