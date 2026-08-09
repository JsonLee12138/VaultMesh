export async function presentBrowserSaveConfirmation(
  openIndependentWindow: () => Promise<unknown>,
): Promise<void> {
  await openIndependentWindow();
}
