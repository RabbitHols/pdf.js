import approvedStamp from "../assets/stamps/approved.svg";
import confidentialStamp from "../assets/stamps/confidential.svg";
import draftStamp from "../assets/stamps/draft.svg";
import receivedStamp from "../assets/stamps/received.svg";
import signHereStamp from "../assets/stamps/sign-here.svg";
import voidStamp from "../assets/stamps/void.svg";

export const stampIdentityStorageKey = "rewirepdf.viewerNext.stampIdentity";

export const defaultStampIdentity = {
  date: "",
  includeDate: true,
  name: "",
  title: "",
};

export const stampPresets = [
  {
    asset: approvedStamp,
    id: "approved",
    label: "APPROVED",
    requiresIdentity: true,
    type: "preset",
  },
  {
    asset: draftStamp,
    id: "draft",
    label: "DRAFT",
    requiresIdentity: false,
    type: "preset",
  },
  {
    asset: confidentialStamp,
    id: "confidential",
    label: "CONFIDENTIAL",
    requiresIdentity: false,
    type: "preset",
  },
  {
    asset: receivedStamp,
    id: "received",
    label: "RECEIVED",
    requiresIdentity: true,
    type: "preset",
  },
  {
    asset: signHereStamp,
    id: "sign-here",
    label: "SIGN HERE",
    requiresIdentity: true,
    type: "preset",
  },
  {
    asset: voidStamp,
    id: "void",
    label: "VOID",
    requiresIdentity: false,
    type: "preset",
  },
];
