export async function updateCustomerDisplay(payload: {
  title?: string;
  line1?: string;
  line2?: string;
}) {
  try {
    if (!window.wasla?.updateCustomerDisplay) return;
    await window.wasla.updateCustomerDisplay(payload);
  } catch {
    // Best-effort only; never block booking flow.
  }
}

