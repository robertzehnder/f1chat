import type { ChatApiResponse } from "@/lib/chatTypes";

export type ResolvedSessionContext = {
  sessionKey?: number;
  sessionLabel?: string;
  driverNumbers?: number[];
  resolutionStatus?: string;
  needsClarification?: boolean;
  requestId?: string;
};

export function deriveResolvedContext(data: ChatApiResponse): ResolvedSessionContext {
  const res = data.runtime?.resolution;
  return {
    sessionKey: res?.selectedSession?.sessionKey,
    sessionLabel: res?.selectedSession?.label,
    driverNumbers: res?.selectedDriverNumbers,
    resolutionStatus: res?.status,
    needsClarification: res?.needsClarification,
    requestId: data.requestId
  };
}
