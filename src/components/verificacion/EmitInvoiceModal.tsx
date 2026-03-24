"use client";

import { memo } from "react";
import {
  EmitComprobanteModal,
  type EmitComprobanteModalTransferProps,
} from "@/features/boletas/components/EmitComprobanteModal";

export type EmitInvoiceModalProps = Omit<EmitComprobanteModalTransferProps, "mode">;

export const EmitInvoiceModal = memo(function EmitInvoiceModal(props: EmitInvoiceModalProps) {
  return <EmitComprobanteModal mode="transfer" {...props} />;
});
