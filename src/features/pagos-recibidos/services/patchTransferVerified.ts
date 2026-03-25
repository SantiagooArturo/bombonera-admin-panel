export async function patchTransferVerified(transferId: string, verified: boolean): Promise<boolean> {
  const res = await fetch("/api/transfers", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: transferId, verified }),
  });
  return res.ok;
}
