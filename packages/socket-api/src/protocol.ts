/** Current Socket API schema version. Bump when wire payloads are incompatible. */
export const PROTOCOL_VERSION = 1 as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
